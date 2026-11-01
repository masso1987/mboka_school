import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { toDate, toIso, todayIn } from '../common/dates';
import { FinanceReportsService } from '../finance/reports.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';

/** Role dashboards (spec §8.3), annual comparison (Module 13) and CSV exports (REP-002/004). */
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly finance: FinanceReportsService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  /** One endpoint; each section is present only if the caller's permissions allow it. */
  async dashboard(a: Actor) {
    const can = (p: string) => a.permissions.has(p);
    const today = todayIn(a.timezone);
    const sections = await this.run(a, async (tx) => {
      const out: Record<string, unknown> = {};
      const year = await tx.academicYear.findFirst({
        where: { tenantId: a.tenantId, startDate: { lte: toDate(today) }, endDate: { gte: toDate(today) } },
        orderBy: { startDate: 'desc' },
      });

      if (can('students.read') && year) {
        const since = new Date(toDate(today).getTime() - 30 * 86_400_000);
        const [enrolled, att] = await Promise.all([
          tx.enrollment.count({ where: { tenantId: a.tenantId, academicYearId: year.id, status: { in: ['ENROLLED', 'REPEATING'] } } }),
          tx.attendanceRecord.groupBy({ by: ['status'], where: { tenantId: a.tenantId, session: { date: { gte: since } } }, _count: { _all: true } }),
        ]);
        const total = att.reduce((n, x) => n + x._count._all, 0);
        const present = att.filter((x) => x.status === 'PRESENT' || x.status === 'LATE').reduce((n, x) => n + x._count._all, 0);
        out.school = { academicYear: year.name, enrolled, attendanceRate30d: total ? Number(((present / total) * 100).toFixed(1)) : null };
      }

      const approvals: Record<string, number> = {};
      if (can('expenses.approve') || can('expenses.approve.unlimited')) approvals.expenses = await tx.expense.count({ where: { tenantId: a.tenantId, status: 'SUBMITTED', submittedBy: { not: a.userId } } });
      if (can('payments.refund.approve')) approvals.refunds = await tx.refund.count({ where: { tenantId: a.tenantId, status: 'REQUESTED', requestedBy: { not: a.userId } } });
      if (can('hr.leave.approve')) approvals.leave = await tx.leaveRequest.count({ where: { tenantId: a.tenantId, status: 'REQUESTED', requestedBy: { not: a.userId } } });
      if (can('grades.approve')) approvals.gradeSheets = await tx.gradeSubmission.count({ where: { tenantId: a.tenantId, status: 'SUBMITTED', submittedBy: { not: a.userId } } });
      if (Object.keys(approvals).length) out.approvals = approvals;

      if (can('payments.record')) {
        const [todayAgg, pending, tills] = await Promise.all([
          tx.payment.aggregate({ where: { tenantId: a.tenantId, status: 'CONFIRMED', receivedOn: toDate(today) }, _sum: { reportingAmount: true }, _count: true }),
          tx.payment.count({ where: { tenantId: a.tenantId, status: 'PENDING_VERIFICATION' } }),
          tx.cashierSession.count({ where: { tenantId: a.tenantId, status: 'OPEN' } }),
        ]);
        out.cashDesk = { collectedToday: todayAgg._sum.reportingAmount?.toString() ?? '0', paymentsToday: todayAgg._count, pendingVerification: pending, openRegisters: tills };
      }

      const staff = await tx.staff.findFirst({ where: { tenantId: a.tenantId, membershipId: a.membershipId } });
      if (staff && (can('attendance.record') || can('grades.enter'))) {
        const weekday = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
        const [lessons, assignments, openSheets] = await Promise.all([
          tx.timetableEntry.findMany({
            where: { tenantId: a.tenantId, staffId: staff.id, weekday, ...(year && { academicYearId: year.id }) },
            include: { schoolClass: { select: { id: true, name: true } }, room: { select: { name: true } } },
            orderBy: { startMinute: 'asc' },
          }),
          tx.teachingAssignment.findMany({
            where: { tenantId: a.tenantId, staffId: staff.id, startDate: { lte: toDate(today) }, OR: [{ endDate: null }, { endDate: { gte: toDate(today) } }] },
            include: { classSubject: { select: { classId: true, schoolClass: { select: { name: true } } } } },
          }),
          tx.gradeSubmission.count({
            where: { tenantId: a.tenantId, status: { in: ['OPEN', 'REOPENED'] }, classSubject: { assignments: { some: { staffId: staff.id, endDate: null } } } },
          }),
        ]);
        const classIds = [...new Set(assignments.map((x) => x.classSubject.classId))];
        const taken = await tx.attendanceSession.findMany({ where: { tenantId: a.tenantId, classId: { in: classIds }, date: toDate(today) }, select: { classId: true } });
        out.teaching = {
          lessonsToday: lessons.map((l) => ({ start: l.startMinute, end: l.endMinute, subject: l.subjectLabel, class: l.schoolClass.name, room: l.room?.name ?? null })),
          registersToTake: classIds
            .filter((id) => !taken.some((x) => x.classId === id))
            .map((id) => ({ classId: id, name: assignments.find((x) => x.classSubject.classId === id)!.classSubject.schoolClass.name })),
          gradeSheetsInProgress: openSheets,
        };
      }
      out.unreadNotifications = await tx.notification.count({ where: { tenantId: a.tenantId, userId: a.userId, readAt: null } });
      return { out, year };
    });

    if (can('reports.financial.read') && sections.year) {
      const s = await this.finance.summary(a, toIso(sections.year.startDate), today);
      sections.out.finance = {
        currency: s.currency,
        billed: s.billed,
        collected: s.collected,
        outstanding: s.outstanding,
        collectionRate: s.collectionRate,
        expenses: s.expenses,
        status: s.status,
      };
    }
    return sections.out;
  }

  /** Year-over-year figures for the director (Module 10 annual dashboard, REP-007). */
  async annualComparison(a: Actor) {
    const today = todayIn(a.timezone);
    const years = await this.run(a, async (tx) => {
      const rows = await tx.academicYear.findMany({ where: { tenantId: a.tenantId, startDate: { lte: toDate(today) } }, orderBy: { startDate: 'asc' } });
      return Promise.all(
        rows.map(async (y) => {
          const end = toIso(y.endDate) < today ? toIso(y.endDate) : today;
          const [enrolled, att, cards] = await Promise.all([
            tx.enrollment.count({ where: { tenantId: a.tenantId, academicYearId: y.id, status: { not: 'PENDING' } } }),
            tx.attendanceRecord.groupBy({ by: ['status'], where: { tenantId: a.tenantId, session: { date: { gte: y.startDate, lte: y.endDate } } }, _count: { _all: true } }),
            tx.reportCard.findMany({ where: { tenantId: a.tenantId, academicYearId: y.id, scope: 'ANNUAL', status: 'PUBLISHED' }, select: { content: true } }),
          ]);
          const total = att.reduce((n, x) => n + x._count._all, 0);
          const present = att.filter((x) => x.status === 'PRESENT' || x.status === 'LATE').reduce((n, x) => n + x._count._all, 0);
          const passed = cards.filter((c) => (c.content as { passed?: boolean }).passed === true).length;
          return {
            id: y.id,
            name: y.name,
            from: toIso(y.startDate),
            to: end,
            complete: toIso(y.endDate) < today,
            enrolled,
            attendanceRate: total ? Number(((present / total) * 100).toFixed(1)) : null,
            passRate: cards.length ? Number(((passed / cards.length) * 100).toFixed(1)) : null,
          };
        }),
      );
    });
    const withFinance = [];
    for (const y of years) {
      const s = a.permissions.has('reports.financial.read') ? await this.finance.summary(a, y.from, y.to) : null;
      withFinance.push({
        ...y,
        ...(s && { currency: s.currency, billed: s.billed, collected: s.collected, expenses: s.expenses, collectionRate: s.collectionRate, operatingResult: s.operatingResult }),
      });
    }
    return {
      years: withFinance,
      basis: 'Finance figures use the same definitions as the financial summary; an ongoing year is measured up to today. Pass rate = published annual report cards with an average at or above the pass mark.',
    };
  }

  // ------------------------------------------------------------ CSV exports

  /**
   * Excel-friendly CSV (UTF-8 BOM, ";" separator). Cells starting with = + - @ are prefixed with
   * an apostrophe so a spreadsheet never executes them (CSV injection). Every export is audited.
   */
  async export(a: Actor, name: 'students' | 'payments' | 'staff' | 'compensation', range?: { from: string; to: string }) {
    const { header, rows } = await this.run(a, async (tx) => {
      switch (name) {
        case 'students': {
          const list = await tx.student.findMany({
            where: { tenantId: a.tenantId, status: { not: 'ARCHIVED' } },
            include: { enrollments: { where: { status: { in: ['ENROLLED', 'REPEATING'] } }, include: { schoolClass: { select: { name: true } } }, take: 1 } },
            orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          });
          return {
            header: ['matricule', 'nom', 'prenom', 'sexe', 'date_naissance', 'lieu_naissance', 'classe', 'statut'],
            rows: list.map((s) => [s.matricule, s.lastName, s.firstName, s.gender ?? '', toIso(s.dateOfBirth), s.placeOfBirth ?? '', s.enrollments[0]?.schoolClass.name ?? '', s.status]),
          };
        }
        case 'payments': {
          const list = await tx.payment.findMany({
            where: { tenantId: a.tenantId, ...(range && { receivedOn: { gte: toDate(range.from), lte: toDate(range.to) } }) },
            include: { student: { select: { matricule: true, lastName: true, firstName: true } }, receipt: { select: { number: true } } },
            orderBy: [{ receivedOn: 'asc' }, { createdAt: 'asc' }],
          });
          return {
            header: ['date', 'recu', 'matricule', 'eleve', 'mode', 'devise', 'montant', 'devise_reporting', 'montant_reporting', 'taux', 'statut', 'reference'],
            rows: list.map((p) => [
              toIso(p.receivedOn),
              p.receipt?.number ?? '',
              p.student.matricule,
              `${p.student.lastName} ${p.student.firstName}`,
              p.method,
              p.currency,
              p.amount.toString(),
              p.reportingCurrency,
              p.reportingAmount.toString(),
              p.reportingRate.toString(),
              p.status,
              p.externalReference ?? '',
            ]),
          };
        }
        case 'staff': {
          // Deliberately no compensation columns (Module 11 AC): see the compensation export.
          const list = await tx.staff.findMany({ where: { tenantId: a.tenantId }, orderBy: [{ lastName: 'asc' }] });
          return {
            header: ['matricule', 'nom', 'prenom', 'fonction', 'enseignant', 'contrat', 'statut', 'date_embauche', 'telephone', 'email'],
            rows: list.map((s) => [s.staffNumber, s.lastName, s.firstName, s.position, s.isTeacher ? 'oui' : 'non', s.employmentType, s.status, s.hireDate ? toIso(s.hireDate) : '', s.phone ?? '', s.email ?? '']),
          };
        }
        case 'compensation': {
          const list = await tx.compensation.findMany({ where: { tenantId: a.tenantId }, include: { staff: { select: { staffNumber: true, lastName: true, firstName: true } } }, orderBy: [{ staffId: 'asc' }, { effectiveFrom: 'asc' }] });
          return {
            header: ['matricule', 'nom', 'prenom', 'effectif_au', 'devise', 'salaire_base', 'indemnites'],
            rows: list.map((c) => [
              c.staff.staffNumber,
              c.staff.lastName,
              c.staff.firstName,
              toIso(c.effectiveFrom),
              c.currency,
              c.baseSalary.toString(),
              (c.allowances as { label: string; amount: string }[]).map((x) => `${x.label}=${x.amount}`).join(' | '),
            ]),
          };
        }
      }
    });
    await this.run(a, (tx) =>
      this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: `export.${name}`, metadata: { rows: rows.length, ...(range ?? {}) }, ip: a.ip }, tx),
    );
    const cell = (v: string) => {
      const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
      return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return '﻿' + [header, ...rows].map((r) => r.map((v) => cell(String(v))).join(';')).join('\r\n') + '\r\n';
  }
}
