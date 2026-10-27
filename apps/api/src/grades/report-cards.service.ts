import { HttpStatus, Injectable } from '@nestjs/common';
import { computeResults, type EngineInput, type GradingRules, type PromotionInput } from '@mboka/shared';
import type { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../community/notifications.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toIso } from '../common/dates';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { GradesService } from './grades.service';
import { renderReportCardsPdf } from './report-card.pdf';

/** What a report card shows; stored verbatim so it can be reproduced and verified later. */
export interface ReportCardContent {
  school: { legalName: string; tradingName: string | null };
  academicYear: string;
  scope: { kind: 'PERIOD' | 'ANNUAL'; label: string; startDate: string; endDate: string };
  class: { code: string; name: string; size: number };
  student: { matricule: string; firstName: string; lastName: string; dateOfBirth: string };
  rules: { version: number; maxScore: number; passMark: number; decimals: number; missingPolicy: string; ranking: string };
  subjects: {
    code: string;
    nameFr: string;
    nameEn: string;
    coefficient: string;
    average: string | null;
    points: string | null;
    rank: number | null;
    classAverage: string | null;
    min: string | null;
    max: string | null;
    teacher: string | null;
    comment: string | null;
  }[];
  totals: { coefficients: string; points: string };
  average: string | null;
  rank: number | null;
  ranked: number;
  mention: { labelFr: string; labelEn: string } | null;
  passed: boolean | null;
  classStats: { average: string | null; min: string | null; max: string | null; passRate: number | null };
  attendance: { absences: number; excused: number; lates: number };
  decision: string | null;
}

const VERIFY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Report cards, publication, verification, promotion decisions and class statistics (GRD-006…015). */
@Injectable()
export class ReportCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly grades: GradesService,
    private readonly notifications: NotificationsService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  // ------------------------------------------------------------ computation

  /**
   * Gathers everything the engine needs for a class and scope. With `requireApproved`, every subject
   * and period that has assessments must be APPROVED (Workflow C: cards come from approved results).
   */
  private async compute(tx: Tx, a: Actor, classId: string, scope: string, requireApproved: boolean) {
    const schoolClass = await tx.schoolClass.findFirst({ where: { id: classId, tenantId: a.tenantId }, include: { academicYear: true } });
    if (!schoolClass) throw Errors.notFound('Class');
    const year = schoolClass.academicYear;

    let range: { start: Date; end: Date; label: string; kind: 'PERIOD' | 'ANNUAL' };
    let periodIds: string[];
    let commentPeriodId: string | null = null;
    if (scope === 'ANNUAL') {
      range = { start: year.startDate, end: year.endDate, label: year.name, kind: 'ANNUAL' };
      periodIds = (await tx.academicPeriod.findMany({ where: { tenantId: a.tenantId, academicYearId: year.id }, select: { id: true } })).map((p) => p.id);
    } else {
      const period = await tx.academicPeriod.findFirst({ where: { id: scope, tenantId: a.tenantId, academicYearId: year.id } });
      if (!period) throw Errors.notFound('Period');
      range = { start: period.startDate, end: period.endDate, label: period.name, kind: 'PERIOD' };
      commentPeriodId = period.id;
      // A term includes the sequences that fall inside it.
      periodIds = (
        await tx.academicPeriod.findMany({
          where: { tenantId: a.tenantId, academicYearId: year.id, startDate: { gte: period.startDate }, endDate: { lte: period.endDate } },
          select: { id: true },
        })
      ).map((p) => p.id);
    }

    const classSubjects = await tx.classSubject.findMany({
      where: { tenantId: a.tenantId, classId },
      include: {
        subject: { select: { code: true, nameFr: true, nameEn: true } },
        assessments: { where: { periodId: { in: periodIds } }, include: { marks: true }, orderBy: { createdAt: 'asc' } },
        submissions: { where: { periodId: { in: periodIds } } },
        assignments: { where: { role: 'MAIN', startDate: { lte: range.end }, OR: [{ endDate: null }, { endDate: { gte: range.start } }] }, include: { staff: true } },
      },
      orderBy: { subject: { code: 'asc' } },
    });

    const pending: { subject: string; period: string; status: string }[] = [];
    for (const cs of classSubjects) {
      const periodsWithWork = new Set(cs.assessments.map((x) => x.periodId));
      for (const pid of periodsWithWork) {
        const status = cs.submissions.find((s) => s.periodId === pid)?.status ?? 'OPEN';
        if (status !== 'APPROVED') pending.push({ subject: cs.subject.code, period: pid, status });
      }
    }
    if (requireApproved && pending.length > 0) {
      throw new ApiException(HttpStatus.CONFLICT, 'GRADES_NOT_APPROVED', `${pending.length} subject sheet(s) are not approved yet`, { pending });
    }

    const roster = await this.grades.roster(tx, a.tenantId, classId, range.start, range.end);
    const current = await this.grades.currentRules(tx, a);
    const input: EngineInput = {
      rules: current.rules,
      studentIds: roster.map((e) => e.studentId),
      subjects: classSubjects
        .filter((cs) => cs.assessments.length > 0)
        .map((cs) => ({
          id: cs.id,
          coefficient: cs.coefficient.toString(),
          assessments: cs.assessments.map((as) => ({
            id: as.id,
            maxScore: as.maxScore.toString(),
            weight: as.weight.toString(),
            marks: Object.fromEntries(as.marks.map((m) => [m.studentId, { score: m.score?.toString() ?? null, status: m.status }])),
          })),
        })),
    };
    const results = computeResults(input);
    return { schoolClass, year, range, commentPeriodId, classSubjects, roster, current, input, results, pending };
  }

  // ------------------------------------------------------------ generation and publication

  generate(a: Actor, classId: string, scope: string) {
    return this.run(a, async (tx) => {
      // One generation per class and scope at a time, so two clicks cannot race on version numbers.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${a.tenantId}:${classId}:${scope}`}))`;
      const c = await this.compute(tx, a, classId, scope, true);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { legalName: true, tradingName: true } });
      const comments = c.commentPeriodId
        ? await tx.subjectComment.findMany({ where: { tenantId: a.tenantId, periodId: c.commentPeriodId, classSubjectId: { in: c.classSubjects.map((cs) => cs.id) } } })
        : [];
      const attendance = await tx.attendanceRecord.groupBy({
        by: ['studentId', 'status'],
        where: { tenantId: a.tenantId, session: { classId, date: { gte: c.range.start, lte: c.range.end } }, status: { in: ['ABSENT', 'EXCUSED', 'LATE'] } },
        _count: { _all: true },
      });
      const decisions =
        c.range.kind === 'ANNUAL'
          ? await tx.promotionDecision.findMany({ where: { tenantId: a.tenantId, academicYearId: c.year.id, enrollmentId: { in: c.roster.map((e) => e.id) } } })
          : [];
      const classHash = sha256(JSON.stringify({ rules: c.current.versionId, input: c.input }));

      let created = 0;
      let unchanged = 0;
      for (const e of c.roster) {
        const r = c.results.students.find((s) => s.studentId === e.studentId)!;
        const count = (status: string) => attendance.find((x) => x.studentId === e.studentId && x.status === status)?._count._all ?? 0;
        const content: ReportCardContent = {
          school: tenant,
          academicYear: c.year.name,
          scope: { kind: c.range.kind, label: c.range.label, startDate: toIso(c.range.start), endDate: toIso(c.range.end) },
          class: { code: c.schoolClass.code, name: c.schoolClass.name, size: c.roster.length },
          student: { matricule: e.student.matricule, firstName: e.student.firstName, lastName: e.student.lastName, dateOfBirth: toIso(e.student.dateOfBirth) },
          rules: {
            version: c.current.version,
            maxScore: c.current.rules.maxScore,
            passMark: c.current.rules.passMark,
            decimals: c.current.rules.decimals,
            missingPolicy: c.current.rules.missingPolicy,
            ranking: c.current.rules.ranking,
          },
          subjects: c.input.subjects.map((s) => {
            const cs = c.classSubjects.find((x) => x.id === s.id)!;
            const mine = r.subjects.find((x) => x.subjectId === s.id)!;
            const stats = c.results.subjects.find((x) => x.subjectId === s.id)!;
            const teacher = cs.assignments[0]?.staff;
            return {
              code: cs.subject.code,
              nameFr: cs.subject.nameFr,
              nameEn: cs.subject.nameEn,
              coefficient: cs.coefficient.toString(),
              average: mine.average,
              points: mine.points,
              rank: mine.rank,
              classAverage: stats.average,
              min: stats.min,
              max: stats.max,
              teacher: teacher ? `${teacher.lastName} ${teacher.firstName}` : null,
              comment: comments.find((x) => x.classSubjectId === cs.id && x.enrollmentId === e.id)?.comment || null,
            };
          }),
          totals: { coefficients: r.totalCoefficients, points: r.totalPoints },
          average: r.average,
          rank: r.rank,
          ranked: c.results.class.ranked,
          mention: r.mention,
          passed: r.passed,
          classStats: { average: c.results.class.average, min: c.results.class.min, max: c.results.class.max, passRate: c.results.class.passRate },
          attendance: { absences: count('ABSENT'), excused: count('EXCUSED'), lates: count('LATE') },
          decision: decisions.find((d) => d.enrollmentId === e.id)?.decision ?? null,
        };
        const inputHash = sha256(`${classHash}:${JSON.stringify({ attendance: content.attendance, comments: content.subjects.map((s) => s.comment), decision: content.decision })}`);
        const latest = await tx.reportCard.findFirst({
          where: { tenantId: a.tenantId, enrollmentId: e.id, scope },
          orderBy: { version: 'desc' },
        });
        if (latest && latest.inputHash === inputHash && latest.schemeVersionId === c.current.versionId) {
          unchanged++;
          continue;
        }
        // Older drafts are replaced; a published card stays visible until its successor is published.
        await tx.reportCard.updateMany({ where: { tenantId: a.tenantId, enrollmentId: e.id, scope, status: 'DRAFT' }, data: { status: 'SUPERSEDED' } });
        await tx.reportCard.create({
          data: {
            tenantId: a.tenantId,
            enrollmentId: e.id,
            studentId: e.studentId,
            classId,
            academicYearId: c.year.id,
            scope,
            version: (latest?.version ?? 0) + 1,
            schemeVersionId: c.current.versionId,
            content: content as unknown as Prisma.InputJsonValue,
            inputHash,
            verificationCode: verificationCode(),
            generatedBy: a.userId,
          },
        });
        created++;
      }
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'report_cards.generated',
          entityType: 'class',
          entityId: classId,
          metadata: { scope, created, unchanged, rulesVersion: c.current.version },
          ip: a.ip,
        },
        tx,
      );
      return { created, unchanged, rulesVersion: c.current.version };
    });
  }

  /** Publishing makes the latest drafts visible to families and supersedes earlier published versions. */
  publish(a: Actor, classId: string, scope: string) {
    return this.run(a, async (tx) => {
      const drafts = await tx.reportCard.findMany({ where: { tenantId: a.tenantId, classId, scope, status: 'DRAFT' } });
      if (drafts.length === 0) throw Errors.conflict('NOTHING_TO_PUBLISH', 'Generate report cards before publishing them');
      for (const d of drafts) {
        await tx.reportCard.updateMany({
          where: { tenantId: a.tenantId, enrollmentId: d.enrollmentId, scope, status: 'PUBLISHED' },
          data: { status: 'SUPERSEDED' },
        });
        await tx.reportCard.update({ where: { id: d.id }, data: { status: 'PUBLISHED', publishedBy: a.userId, publishedAt: new Date() } });
      }
      // Families with a portal account are told a new report card is available (COM-004).
      const families = await this.notifications.guardianUsers(tx, a.tenantId, drafts.map((d) => d.studentId));
      const students = await tx.student.findMany({ where: { tenantId: a.tenantId, id: { in: drafts.map((d) => d.studentId) }, membershipId: { not: null } }, select: { id: true, membershipId: true } });
      const studentUsers = await tx.membership.findMany({ where: { tenantId: a.tenantId, status: 'ACTIVE', id: { in: students.map((s) => s.membershipId!) } }, select: { id: true, userId: true } });
      for (const d of drafts) {
        const content = d.content as unknown as ReportCardContent;
        const own = studentUsers.find((m) => m.id === students.find((s) => s.id === d.studentId)?.membershipId)?.userId;
        await this.notifications.notify(tx, a.tenantId, [...families.filter((f) => f.studentId === d.studentId).map((f) => f.userId), ...(own ? [own] : [])], {
          kind: 'report_card.published',
          title: `Bulletin disponible — ${content.student.firstName}`,
          body: `${content.scope.label} : moyenne ${content.average ?? '—'}${content.rank ? `, rang ${content.rank}/${content.ranked}` : ''}.`,
          link: `/portal/children/${d.studentId}`,
          dedupeKey: `reportcard:${d.id}`,
        });
      }
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'report_cards.published', entityType: 'class', entityId: classId, metadata: { scope, count: drafts.length }, ip: a.ip },
        tx,
      );
      return { published: drafts.length };
    });
  }

  /** Latest card per student for a class and scope. */
  list(a: Actor, classId: string, scope: string) {
    return this.run(a, async (tx) => {
      const cards = await tx.reportCard.findMany({
        where: { tenantId: a.tenantId, classId, scope, status: { not: 'SUPERSEDED' } },
        orderBy: [{ enrollmentId: 'asc' }, { version: 'desc' }],
      });
      const latest = new Map<string, (typeof cards)[number]>();
      for (const card of cards) if (!latest.has(card.enrollmentId)) latest.set(card.enrollmentId, card);
      return [...latest.values()]
        .map((card) => {
          const content = card.content as unknown as ReportCardContent;
          return {
            id: card.id,
            status: card.status,
            version: card.version,
            student: content.student,
            average: content.average,
            rank: content.rank,
            ranked: content.ranked,
            mention: content.mention,
            generatedAt: card.generatedAt.toISOString(),
            publishedAt: card.publishedAt?.toISOString() ?? null,
          };
        })
        .sort((x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9) || x.student.lastName.localeCompare(y.student.lastName));
    });
  }

  get(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const card = await tx.reportCard.findFirst({ where: { id, tenantId: a.tenantId }, include: { schemeVersion: { select: { version: true } } } });
      if (!card) throw Errors.notFound('Report card');
      const versions = await tx.reportCard.findMany({
        where: { tenantId: a.tenantId, enrollmentId: card.enrollmentId, scope: card.scope },
        select: { id: true, version: true, status: true, generatedAt: true },
        orderBy: { version: 'desc' },
      });
      return {
        id: card.id,
        status: card.status,
        version: card.version,
        verificationCode: card.verificationCode,
        rulesVersion: card.schemeVersion.version,
        content: card.content as unknown as ReportCardContent,
        versions: versions.map((v) => ({ ...v, generatedAt: v.generatedAt.toISOString() })),
      };
    });
  }

  async pdf(a: Actor, ids: { cardId?: string; classId?: string; scope?: string }, lang: 'fr' | 'en'): Promise<Buffer> {
    const cards = await this.run(a, async (tx) => {
      if (ids.cardId) {
        const c = await tx.reportCard.findFirst({ where: { id: ids.cardId, tenantId: a.tenantId } });
        if (!c) throw Errors.notFound('Report card');
        return [c];
      }
      const all = await tx.reportCard.findMany({
        where: { tenantId: a.tenantId, classId: ids.classId, scope: ids.scope, status: { not: 'SUPERSEDED' } },
        orderBy: [{ enrollmentId: 'asc' }, { version: 'desc' }],
      });
      const latest = new Map<string, (typeof all)[number]>();
      for (const c of all) if (!latest.has(c.enrollmentId)) latest.set(c.enrollmentId, c);
      return [...latest.values()];
    });
    if (cards.length === 0) throw Errors.notFound('Report card');
    await this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, (tx) =>
      this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'report_cards.exported_pdf', metadata: { count: cards.length, ...ids }, ip: a.ip }, tx),
    );
    return renderReportCardsPdf(
      cards
        .map((c) => ({ content: c.content as unknown as ReportCardContent, code: c.verificationCode, status: c.status, version: c.version }))
        .sort((x, y) => (x.content.rank ?? 1e9) - (y.content.rank ?? 1e9)),
      lang,
    );
  }

  /**
   * Public check of a printed card's code: confirms the essentials without exposing the full record.
   * Drafts are never confirmed; superseded versions are reported as such.
   */
  async verify(code: string) {
    const card = await this.prisma.reportCardVerification(code);
    if (!card || card.status === 'DRAFT') throw Errors.notFound('Report card');
    const content = card.content as unknown as ReportCardContent;
    return {
      valid: card.status === 'PUBLISHED',
      status: card.status,
      version: card.version,
      school: content.school.tradingName ?? content.school.legalName,
      student: `${content.student.lastName} ${content.student.firstName}`,
      matricule: content.student.matricule,
      class: content.class.name,
      academicYear: content.academicYear,
      scope: content.scope.label,
      average: content.average,
      rank: content.rank,
      ranked: content.ranked,
      publishedAt: card.publishedAt?.toISOString() ?? null,
    };
  }

  // ------------------------------------------------------------ promotions and statistics

  /** Proposal from the annual average (≥ pass mark → promoted); the class council confirms (GRD-010). */
  proposePromotions(a: Actor, classId: string) {
    return this.run(a, async (tx) => {
      const c = await this.compute(tx, a, classId, 'ANNUAL', true);
      const existing = await tx.promotionDecision.findMany({ where: { tenantId: a.tenantId, enrollmentId: { in: c.roster.map((e) => e.id) } } });
      return c.roster.map((e) => {
        const r = c.results.students.find((s) => s.studentId === e.studentId)!;
        const saved = existing.find((d) => d.enrollmentId === e.id);
        return {
          enrollmentId: e.id,
          student: { matricule: e.student.matricule, firstName: e.student.firstName, lastName: e.student.lastName },
          annualAverage: r.average,
          rank: r.rank,
          proposed: proposal(r.passed),
          decision: saved?.decision ?? null,
          note: saved?.note ?? null,
        };
      });
    });
  }

  savePromotions(a: Actor, input: PromotionInput) {
    return this.run(a, async (tx) => {
      const c = await this.compute(tx, a, input.classId, 'ANNUAL', true);
      for (const d of input.decisions) {
        const e = c.roster.find((x) => x.id === d.enrollmentId);
        if (!e) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'STUDENT_NOT_IN_CLASS', 'A student is not in this class');
        const r = c.results.students.find((s) => s.studentId === e.studentId)!;
        const data = { decision: d.decision, proposed: proposal(r.passed), annualAverage: r.average, note: d.note, decidedBy: a.userId, decidedAt: new Date() };
        const before = await tx.promotionDecision.findUnique({ where: { tenantId_enrollmentId: { tenantId: a.tenantId, enrollmentId: e.id } } });
        await tx.promotionDecision.upsert({
          where: { tenantId_enrollmentId: { tenantId: a.tenantId, enrollmentId: e.id } },
          create: { tenantId: a.tenantId, enrollmentId: e.id, academicYearId: c.year.id, ...data },
          update: data,
        });
        await this.audit.record(
          {
            tenantId: a.tenantId,
            actorId: a.userId,
            action: 'promotion.decided',
            entityType: 'enrollment',
            entityId: e.id,
            metadata: { from: before?.decision ?? null, to: d.decision, proposed: data.proposed, overridden: d.decision !== data.proposed, note: d.note ?? null },
            ip: a.ip,
          },
          tx,
        );
      }
      return { saved: input.decisions.length };
    });
  }

  /** Class and subject statistics; provisional while some sheets are not approved (GRD-015, REP-005). */
  statistics(a: Actor, classId: string, scope: string) {
    return this.run(a, async (tx) => {
      const c = await this.compute(tx, a, classId, scope, false);
      const rules: GradingRules = c.current.rules;
      return {
        status: c.pending.length === 0 ? 'FINAL' : 'PROVISIONAL',
        pending: c.pending.length,
        rulesVersion: c.current.version,
        passMark: rules.passMark,
        class: c.results.class,
        subjects: c.results.subjects.map((s) => {
          const cs = c.classSubjects.find((x) => x.id === s.subjectId)!;
          return { ...s, subject: cs.subject, coefficient: cs.coefficient.toString() };
        }),
        belowPassMark: c.results.students
          .filter((s) => s.passed === false)
          .map((s) => {
            const e = c.roster.find((x) => x.studentId === s.studentId)!;
            return { studentId: s.studentId, matricule: e.student.matricule, firstName: e.student.firstName, lastName: e.student.lastName, average: s.average, rank: s.rank };
          }),
      };
    });
  }
}

function proposal(passed: boolean | null) {
  return passed ? ('PROMOTED' as const) : ('REPEAT' as const);
}

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

function verificationCode(): string {
  const bytes = randomBytes(10);
  const chars = Array.from(bytes, (b) => VERIFY_ALPHABET[b % VERIFY_ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}
