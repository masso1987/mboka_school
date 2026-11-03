import { HttpStatus, Injectable } from '@nestjs/common';
import {
  computeCompetenceResults,
  DEFAULT_COMPETENCE_RULES,
  type CompetenceComponent,
  type CompetenceComponentsInput,
  type CompetenceMarksInput,
  type CompetenceRules,
} from '@mboka/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { PrismaService, type Tx } from '../prisma/prisma.service';

export interface ReportBookRemarks {
  teacherRemark: string | null;
  headRemark: string | null;
  conduct: string | null;
}

/**
 * Competence-based marking (Phase 8, MINEDUB 2018 primary curriculum): competences are the class subjects of a level
 * whose marking system is COMPETENCES; each has evaluation components with a maximum; teachers enter one mark per
 * component and month. Results come from the pure engine in @mboka/shared (`computeCompetenceResults`).
 */
@Injectable()
export class CompetencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  // ------------------------------------------------------------ rules and marking system

  static rulesOf(settings: Prisma.JsonValue | null): CompetenceRules {
    return { ...DEFAULT_COMPETENCE_RULES, ...(((settings ?? {}) as { competenceRules?: Partial<CompetenceRules> }).competenceRules ?? {}) };
  }

  rules(a: Actor) {
    return this.run(a, async (tx) => CompetencesService.rulesOf((await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { settings: true } })).settings));
  }

  setRules(a: Actor, rules: CompetenceRules) {
    return this.run(a, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { settings: true } });
      await tx.tenant.update({ where: { id: a.tenantId }, data: { settings: { ...((t.settings ?? {}) as object), competenceRules: rules } as Prisma.InputJsonObject } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'competences.rules_changed', metadata: rules as unknown as Prisma.InputJsonObject, ip: a.ip }, tx);
      return rules;
    });
  }

  setLevelSystem(a: Actor, levelId: string, markingSystem: 'SUBJECTS' | 'COMPETENCES') {
    return this.run(a, async (tx) => {
      const level = await tx.educationLevel.findFirst({ where: { id: levelId, tenantId: a.tenantId } });
      if (!level) throw Errors.notFound('Level');
      const updated = await tx.educationLevel.update({ where: { id: levelId }, data: { markingSystem } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'competences.level_system_changed', entityType: 'education_level', entityId: levelId, metadata: { from: level.markingSystem, to: markingSystem }, ip: a.ip }, tx);
      return { id: updated.id, markingSystem: updated.markingSystem };
    });
  }

  // ------------------------------------------------------------ competences of a class

  private async classOrThrow(tx: Tx, a: Actor, classId: string) {
    const c = await tx.schoolClass.findFirst({
      where: { id: classId, tenantId: a.tenantId },
      select: { id: true, name: true, academicYearId: true, level: { select: { id: true, markingSystem: true, nameFr: true, nameEn: true } } },
    });
    if (!c) throw Errors.notFound('Class');
    return c;
  }

  private async competences(tx: Tx, a: Actor, classId: string) {
    const subjects = await tx.classSubject.findMany({
      where: { tenantId: a.tenantId, classId },
      include: { subject: { select: { code: true, nameFr: true, nameEn: true } } },
      orderBy: { subject: { code: 'asc' } },
    });
    const components = await tx.competenceComponent.findMany({ where: { tenantId: a.tenantId, classSubjectId: { in: subjects.map((s) => s.id) } }, orderBy: { position: 'asc' } });
    return subjects.map((s) => ({
      id: s.id,
      code: s.subject.code,
      nameFr: s.subject.nameFr,
      nameEn: s.subject.nameEn,
      components: components.filter((c) => c.classSubjectId === s.id).map((c) => ({ kind: c.kind as CompetenceComponent, max: c.maxScore.toString() })),
    }));
  }

  classCompetences(a: Actor, classId: string) {
    return this.run(a, async (tx) => {
      const c = await this.classOrThrow(tx, a, classId);
      const list = await this.competences(tx, a, classId);
      const max = list.reduce((s, x) => s + x.components.reduce((t, y) => t + Number(y.max), 0), 0);
      return { class: { id: c.id, name: c.name }, markingSystem: c.level.markingSystem, grandMax: max, competences: list };
    });
  }

  /** Replaces a competence's components; a component that already has marks cannot be removed. */
  setComponents(a: Actor, classSubjectId: string, input: CompetenceComponentsInput) {
    return this.run(a, async (tx) => {
      const cs = await tx.classSubject.findFirst({ where: { id: classSubjectId, tenantId: a.tenantId } });
      if (!cs) throw Errors.notFound('Competence');
      const keep = input.components.map((c) => c.kind);
      const marked = await tx.competenceMark.findFirst({ where: { tenantId: a.tenantId, classSubjectId, kind: { notIn: keep } }, select: { kind: true } });
      if (marked) throw Errors.conflict('COMPONENT_HAS_MARKS', `The ${marked.kind} component already has marks`);
      const overMax = await Promise.all(
        input.components.map((c) => tx.competenceMark.findFirst({ where: { tenantId: a.tenantId, classSubjectId, kind: c.kind, score: { gt: c.max } }, select: { kind: true } })),
      );
      if (overMax.some(Boolean)) throw Errors.conflict('MARKS_ABOVE_NEW_MAX', 'Some marks are above the new maximum');
      await tx.competenceComponent.deleteMany({ where: { tenantId: a.tenantId, classSubjectId, kind: { notIn: keep } } });
      for (const [position, c] of input.components.entries()) {
        await tx.competenceComponent.upsert({
          where: { tenantId_classSubjectId_kind: { tenantId: a.tenantId, classSubjectId, kind: c.kind } },
          create: { tenantId: a.tenantId, classSubjectId, kind: c.kind, maxScore: c.max, position },
          update: { maxScore: c.max, position },
        });
      }
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'competences.components_set', entityType: 'class_subject', entityId: classSubjectId, metadata: { components: input.components }, ip: a.ip }, tx);
      return input.components;
    });
  }

  // ------------------------------------------------------------ monthly marks

  private async canEnter(tx: Tx, a: Actor, classSubjectId: string) {
    if (a.permissions.has('grades.approve')) return true;
    if (!a.permissions.has('grades.enter')) return false;
    return (
      (await tx.teachingAssignment.count({
        where: { tenantId: a.tenantId, classSubjectId, endDate: null, staff: { membershipId: a.membershipId, status: 'ACTIVE' } },
      })) > 0
    );
  }

  monthSheet(a: Actor, classSubjectId: string, month: number) {
    return this.run(a, async (tx) => {
      const cs = await tx.classSubject.findFirst({ where: { id: classSubjectId, tenantId: a.tenantId }, include: { subject: true } });
      if (!cs) throw Errors.notFound('Competence');
      const [components, enrollments, marks] = await Promise.all([
        tx.competenceComponent.findMany({ where: { tenantId: a.tenantId, classSubjectId }, orderBy: { position: 'asc' } }),
        tx.enrollment.findMany({
          where: { tenantId: a.tenantId, classId: cs.classId, status: 'ENROLLED' },
          include: { student: { select: { matricule: true, firstName: true, lastName: true } } },
          orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
        }),
        tx.competenceMark.findMany({ where: { tenantId: a.tenantId, classSubjectId, month } }),
      ]);
      return {
        competence: { id: cs.id, code: cs.subject.code, nameFr: cs.subject.nameFr, nameEn: cs.subject.nameEn },
        month,
        components: components.map((c) => ({ kind: c.kind, max: c.maxScore.toString() })),
        canEdit: await this.canEnter(tx, a, classSubjectId),
        rows: enrollments.map((e) => ({
          enrollmentId: e.id,
          student: e.student,
          marks: Object.fromEntries(marks.filter((m) => m.enrollmentId === e.id).map((m) => [m.kind, m.score.toString()])),
        })),
      };
    });
  }

  /** Saves a month's marks for a competence: empty cells remove the mark; each change is audited. */
  saveMonth(a: Actor, input: CompetenceMarksInput) {
    return this.run(a, async (tx) => {
      const cs = await tx.classSubject.findFirst({ where: { id: input.classSubjectId, tenantId: a.tenantId } });
      if (!cs) throw Errors.notFound('Competence');
      if (!(await this.canEnter(tx, a, input.classSubjectId))) throw Errors.forbidden('You are not assigned to this competence');
      const components = new Map((await tx.competenceComponent.findMany({ where: { tenantId: a.tenantId, classSubjectId: input.classSubjectId } })).map((c) => [c.kind, c.maxScore]));
      if (components.size === 0) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'NO_COMPONENTS', 'Set the evaluation components of this competence first');
      const enrollments = new Set(
        (await tx.enrollment.findMany({ where: { tenantId: a.tenantId, classId: cs.classId, id: { in: input.rows.map((r) => r.enrollmentId) } }, select: { id: true } })).map((e) => e.id),
      );
      const errors: { enrollmentId: string; kind: string; code: string }[] = [];
      let changed = 0;
      for (const row of input.rows) {
        if (!enrollments.has(row.enrollmentId)) {
          errors.push({ enrollmentId: row.enrollmentId, kind: '', code: 'NOT_IN_CLASS' });
          continue;
        }
        for (const [kind, raw] of Object.entries(row.marks)) {
          const max = components.get(kind);
          if (!max) {
            errors.push({ enrollmentId: row.enrollmentId, kind, code: 'UNKNOWN_COMPONENT' });
            continue;
          }
          const key = { tenantId: a.tenantId, enrollmentId: row.enrollmentId, classSubjectId: input.classSubjectId, month: input.month, kind };
          if (raw === null || raw === undefined || raw === '') {
            changed += (await tx.competenceMark.deleteMany({ where: key })).count;
            continue;
          }
          const score = new Prisma.Decimal(raw.replace(',', '.'));
          if (score.greaterThan(max)) {
            errors.push({ enrollmentId: row.enrollmentId, kind, code: 'ABOVE_MAX' });
            continue;
          }
          await tx.competenceMark.upsert({
            where: { tenantId_enrollmentId_classSubjectId_month_kind: key },
            create: { ...key, score, enteredBy: a.userId },
            update: { score, enteredBy: a.userId },
          });
          changed++;
        }
      }
      if (errors.length) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_MARKS', 'Some marks are invalid; nothing was saved', { errors });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'competences.marks_saved', entityType: 'class_subject', entityId: input.classSubjectId, metadata: { month: input.month, changed }, ip: a.ip }, tx);
      return { changed };
    });
  }

  // ------------------------------------------------------------ results and report book remarks

  /** Every pupil's results for the class, from the engine; also used by the report book PDF. */
  async results(tx: Tx, a: Pick<Actor, 'tenantId'>, classId: string) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { settings: true } });
    const list = await this.competences(tx, a as Actor, classId);
    const enrollments = await tx.enrollment.findMany({
      where: { tenantId: a.tenantId, classId, status: 'ENROLLED' },
      include: { student: { select: { id: true, matricule: true, firstName: true, lastName: true } } },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    });
    const marks = await tx.competenceMark.findMany({ where: { tenantId: a.tenantId, classSubjectId: { in: list.map((c) => c.id) }, enrollmentId: { in: enrollments.map((e) => e.id) } } });
    const engine = computeCompetenceResults({
      rules: CompetencesService.rulesOf(tenant.settings),
      competences: list.filter((c) => c.components.length > 0).map((c) => ({ id: c.id, components: c.components })),
      studentIds: enrollments.map((e) => e.id),
      marks: marks.map((m) => ({ studentId: m.enrollmentId, competenceId: m.classSubjectId, month: m.month, kind: m.kind as CompetenceComponent, score: m.score.toString() })),
    });
    return { competences: list.filter((c) => c.components.length > 0), enrollments, engine };
  }

  classResults(a: Actor, classId: string) {
    return this.run(a, async (tx) => {
      await this.classOrThrow(tx, a, classId);
      const { competences, enrollments, engine } = await this.results(tx, a, classId);
      return {
        competences: competences.map((c) => ({ id: c.id, code: c.code, nameFr: c.nameFr, nameEn: c.nameEn })),
        grandMax: engine.grandMax,
        classSize: engine.classSize,
        students: engine.students.map((s) => {
          const e = enrollments.find((x) => x.id === s.studentId)!;
          return { enrollmentId: e.id, student: e.student, terms: s.terms, annual: s.annual, annualCompetences: s.annualCompetences };
        }),
      };
    });
  }

  remarks(a: Actor, enrollmentId: string) {
    return this.run(a, async (tx) => {
      const rows = await tx.reportBookEntry.findMany({ where: { tenantId: a.tenantId, enrollmentId } });
      return Object.fromEntries(rows.map((r) => [r.term, { teacherRemark: r.teacherRemark, headRemark: r.headRemark, conduct: r.conduct }]));
    });
  }

  setRemarks(a: Actor, enrollmentId: string, term: number, input: ReportBookRemarks) {
    return this.run(a, async (tx) => {
      const e = await tx.enrollment.findFirst({ where: { id: enrollmentId, tenantId: a.tenantId }, select: { id: true } });
      if (!e) throw Errors.notFound('Enrollment');
      const row = await tx.reportBookEntry.upsert({
        where: { tenantId_enrollmentId_term: { tenantId: a.tenantId, enrollmentId, term } },
        create: { tenantId: a.tenantId, enrollmentId, term, ...input, updatedBy: a.userId },
        update: { ...input, updatedBy: a.userId },
      });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'report_book.remarks_set', entityType: 'enrollment', entityId: enrollmentId, metadata: { term }, ip: a.ip }, tx);
      return { term: row.term, teacherRemark: row.teacherRemark, headRemark: row.headRemark, conduct: row.conduct };
    });
  }
}
