import { HttpStatus, Injectable } from '@nestjs/common';
import { PROMOTION_OUTCOMES } from '@mboka/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toIso } from '../common/dates';
import { BillingService } from '../finance/billing.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';

export const rolloverSchema = z.object({
  targetYearId: z.uuid(),
  /** For each class of the closing year: where promoted students go, and where repeaters go. */
  classMap: z
    .array(z.object({ fromClassId: z.uuid(), promotedTo: z.uuid().optional(), repeatIn: z.uuid().optional() }))
    .max(300),
  closeSourceYear: z.boolean().default(false),
});
export type RolloverInput = z.infer<typeof rolloverSchema>;

/** Decisions taken on the promotion screen, for pupils the class council did not decide (e.g. primary classes). */
export const yearDecisionsSchema = z.object({
  decisions: z
    .array(z.object({ enrollmentId: z.uuid(), decision: z.enum(PROMOTION_OUTCOMES) }))
    .min(1)
    .max(2000),
});
export type YearDecisionsInput = z.infer<typeof yearDecisionsSchema>;

export const copyClassesSchema = z.object({ fromYearId: z.uuid() });
export type CopyClassesInput = z.infer<typeof copyClassesSchema>;

type Action = 'PROMOTE' | 'REPEAT' | 'GRADUATE' | 'LEAVE' | 'ALREADY_ENROLLED';

export interface RolloverRow {
  enrollmentId: string;
  studentId: string;
  student: { matricule: string; firstName: string; lastName: string };
  fromClass: string;
  decision: string | null;
  action: Action | null;
  targetClassId: string | null;
  targetClass: string | null;
  exception: 'NO_DECISION' | 'NO_TARGET_CLASS' | 'CLASS_FULL' | null;
}

const ACTIVE = ['ENROLLED', 'REPEATING'] as const;

/**
 * Year-end rollover (ACA-010/011, Workflow F): preview, resolve exceptions, then commit.
 * Commit creates next year's enrollments from the class council decisions and closes this
 * year's without deleting anything. Running it again changes nothing (§13.2 scenario 7):
 * students already enrolled next year are skipped and closed enrollments are not revisited.
 */
@Injectable()
export class RolloverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  preview(a: Actor, sourceYearId: string, input: RolloverInput) {
    return this.run(a, async (tx) => {
      const { source, target, ...rest } = await this.plan(tx, a, sourceYearId, input);
      return { source: { id: source.id, name: source.name }, target: { id: target.id, name: target.name }, ...rest };
    });
  }

  commit(a: Actor, sourceYearId: string, input: RolloverInput) {
    return this.run(a, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rollover:${a.tenantId}:${sourceYearId}`}))`;
      const plan = await this.plan(tx, a, sourceYearId, input);
      if (plan.exceptions.length > 0) {
        throw new ApiException(HttpStatus.CONFLICT, 'ROLLOVER_HAS_EXCEPTIONS', `${plan.exceptions.length} student(s) need a decision or a class`, {
          exceptions: plan.exceptions,
        });
      }
      const { source, target } = plan;
      const counts = { promoted: 0, repeating: 0, graduated: 0, left: 0, alreadyEnrolled: 0, billed: 0 };
      const billOn = toIso(new Date());
      for (const r of plan.rows) {
        switch (r.action) {
          case 'ALREADY_ENROLLED':
            counts.alreadyEnrolled++;
            await tx.enrollment.update({ where: { id: r.enrollmentId }, data: { status: 'COMPLETED', leftOn: source.endDate, leftReason: 'rollover' } });
            break;
          case 'PROMOTE':
          case 'REPEAT':
            await tx.enrollment.create({
              data: {
                tenantId: a.tenantId,
                studentId: r.studentId,
                academicYearId: target.id,
                classId: r.targetClassId!,
                status: r.action === 'REPEAT' ? 'REPEATING' : 'ENROLLED',
                enrolledOn: target.startDate,
              },
            });
            await tx.enrollment.update({ where: { id: r.enrollmentId }, data: { status: 'COMPLETED', leftOn: source.endDate, leftReason: 'rollover' } });
            // Next year's class fees, when the bursar has already set them; otherwise "Bill" on the schedule later.
            counts.billed += (await this.billing.billCompulsory(tx, a, r.studentId, target.id, billOn)).invoices;
            if (r.action === 'REPEAT') counts.repeating++;
            else counts.promoted++;
            break;
          case 'GRADUATE':
            await tx.enrollment.update({ where: { id: r.enrollmentId }, data: { status: 'COMPLETED', leftOn: source.endDate, leftReason: 'graduated' } });
            await tx.student.update({ where: { id: r.studentId }, data: { status: 'GRADUATED' } });
            counts.graduated++;
            break;
          case 'LEAVE':
            await tx.enrollment.update({ where: { id: r.enrollmentId }, data: { status: 'WITHDRAWN', leftOn: source.endDate, leftReason: 'class council decision' } });
            await tx.student.update({ where: { id: r.studentId }, data: { status: 'WITHDRAWN' } });
            counts.left++;
            break;
        }
      }
      if (input.closeSourceYear && source.status !== 'CLOSED') await tx.academicYear.update({ where: { id: source.id }, data: { status: 'CLOSED' } });
      if (target.status === 'DRAFT') await tx.academicYear.update({ where: { id: target.id }, data: { status: 'ACTIVE' } });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'academic_year.rolled_over',
          entityType: 'academic_year',
          entityId: source.id,
          metadata: { targetYearId: target.id, ...counts, closedSource: input.closeSourceYear },
          ip: a.ip,
        },
        tx,
      );
      return { ...counts, sourceClosed: input.closeSourceYear };
    });
  }

  /** Records pass / repeat / end of cycle / exclusion for pupils of the year, from the promotion screen. */
  saveDecisions(a: Actor, yearId: string, input: YearDecisionsInput) {
    return this.run(a, async (tx) => {
      const ids = input.decisions.map((d) => d.enrollmentId);
      const enrollments = await tx.enrollment.findMany({
        where: { tenantId: a.tenantId, academicYearId: yearId, id: { in: ids }, status: { in: [...ACTIVE] } },
        include: { promotion: true },
      });
      if (enrollments.length !== new Set(ids).size) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'STUDENT_NOT_IN_YEAR', 'A pupil is not enrolled this year');
      let changed = 0;
      for (const d of input.decisions) {
        const e = enrollments.find((x) => x.id === d.enrollmentId)!;
        if (e.promotion?.decision === d.decision) continue;
        await tx.promotionDecision.upsert({
          where: { tenantId_enrollmentId: { tenantId: a.tenantId, enrollmentId: e.id } },
          // Without a class council proposal, the decision stands as its own proposal.
          create: { tenantId: a.tenantId, enrollmentId: e.id, academicYearId: yearId, decision: d.decision, proposed: d.decision, decidedBy: a.userId },
          update: { decision: d.decision, decidedBy: a.userId, decidedAt: new Date() },
        });
        await this.audit.record(
          { tenantId: a.tenantId, actorId: a.userId, action: 'promotion.decided', entityType: 'enrollment', entityId: e.id, metadata: { from: e.promotion?.decision ?? null, to: d.decision, via: 'promotion_screen' }, ip: a.ip },
          tx,
        );
        changed++;
      }
      return { changed };
    });
  }

  /** Creates next year's classes from this year's (same code, name, level, campus, capacity, subjects and scales). */
  copyClasses(a: Actor, targetYearId: string, input: CopyClassesInput) {
    return this.run(a, async (tx) => {
      const [source, target] = await Promise.all([
        tx.academicYear.findFirst({ where: { id: input.fromYearId, tenantId: a.tenantId } }),
        tx.academicYear.findFirst({ where: { id: targetYearId, tenantId: a.tenantId } }),
      ]);
      if (!source || !target) throw Errors.notFound('Academic year');
      if (source.id === target.id) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'SAME_YEAR', 'Choose a different year');
      if (target.status === 'CLOSED') throw Errors.conflict('ACADEMIC_YEAR_CLOSED', 'The academic year is closed');
      const [classes, existing] = await Promise.all([
        tx.schoolClass.findMany({ where: { tenantId: a.tenantId, academicYearId: source.id }, include: { subjects: true } }),
        tx.schoolClass.findMany({ where: { tenantId: a.tenantId, academicYearId: target.id }, select: { code: true } }),
      ]);
      const taken = new Set(existing.map((c) => c.code));
      let created = 0;
      for (const c of classes.filter((x) => !taken.has(x.code))) {
        const copy = await tx.schoolClass.create({
          data: { tenantId: a.tenantId, academicYearId: target.id, campusId: c.campusId, levelId: c.levelId, programId: c.programId, code: c.code, name: c.name, capacity: c.capacity },
        });
        for (const s of c.subjects) {
          const cs = await tx.classSubject.create({ data: { tenantId: a.tenantId, classId: copy.id, subjectId: s.subjectId, coefficient: s.coefficient, weeklyHours: s.weeklyHours } });
          const components = await tx.competenceComponent.findMany({ where: { tenantId: a.tenantId, classSubjectId: s.id } });
          if (components.length > 0) {
            await tx.competenceComponent.createMany({ data: components.map((k) => ({ tenantId: a.tenantId, classSubjectId: cs.id, kind: k.kind, maxScore: k.maxScore, position: k.position })) });
          }
        }
        created++;
      }
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'academic_year.classes_copied', entityType: 'academic_year', entityId: target.id, metadata: { fromYearId: source.id, created, skipped: classes.length - created }, ip: a.ip },
        tx,
      );
      return { created, skipped: classes.length - created };
    });
  }

  private async plan(tx: Tx, a: Actor, sourceYearId: string, input: RolloverInput) {
    if (sourceYearId === input.targetYearId) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'SAME_YEAR', 'Choose a different target year');
    const [source, target] = await Promise.all([
      tx.academicYear.findFirst({ where: { id: sourceYearId, tenantId: a.tenantId } }),
      tx.academicYear.findFirst({ where: { id: input.targetYearId, tenantId: a.tenantId } }),
    ]);
    if (!source || !target) throw Errors.notFound('Academic year');
    if (target.startDate <= source.startDate) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'TARGET_NOT_LATER', 'The target year must start after the closing year');

    const [sourceClasses, targetClasses] = await Promise.all([
      tx.schoolClass.findMany({ where: { tenantId: a.tenantId, academicYearId: source.id }, select: { id: true, name: true } }),
      tx.schoolClass.findMany({
        where: { tenantId: a.tenantId, academicYearId: target.id },
        select: { id: true, name: true, capacity: true, _count: { select: { enrollments: { where: { status: { in: [...ACTIVE] } } } } } },
      }),
    ]);
    const map = new Map(input.classMap.map((m) => [m.fromClassId, m]));
    for (const m of input.classMap) {
      if (!sourceClasses.some((c) => c.id === m.fromClassId)) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'CLASS_NOT_IN_SOURCE_YEAR', 'A class does not belong to the closing year');
      for (const t of [m.promotedTo, m.repeatIn]) {
        if (t && !targetClasses.some((c) => c.id === t)) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'CLASS_NOT_IN_TARGET_YEAR', 'A destination class does not belong to the target year');
      }
    }

    const enrollments = await tx.enrollment.findMany({
      where: { tenantId: a.tenantId, academicYearId: source.id, status: { in: [...ACTIVE] } },
      include: { student: { select: { matricule: true, firstName: true, lastName: true } }, promotion: true },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    });
    const alreadyInTarget = new Set(
      (await tx.enrollment.findMany({ where: { tenantId: a.tenantId, academicYearId: target.id, status: { in: [...ACTIVE, 'PENDING'] } }, select: { studentId: true } })).map((e) => e.studentId),
    );
    const planned = new Map(targetClasses.map((c) => [c.id, c._count.enrollments]));
    const className = (id: string | null) => (id ? (targetClasses.find((c) => c.id === id)?.name ?? null) : null);

    const rows: RolloverRow[] = enrollments.map((e) => {
      const base = {
        enrollmentId: e.id,
        studentId: e.studentId,
        student: e.student,
        fromClass: sourceClasses.find((c) => c.id === e.classId)?.name ?? '',
        decision: e.promotion?.decision ?? null,
      };
      if (alreadyInTarget.has(e.studentId)) return { ...base, action: 'ALREADY_ENROLLED' as const, targetClassId: null, targetClass: null, exception: null };
      switch (e.promotion?.decision) {
        case 'GRADUATED':
          return { ...base, action: 'GRADUATE' as const, targetClassId: null, targetClass: null, exception: null };
        case 'EXCLUDED':
          return { ...base, action: 'LEAVE' as const, targetClassId: null, targetClass: null, exception: null };
        case 'PROMOTED':
        case 'REPEAT': {
          const action = e.promotion.decision === 'PROMOTED' ? ('PROMOTE' as const) : ('REPEAT' as const);
          const to = action === 'PROMOTE' ? map.get(e.classId)?.promotedTo : map.get(e.classId)?.repeatIn;
          if (!to) return { ...base, action, targetClassId: null, targetClass: null, exception: 'NO_TARGET_CLASS' as const };
          const cls = targetClasses.find((c) => c.id === to)!;
          const next = (planned.get(to) ?? 0) + 1;
          if (cls.capacity !== null && next > cls.capacity) return { ...base, action, targetClassId: to, targetClass: cls.name, exception: 'CLASS_FULL' as const };
          planned.set(to, next);
          return { ...base, action, targetClassId: to, targetClass: className(to), exception: null };
        }
        default:
          return { ...base, action: null, targetClassId: null, targetClass: null, exception: 'NO_DECISION' as const };
      }
    });

    const exceptions = rows.filter((r) => r.exception).map((r) => ({ enrollmentId: r.enrollmentId, student: r.student, fromClass: r.fromClass, exception: r.exception }));
    const count = (act: Action) => rows.filter((r) => r.action === act && !r.exception).length;
    return {
      source,
      target,
      summary: {
        students: rows.length,
        promote: count('PROMOTE'),
        repeat: count('REPEAT'),
        graduate: count('GRADUATE'),
        leave: count('LEAVE'),
        alreadyEnrolled: count('ALREADY_ENROLLED'),
        exceptions: exceptions.length,
      },
      rows,
      exceptions,
      canCommit: exceptions.length === 0,
    };
  }
}
