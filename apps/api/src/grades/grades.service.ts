import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DEFAULT_RULES_CM,
  parseMarkCell,
  gradingRulesSchema,
  type AssessmentInput,
  type CommentsInput,
  type GradingRules,
  type MarksImportInput,
  type MarksInput,
  type SchemeRulesInput,
  type SheetDecisionInput,
  type SheetRef,
} from '@mboka/shared';
import { Prisma, type GradeSubmission, type MarkStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toDate, toIso, toIsoOrNull } from '../common/dates';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const EDITABLE = new Set<GradeSubmission['status']>(['OPEN', 'REOPENED']);

/**
 * Assessments, mark entry and the submission workflow (Module 7, GRD-001…004, 008, 011, 012).
 * Teachers work only on subjects they are assigned to; reviewers approve; approved marks are
 * locked and every later change is recorded with its reason.
 */
@Injectable()
export class GradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  // ------------------------------------------------------------ schemes

  /** The default scheme and its current rules, created with the Cameroonian defaults on first use. */
  async currentRules(tx: Tx, a: Actor): Promise<{ versionId: string; version: number; rules: GradingRules; schemeName: string }> {
    let scheme = await tx.gradingScheme.findFirst({ where: { tenantId: a.tenantId, isDefault: true } });
    if (!scheme) {
      scheme = await tx.gradingScheme.create({ data: { tenantId: a.tenantId, name: 'Barème standard', isDefault: true, currentVersion: 1 } });
      await tx.gradingSchemeVersion.create({
        data: { tenantId: a.tenantId, schemeId: scheme.id, version: 1, rules: DEFAULT_RULES_CM as unknown as Prisma.InputJsonValue, createdBy: a.userId },
      });
    }
    const v = await tx.gradingSchemeVersion.findUniqueOrThrow({
      where: { tenantId_schemeId_version: { tenantId: a.tenantId, schemeId: scheme.id, version: scheme.currentVersion } },
    });
    return { versionId: v.id, version: v.version, rules: gradingRulesSchema.parse(v.rules), schemeName: scheme.name };
  }

  getScheme(a: Actor) {
    return this.run(a, async (tx) => {
      const current = await this.currentRules(tx, a);
      const versions = await tx.gradingSchemeVersion.findMany({
        where: { tenantId: a.tenantId, scheme: { isDefault: true } },
        orderBy: { version: 'desc' },
        select: { version: true, createdAt: true, _count: { select: { reportCards: true } } },
      });
      return {
        name: current.schemeName,
        version: current.version,
        rules: current.rules,
        history: versions.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString(), reportCards: v._count.reportCards })),
      };
    });
  }

  /** Changing rules creates a new version; cards already generated keep theirs (GRD-013). */
  updateScheme(a: Actor, input: SchemeRulesInput) {
    return this.run(a, async (tx) => {
      const before = await this.currentRules(tx, a);
      const scheme = await tx.gradingScheme.findFirstOrThrow({ where: { tenantId: a.tenantId, isDefault: true } });
      const version = scheme.currentVersion + 1;
      await tx.gradingSchemeVersion.create({
        data: { tenantId: a.tenantId, schemeId: scheme.id, version, rules: input.rules as unknown as Prisma.InputJsonValue, createdBy: a.userId },
      });
      await tx.gradingScheme.update({ where: { id: scheme.id }, data: { currentVersion: version, name: input.name } });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'grading_scheme.versioned',
          entityType: 'grading_scheme',
          entityId: scheme.id,
          metadata: { from: before.version, to: version, before: before.rules, after: input.rules } as unknown as Prisma.InputJsonValue,
          ip: a.ip,
        },
        tx,
      );
      return { version, rules: input.rules };
    });
  }

  // ------------------------------------------------------------ assessments

  createAssessment(a: Actor, input: AssessmentInput) {
    return this.run(a, async (tx) => {
      const ctx = await this.sheetContext(tx, a, input);
      this.assertCanEdit(a, ctx);
      const assessment = await tx.assessment.create({
        data: {
          tenantId: a.tenantId,
          classSubjectId: input.classSubjectId,
          periodId: input.periodId,
          name: input.name,
          kind: input.kind,
          maxScore: new Prisma.Decimal(input.maxScore),
          weight: new Prisma.Decimal(input.weight),
          heldOn: input.heldOn ? toDate(input.heldOn) : undefined,
          createdBy: a.userId,
        },
      });
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'assessment.created', entityType: 'assessment', entityId: assessment.id, metadata: { ...input }, ip: a.ip },
        tx,
      );
      return { id: assessment.id };
    });
  }

  deleteAssessment(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const as = await tx.assessment.findFirst({ where: { id, tenantId: a.tenantId }, include: { _count: { select: { marks: true } } } });
      if (!as) throw Errors.notFound('Assessment');
      const ctx = await this.sheetContext(tx, a, { classSubjectId: as.classSubjectId, periodId: as.periodId });
      this.assertCanEdit(a, ctx);
      if (as._count.marks > 0) throw Errors.conflict('ASSESSMENT_HAS_MARKS', 'Delete the marks first, or keep the assessment');
      await tx.assessment.delete({ where: { id } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'assessment.deleted', entityType: 'assessment', entityId: id, ip: a.ip }, tx);
    });
  }

  // ------------------------------------------------------------ grade sheet

  /** Everything a teacher or reviewer needs for one subject and period. */
  sheet(a: Actor, ref: SheetRef) {
    return this.run(a, async (tx) => {
      const ctx = await this.sheetContext(tx, a, ref);
      if (!ctx.assigned && !a.permissions.has('grades.approve')) throw Errors.forbidden('You are not assigned to this subject');
      const [assessments, roster, comments] = await Promise.all([
        tx.assessment.findMany({
          where: { tenantId: a.tenantId, classSubjectId: ref.classSubjectId, periodId: ref.periodId },
          include: { marks: true },
          orderBy: [{ heldOn: 'asc' }, { createdAt: 'asc' }],
        }),
        this.roster(tx, a.tenantId, ctx.classSubject.classId, ctx.period.startDate, ctx.period.endDate),
        tx.subjectComment.findMany({ where: { tenantId: a.tenantId, classSubjectId: ref.classSubjectId, periodId: ref.periodId } }),
      ]);
      const commentBy = new Map(comments.map((c) => [c.enrollmentId, c.comment]));
      return {
        class: ctx.classSubject.schoolClass,
        subject: ctx.classSubject.subject,
        coefficient: Number(ctx.classSubject.coefficient),
        period: { id: ctx.period.id, name: ctx.period.name, kind: ctx.period.kind, startDate: toIso(ctx.period.startDate), endDate: toIso(ctx.period.endDate) },
        submission: {
          status: ctx.submission.status,
          submittedAt: ctx.submission.submittedAt?.toISOString() ?? null,
          approvedAt: ctx.submission.approvedAt?.toISOString() ?? null,
          reopenReason: ctx.submission.reopenReason,
          everApproved: ctx.submission.everApproved,
        },
        canEdit: EDITABLE.has(ctx.submission.status) && (ctx.assigned || a.permissions.has('grades.approve')),
        canSubmit: EDITABLE.has(ctx.submission.status) && ctx.assigned && a.permissions.has('grades.submit'),
        canApprove: ctx.submission.status === 'SUBMITTED' && a.permissions.has('grades.approve') && ctx.submission.submittedBy !== a.userId,
        canReopen: ctx.submission.status === 'APPROVED' && a.permissions.has('grades.reopen'),
        assessments: assessments.map((as) => ({
          id: as.id,
          name: as.name,
          kind: as.kind,
          maxScore: as.maxScore.toString(),
          weight: as.weight.toString(),
          heldOn: toIsoOrNull(as.heldOn),
        })),
        students: roster.map((e) => ({
          studentId: e.studentId,
          enrollmentId: e.id,
          matricule: e.student.matricule,
          firstName: e.student.firstName,
          lastName: e.student.lastName,
          comment: commentBy.get(e.id) ?? '',
          marks: Object.fromEntries(
            assessments.map((as) => {
              const m = as.marks.find((x) => x.enrollmentId === e.id);
              return [as.id, m ? { score: m.score?.toString() ?? null, status: m.status } : null];
            }),
          ),
        })),
      };
    });
  }

  saveMarks(a: Actor, input: MarksInput) {
    return this.run(a, async (tx) => {
      const ctx = await this.sheetContext(tx, a, input);
      this.assertCanEdit(a, ctx);
      if (ctx.submission.everApproved && !input.reason) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'CHANGE_REASON_REQUIRED', 'Changing approved marks requires a reason');
      }
      return this.applyMarks(tx, a, ctx, input.marks, input.reason);
    });
  }

  /**
   * CSV import (GRD-003, STD-011 spirit): every row is checked first; if any row is wrong nothing is
   * written and each error names its row and reason.
   */
  importMarks(a: Actor, input: MarksImportInput) {
    return this.run(a, async (tx) => {
      const as = await tx.assessment.findFirst({ where: { id: input.assessmentId, tenantId: a.tenantId } });
      if (!as) throw Errors.notFound('Assessment');
      const ctx = await this.sheetContext(tx, a, { classSubjectId: as.classSubjectId, periodId: as.periodId });
      this.assertCanEdit(a, ctx);
      if (ctx.submission.everApproved && !input.reason) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'CHANGE_REASON_REQUIRED', 'Changing approved marks requires a reason');
      }
      const roster = await this.roster(tx, a.tenantId, ctx.classSubject.classId, ctx.period.startDate, ctx.period.endDate);
      const byMatricule = new Map(roster.map((e) => [e.student.matricule.toUpperCase(), e]));
      const errors: { row: number; matricule: string; reason: string }[] = [];
      const seen = new Set<string>();
      const marks: MarksInput['marks'] = [];
      input.rows.forEach((r, i) => {
        const row = i + 1;
        const e = byMatricule.get(r.matricule.toUpperCase());
        if (!e) return errors.push({ row, matricule: r.matricule, reason: 'unknown_student' });
        if (seen.has(e.studentId)) return errors.push({ row, matricule: r.matricule, reason: 'duplicate_row' });
        seen.add(e.studentId);
        const parsed = parseMarkCell(r.value);
        if (!parsed) return errors.push({ row, matricule: r.matricule, reason: 'invalid_value' });
        if (parsed.status === 'PRESENT' && new Prisma.Decimal(parsed.score!).greaterThan(as.maxScore)) {
          return errors.push({ row, matricule: r.matricule, reason: 'above_maximum' });
        }
        marks.push({ assessmentId: as.id, studentId: e.studentId, ...parsed });
      });
      if (errors.length > 0) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'IMPORT_REJECTED', `${errors.length} row(s) rejected; nothing was imported`, { errors });
      }
      const result = await this.applyMarks(tx, a, ctx, marks, input.reason);
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'marks.imported', entityType: 'assessment', entityId: as.id, metadata: { rows: input.rows.length }, ip: a.ip },
        tx,
      );
      return result;
    });
  }

  saveComments(a: Actor, input: CommentsInput) {
    return this.run(a, async (tx) => {
      const ctx = await this.sheetContext(tx, a, input);
      this.assertCanEdit(a, ctx);
      const roster = await this.roster(tx, a.tenantId, ctx.classSubject.classId, ctx.period.startDate, ctx.period.endDate);
      const enrollmentOf = new Map(roster.map((e) => [e.studentId, e.id]));
      for (const c of input.comments) {
        const enrollmentId = enrollmentOf.get(c.studentId);
        if (!enrollmentId) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'STUDENT_NOT_IN_CLASS', 'A student is not in this class');
        await tx.subjectComment.upsert({
          where: { tenantId_classSubjectId_periodId_enrollmentId: { tenantId: a.tenantId, classSubjectId: input.classSubjectId, periodId: input.periodId, enrollmentId } },
          create: { tenantId: a.tenantId, classSubjectId: input.classSubjectId, periodId: input.periodId, enrollmentId, comment: c.comment, updatedBy: a.userId },
          update: { comment: c.comment, updatedBy: a.userId },
        });
      }
      return { saved: input.comments.length };
    });
  }

  // ------------------------------------------------------------ workflow

  /** The assigned teacher submits once every student has a mark or a status in every assessment. */
  submit(a: Actor, ref: SheetRef) {
    return this.run(a, async (tx) => {
      const ctx = await this.sheetContext(tx, a, ref);
      if (!ctx.assigned) throw Errors.forbidden('Only the assigned teacher submits these marks');
      if (!EDITABLE.has(ctx.submission.status)) throw Errors.conflict('INVALID_TRANSITION', `Marks are ${ctx.submission.status}`);
      const [assessments, roster] = await Promise.all([
        tx.assessment.findMany({ where: { tenantId: a.tenantId, classSubjectId: ref.classSubjectId, periodId: ref.periodId }, include: { marks: { select: { enrollmentId: true } } } }),
        this.roster(tx, a.tenantId, ctx.classSubject.classId, ctx.period.startDate, ctx.period.endDate),
      ]);
      if (assessments.length === 0) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'NO_ASSESSMENTS', 'Create at least one assessment first');
      const missing = assessments.flatMap((as) => {
        const marked = new Set(as.marks.map((m) => m.enrollmentId));
        return roster.filter((e) => !marked.has(e.id)).map((e) => ({ assessment: as.name, matricule: e.student.matricule, name: `${e.student.lastName} ${e.student.firstName}` }));
      });
      if (missing.length > 0) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'INCOMPLETE_MARKS', `${missing.length} mark(s) missing`, { missing });
      }
      await this.transition(tx, a, ctx.submission, 'SUBMITTED', { submittedBy: a.userId, submittedAt: new Date() });
      return { status: 'SUBMITTED' as const };
    });
  }

  /** A reviewer approves; never the person who submitted (§3.3). Approved marks are locked. */
  approve(a: Actor, ref: SheetRef) {
    return this.run(a, async (tx) => {
      const ctx = await this.sheetContext(tx, a, ref);
      if (ctx.submission.status !== 'SUBMITTED') throw Errors.conflict('INVALID_TRANSITION', 'Only submitted marks can be approved');
      if (ctx.submission.submittedBy === a.userId) throw Errors.forbidden('You cannot approve marks you submitted');
      await this.transition(tx, a, ctx.submission, 'APPROVED', { approvedBy: a.userId, approvedAt: new Date(), everApproved: true });
      return { status: 'APPROVED' as const };
    });
  }

  /** Send submitted marks back to the teacher with a reason. */
  returnToTeacher(a: Actor, input: SheetDecisionInput) {
    return this.run(a, async (tx) => {
      if (!input.reason) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'REASON_REQUIRED', 'Say why the marks are returned');
      const ctx = await this.sheetContext(tx, a, input);
      if (ctx.submission.status !== 'SUBMITTED') throw Errors.conflict('INVALID_TRANSITION', 'Only submitted marks can be returned');
      await this.transition(tx, a, ctx.submission, ctx.submission.everApproved ? 'REOPENED' : 'OPEN', {}, input.reason);
      return { status: ctx.submission.everApproved ? 'REOPENED' : 'OPEN' };
    });
  }

  /** Authorized reopening of approved marks, with a reason (GRD-012). */
  reopen(a: Actor, input: SheetDecisionInput) {
    return this.run(a, async (tx) => {
      if (!input.reason) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'REASON_REQUIRED', 'Reopening approved marks requires a reason');
      const ctx = await this.sheetContext(tx, a, input);
      if (ctx.submission.status !== 'APPROVED') throw Errors.conflict('INVALID_TRANSITION', 'Only approved marks can be reopened');
      await this.transition(tx, a, ctx.submission, 'REOPENED', { reopenedBy: a.userId, reopenedAt: new Date(), reopenReason: input.reason }, input.reason);
      return { status: 'REOPENED' as const };
    });
  }

  /** Status of every subject of a class for a period — the reviewer's overview. */
  overview(a: Actor, classId: string, periodId: string) {
    return this.run(a, async (tx) => {
      const subjects = await tx.classSubject.findMany({
        where: { tenantId: a.tenantId, classId },
        include: {
          subject: { select: { code: true, nameFr: true, nameEn: true } },
          submissions: { where: { periodId } },
          assessments: { where: { periodId }, select: { id: true } },
          assignments: { where: { endDate: null }, include: { staff: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { subject: { code: 'asc' } },
      });
      return subjects.map((cs) => ({
        classSubjectId: cs.id,
        subject: cs.subject,
        coefficient: Number(cs.coefficient),
        teacher: cs.assignments[0]?.staff ? `${cs.assignments[0].staff.lastName} ${cs.assignments[0].staff.firstName}` : null,
        assessments: cs.assessments.length,
        status: cs.submissions[0]?.status ?? 'OPEN',
      }));
    });
  }

  // ------------------------------------------------------------ internals

  async sheetContext(tx: Tx, a: Actor, ref: SheetRef) {
    const [classSubject, period] = await Promise.all([
      tx.classSubject.findFirst({
        where: { id: ref.classSubjectId, tenantId: a.tenantId },
        include: { schoolClass: { select: { id: true, code: true, name: true, academicYearId: true } }, subject: { select: { code: true, nameFr: true, nameEn: true } } },
      }),
      tx.academicPeriod.findFirst({ where: { id: ref.periodId, tenantId: a.tenantId } }),
    ]);
    if (!classSubject) throw Errors.notFound('Class subject');
    if (!period) throw Errors.notFound('Period');
    if (period.academicYearId !== classSubject.schoolClass.academicYearId) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'PERIOD_IN_OTHER_YEAR', 'The period belongs to another academic year');
    }
    const submission = await tx.gradeSubmission.upsert({
      where: { tenantId_classSubjectId_periodId: { tenantId: a.tenantId, classSubjectId: ref.classSubjectId, periodId: ref.periodId } },
      create: { tenantId: a.tenantId, classSubjectId: ref.classSubjectId, periodId: ref.periodId },
      update: {},
    });
    const assigned =
      a.permissions.has('grades.enter') &&
      (await tx.teachingAssignment.count({
        where: {
          tenantId: a.tenantId,
          classSubjectId: ref.classSubjectId,
          staff: { membershipId: a.membershipId, status: 'ACTIVE' },
          startDate: { lte: period.endDate },
          OR: [{ endDate: null }, { endDate: { gte: period.startDate } }],
        },
      })) > 0;
    return { classSubject: { ...classSubject, classId: classSubject.schoolClass.id }, period, submission, assigned };
  }

  private assertCanEdit(a: Actor, ctx: Awaited<ReturnType<GradesService['sheetContext']>>) {
    if (!ctx.assigned && !a.permissions.has('grades.approve')) throw Errors.forbidden('You are not assigned to this subject');
    if (!EDITABLE.has(ctx.submission.status)) {
      throw Errors.conflict('MARKS_LOCKED', ctx.submission.status === 'APPROVED' ? 'Approved marks are locked; reopen them first' : 'Submitted marks await review');
    }
  }

  private async applyMarks(tx: Tx, a: Actor, ctx: Awaited<ReturnType<GradesService['sheetContext']>>, marks: MarksInput['marks'], reason?: string) {
    const assessments = await tx.assessment.findMany({
      where: { tenantId: a.tenantId, classSubjectId: ctx.classSubject.id, periodId: ctx.period.id },
    });
    const byId = new Map(assessments.map((x) => [x.id, x]));
    const roster = await this.roster(tx, a.tenantId, ctx.classSubject.classId, ctx.period.startDate, ctx.period.endDate);
    const enrollmentOf = new Map(roster.map((e) => [e.studentId, e.id]));
    let changed = 0;
    for (const m of marks) {
      const as = byId.get(m.assessmentId);
      if (!as) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'ASSESSMENT_NOT_IN_SHEET', 'An assessment is not part of this subject and period');
      const enrollmentId = enrollmentOf.get(m.studentId);
      if (!enrollmentId) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'STUDENT_NOT_IN_CLASS', 'A student is not in this class for the period');
      const score = m.status === 'PRESENT' ? new Prisma.Decimal(m.score!) : null;
      if (score && score.greaterThan(as.maxScore)) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'MARK_OUT_OF_RANGE', `A mark exceeds the maximum of ${as.maxScore.toString()}`, {
          assessmentId: as.id,
          studentId: m.studentId,
          maxScore: as.maxScore.toString(),
        });
      }
      const where = { tenantId_assessmentId_enrollmentId: { tenantId: a.tenantId, assessmentId: as.id, enrollmentId } };
      const before = await tx.studentMark.findUnique({ where });
      const same = before && before.status === m.status && ((before.score === null && score === null) || (before.score && score && before.score.equals(score)));
      if (same) continue;
      await tx.studentMark.upsert({
        where,
        create: { tenantId: a.tenantId, assessmentId: as.id, enrollmentId, studentId: m.studentId, score, status: m.status as MarkStatus, updatedBy: a.userId },
        update: { score, status: m.status as MarkStatus, updatedBy: a.userId },
      });
      if (ctx.submission.everApproved) {
        await tx.gradeChange.create({
          data: {
            tenantId: a.tenantId,
            assessmentId: as.id,
            studentId: m.studentId,
            fromScore: before?.score ?? null,
            fromStatus: before?.status ?? null,
            toScore: score,
            toStatus: m.status as MarkStatus,
            reason: reason!,
            changedBy: a.userId,
          },
        });
      }
      changed++;
    }
    if (changed > 0) {
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: ctx.submission.everApproved ? 'marks.changed_after_approval' : 'marks.saved',
          entityType: 'grade_submission',
          entityId: ctx.submission.id,
          metadata: { changed, reason: reason ?? null },
          ip: a.ip,
        },
        tx,
      );
    }
    return { changed };
  }

  /** Students enrolled in the class at any time during the period (not pending). */
  roster(tx: Tx, tenantId: string, classId: string, start: Date, end: Date) {
    return tx.enrollment.findMany({
      where: {
        tenantId,
        classId,
        status: { not: 'PENDING' },
        enrolledOn: { lte: end },
        OR: [{ leftOn: null }, { leftOn: { gt: start } }],
      },
      include: { student: { select: { matricule: true, firstName: true, lastName: true, dateOfBirth: true } } },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    });
  }

  private async transition(tx: Tx, a: Actor, s: GradeSubmission, to: GradeSubmission['status'], data: Prisma.GradeSubmissionUpdateInput, reason?: string) {
    await tx.gradeSubmission.update({ where: { id: s.id }, data: { ...data, status: to } });
    await this.audit.record(
      {
        tenantId: a.tenantId,
        actorId: a.userId,
        action: `grades.${to.toLowerCase()}`,
        entityType: 'grade_submission',
        entityId: s.id,
        metadata: { from: s.status, to, classSubjectId: s.classSubjectId, periodId: s.periodId, reason: reason ?? null },
        ip: a.ip,
      },
      tx,
    );
  }
}
