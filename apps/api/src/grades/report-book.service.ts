import { HttpStatus, Injectable } from '@nestjs/common';
import { SchoolProfileService } from '../admin/school-profile.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toIso } from '../common/dates';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { CompetencesService } from './competences.service';
import { renderReportBooksPdf, type BookPupil, type PrimaryBook, type SequenceBook, type TermSummary } from './report-book.pdf';
import type { ReportCardContent } from './report-cards.service';

type Lang = 'fr' | 'en';
type Layout = 'PRIMARY_BOOKLET' | 'SEQUENCE_BOOK';

/**
 * Report books (Phase 8): gathers a class's pupils, their results and remarks, the school's letterhead, and renders
 * the layout the school chose. Competence classes print the MINEDUB primary booklet; subject classes the sequence
 * book, built from their report cards (per term and annual).
 */
@Injectable()
export class ReportBookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: SchoolProfileService,
    private readonly competences: CompetencesService,
  ) {}

  async pdf(a: Actor, target: { classId: string } | { enrollmentId: string }, lang: Lang, layoutParam?: Layout) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, async (tx) => {
      let classId: string;
      let only: string | undefined;
      if ('enrollmentId' in target) {
        const e = await tx.enrollment.findFirst({ where: { id: target.enrollmentId, tenantId: a.tenantId }, select: { classId: true } });
        if (!e) throw Errors.notFound('Enrollment');
        classId = e.classId;
        only = target.enrollmentId;
      } else classId = target.classId;

      const schoolClass = await tx.schoolClass.findFirst({
        where: { id: classId, tenantId: a.tenantId },
        include: { academicYear: true, level: { select: { markingSystem: true } } },
      });
      if (!schoolClass) throw Errors.notFound('Class');
      const letterhead = await this.profiles.letterhead(tx, a.tenantId);
      const layout: Layout = layoutParam ?? (schoolClass.level.markingSystem === 'COMPETENCES' ? 'PRIMARY_BOOKLET' : letterhead.profile.reportBook);
      if (layout === 'PRIMARY_BOOKLET' && schoolClass.level.markingSystem !== 'COMPETENCES') {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'NOT_COMPETENCE_CLASS', 'This class is not marked by competences; print its sequence book');
      }

      const terms = await tx.academicPeriod.findMany({ where: { tenantId: a.tenantId, academicYearId: schoolClass.academicYearId, kind: 'TERM' }, orderBy: { position: 'asc' } });
      const enrollments = await tx.enrollment.findMany({
        where: { tenantId: a.tenantId, classId, ...(only ? { id: only } : { status: 'ENROLLED' }) },
        include: { student: true },
        orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
      });
      const decisions = new Map(
        (await tx.promotionDecision.findMany({ where: { tenantId: a.tenantId, enrollmentId: { in: enrollments.map((e) => e.id) } } })).map((d) => [d.enrollmentId, d.decision as string]),
      );
      const pupil = (e: (typeof enrollments)[number]): BookPupil => ({
        firstName: e.student.firstName,
        lastName: e.student.lastName,
        matricule: e.student.matricule,
        dateOfBirth: toIso(e.student.dateOfBirth),
        placeOfBirth: e.student.placeOfBirth,
        region: e.student.region,
        division: e.student.division,
        subDivision: e.student.subDivision,
        healthStatus: e.student.healthStatus,
        className: schoolClass.name,
        academicYear: schoolClass.academicYear.name,
      });

      const books = layout === 'PRIMARY_BOOKLET'
        ? await this.primaryBooks(tx, a, classId, enrollments.map((e) => e.id), terms, lang, pupil, enrollments, decisions)
        : await this.sequenceBooks(tx, a, classId, enrollments, terms, lang, pupil, decisions);
      const file = await renderReportBooksPdf(letterhead, books, lang);
      const name = only ? `livret-${enrollments[0]?.student.matricule ?? 'eleve'}.pdf` : `livrets-${schoolClass.code}.pdf`;
      return { file, name };
    });
  }

  private async primaryBooks(
    tx: Tx,
    a: Actor,
    classId: string,
    ids: string[],
    terms: { startDate: Date; endDate: Date }[],
    lang: Lang,
    pupil: (e: never) => BookPupil,
    enrollments: { id: string }[],
    decisions: Map<string, string>,
  ): Promise<PrimaryBook[]> {
    const { competences, engine } = await this.competences.results(tx, a, classId);
    const remarks = await tx.reportBookEntry.findMany({ where: { tenantId: a.tenantId, enrollmentId: { in: ids } } });
    return enrollments.map((e) => {
      const r = engine.students.find((s) => s.studentId === e.id)!;
      const remark = (term: number) => remarks.find((x) => x.enrollmentId === e.id && x.term === term);
      const summary = (term: number, s: { total: string | null; max: string | null; average: string | null; rank: number | null }): TermSummary => ({
        ...s,
        closing: terms[term - 1] ? toIso(terms[term - 1]!.endDate) : null,
        reopening: terms[term] ? toIso(terms[term]!.startDate) : null,
        teacherRemark: remark(term)?.teacherRemark ?? null,
        headRemark: remark(term)?.headRemark ?? null,
        conduct: remark(term)?.conduct ?? null,
      });
      return {
        kind: 'PRIMARY' as const,
        pupil: pupil(e as never),
        classSize: engine.classSize,
        grandMax: engine.grandMax,
        competences: competences.map((c) => ({
          code: c.code,
          name: lang === 'en' ? c.nameEn : c.nameFr,
          max: String(c.components.reduce((s, x) => s + Number(x.max), 0)),
          components: c.components,
          terms: r.competences[c.id] ?? {},
          annual: r.annualCompetences[c.id] ?? { total: null, appreciation: null },
        })),
        terms: { 1: summary(1, r.terms[1]!), 2: summary(2, r.terms[2]!), 3: summary(3, r.terms[3]!) },
        annual: { ...summary(0, r.annual), closing: null, reopening: null, decision: decisions.get(e.id) ?? null },
      };
    });
  }

  private async sequenceBooks(
    tx: Tx,
    a: Actor,
    classId: string,
    enrollments: { id: string }[],
    terms: { id: string; name: string }[],
    lang: Lang,
    pupil: (e: never) => BookPupil,
    decisions: Map<string, string>,
  ): Promise<SequenceBook[]> {
    // The latest card per pupil and scope (term id or ANNUAL), published or draft.
    const cards = await tx.reportCard.findMany({
      where: { tenantId: a.tenantId, classId, enrollmentId: { in: enrollments.map((e) => e.id) }, status: { not: 'SUPERSEDED' } },
      orderBy: { version: 'desc' },
    });
    const cardOf = (enrollmentId: string, scope: string) => cards.find((c) => c.enrollmentId === enrollmentId && c.scope === scope)?.content as ReportCardContent | undefined;
    const classSubjects = await tx.classSubject.findMany({ where: { tenantId: a.tenantId, classId }, include: { subject: true }, orderBy: { subject: { code: 'asc' } } });
    return enrollments.map((e) => {
      const termCards = terms.map((t) => cardOf(e.id, t.id));
      const annual = cardOf(e.id, 'ANNUAL');
      const rules = annual?.rules ?? termCards.find(Boolean)?.rules;
      return {
        kind: 'SEQUENCE' as const,
        pupil: pupil(e as never),
        classSize: annual?.class.size ?? termCards.find(Boolean)?.class.size ?? enrollments.length,
        passMark: rules?.passMark ?? 10,
        maxScore: rules?.maxScore ?? 20,
        termLabels: terms.map((t) => t.name),
        subjects: classSubjects.map((cs) => ({
          code: cs.subject.code,
          name: (lang === 'en' ? cs.subject.nameEn : cs.subject.nameFr) || cs.subject.code,
          coefficient: cs.coefficient.toString(),
          terms: termCards.map((c) => c?.subjects.find((s) => s.code === cs.subject.code)?.average ?? null),
          annual: annual?.subjects.find((s) => s.code === cs.subject.code)?.average ?? null,
        })),
        terms: termCards.map((c) => ({ average: c?.average ?? null, rank: c?.rank ?? null, ranked: c?.ranked ?? 0 })),
        annual: { average: annual?.average ?? null, rank: annual?.rank ?? null, ranked: annual?.ranked ?? 0, total: annual?.totals.points ?? null, decision: decisions.get(e.id) ?? annual?.decision ?? null },
      };
    });
  }
}
