import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
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
      const counts = { promoted: 0, repeating: 0, graduated: 0, left: 0, alreadyEnrolled: 0 };
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
