import { Injectable } from '@nestjs/common';
import { hhmmFromMinutes, type PortalAccessInput } from '@mboka/shared';
import { AuditService } from '../audit/audit.service';
import { generateTemporaryPassword, hashPassword } from '../auth/password';
import type { Actor } from '../common/actor';
import { Errors } from '../common/api-error';
import { toDate, toIso, todayIn } from '../common/dates';
import { BillingService } from '../finance/billing.service';
import { ReportCardsService, type ReportCardContent } from '../grades/report-cards.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { identityOf } from './audience';

/**
 * Parent and student portals (Module 12). A parent sees only linked children, a student only
 * themself: every read goes through `assertCanSee`, and anything else answers 404 so ids cannot
 * be probed (Module 12 AC: "a guardian can access only linked students").
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
    private readonly cards: ReportCardsService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  // ------------------------------------------------------------ granting access (staff side)

  /** Creates (or reuses) the account, adds the parent/student role and links it. Revocable without touching the record. */
  grant(a: Actor, kind: 'guardian' | 'student', id: string, input: PortalAccessInput) {
    return this.run(a, async (tx) => {
      const entity =
        kind === 'guardian'
          ? await tx.guardian.findFirst({ where: { id, tenantId: a.tenantId }, select: { id: true, membershipId: true, firstName: true, lastName: true } })
          : await tx.student.findFirst({ where: { id, tenantId: a.tenantId }, select: { id: true, membershipId: true, firstName: true, lastName: true } });
      if (!entity) throw Errors.notFound(kind === 'guardian' ? 'Guardian' : 'Student');
      if (entity.membershipId) {
        const m = await tx.membership.findFirst({ where: { id: entity.membershipId, tenantId: a.tenantId } });
        if (m?.status === 'ACTIVE') throw Errors.conflict('PORTAL_ALREADY_ENABLED', 'This person already has portal access');
      }
      let user = await tx.user.findUnique({ where: { email: input.email } });
      let temporaryPassword: string | undefined;
      if (!user) {
        temporaryPassword = generateTemporaryPassword();
        user = await tx.user.create({
          data: { email: input.email, fullName: input.fullName ?? `${entity.firstName} ${entity.lastName}`, passwordHash: await hashPassword(temporaryPassword) },
        });
      }
      const existing = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: a.tenantId, userId: user.id } } });
      if (existing?.status === 'ACTIVE') throw Errors.conflict('ALREADY_MEMBER', 'This email already belongs to a member of the school');
      const membership = existing
        ? await tx.membership.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } })
        : await tx.membership.create({ data: { tenantId: a.tenantId, userId: user.id } });
      const role = await tx.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId: a.tenantId, key: kind === 'guardian' ? 'parent' : 'student' } } });
      await tx.userRoleAssignment.deleteMany({ where: { tenantId: a.tenantId, membershipId: membership.id } });
      await tx.userRoleAssignment.create({ data: { tenantId: a.tenantId, membershipId: membership.id, roleId: role.id } });
      if (kind === 'guardian') await tx.guardian.update({ where: { id }, data: { membershipId: membership.id } });
      else await tx.student.update({ where: { id }, data: { membershipId: membership.id } });
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: `portal.${kind}_granted`, entityType: kind, entityId: id, metadata: { email: input.email, newAccount: Boolean(temporaryPassword) }, ip: a.ip },
        tx,
      );
      return { membershipId: membership.id, temporaryPassword };
    });
  }

  revoke(a: Actor, kind: 'guardian' | 'student', id: string) {
    return this.run(a, async (tx) => {
      const entity =
        kind === 'guardian'
          ? await tx.guardian.findFirst({ where: { id, tenantId: a.tenantId }, select: { membershipId: true } })
          : await tx.student.findFirst({ where: { id, tenantId: a.tenantId }, select: { membershipId: true } });
      if (!entity?.membershipId) throw Errors.notFound('Portal access');
      await tx.membership.update({ where: { id: entity.membershipId }, data: { status: 'REVOKED' } });
      if (kind === 'guardian') await tx.guardian.update({ where: { id }, data: { membershipId: null } });
      else await tx.student.update({ where: { id }, data: { membershipId: null } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: `portal.${kind}_revoked`, entityType: kind, entityId: id, ip: a.ip }, tx);
      return { revoked: true };
    });
  }

  // ------------------------------------------------------------ portal reads (family side)

  children(a: Actor) {
    return this.run(a, async (tx) => {
      const me = await identityOf(tx, a.tenantId, a.membershipId);
      const students = await tx.student.findMany({
        where: { tenantId: a.tenantId, id: { in: me.studentIds } },
        select: {
          id: true,
          matricule: true,
          firstName: true,
          lastName: true,
          enrollments: { where: { status: { in: ['ENROLLED', 'REPEATING'] } }, select: { schoolClass: { select: { id: true, name: true } } }, take: 1 },
        },
        orderBy: { firstName: 'asc' },
      });
      return students.map((s) => ({ id: s.id, matricule: s.matricule, firstName: s.firstName, lastName: s.lastName, class: s.enrollments[0]?.schoolClass ?? null }));
    });
  }

  async summary(a: Actor, studentId: string) {
    const base = await this.run(a, async (tx) => {
      await this.assertCanSee(tx, a, studentId);
      const student = await tx.student.findFirstOrThrow({
        where: { id: studentId, tenantId: a.tenantId },
        select: { id: true, matricule: true, firstName: true, lastName: true, dateOfBirth: true },
      });
      const enrollment = await tx.enrollment.findFirst({
        where: { tenantId: a.tenantId, studentId, status: { in: ['ENROLLED', 'REPEATING'] } },
        include: { schoolClass: { select: { id: true, name: true, academicYearId: true } } },
      });
      const today = todayIn(a.timezone);
      const since = new Date(toDate(today).getTime() - 30 * 86_400_000);
      const attendance = await tx.attendanceRecord.findMany({
        where: { tenantId: a.tenantId, studentId, session: { date: { gte: since } } },
        include: { session: { select: { date: true } } },
        orderBy: { session: { date: 'desc' } },
      });
      const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 } as Record<string, number>;
      for (const r of attendance) counts[r.status] = (counts[r.status] ?? 0) + 1;
      const cards = await tx.reportCard.findMany({
        where: { tenantId: a.tenantId, studentId, status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
      });
      const timetable = enrollment
        ? await tx.timetableEntry.findMany({
            where: { tenantId: a.tenantId, classId: enrollment.classId, academicYearId: enrollment.schoolClass.academicYearId },
            include: { staff: { select: { firstName: true, lastName: true } }, room: { select: { name: true } } },
            orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
          })
        : [];
      return {
        student: { ...student, dateOfBirth: toIso(student.dateOfBirth) },
        class: enrollment?.schoolClass ? { id: enrollment.schoolClass.id, name: enrollment.schoolClass.name } : null,
        attendance: {
          since: toIso(since),
          counts,
          recent: attendance.filter((r) => r.status !== 'PRESENT').slice(0, 10).map((r) => ({ date: toIso(r.session.date), status: r.status, arrivalTime: r.arrivalTime })),
        },
        reportCards: cards.map((c) => {
          const content = c.content as unknown as ReportCardContent;
          return { id: c.id, scope: content.scope.label, academicYear: content.academicYear, average: content.average, rank: content.rank, ranked: content.ranked, mention: content.mention, publishedAt: c.publishedAt?.toISOString() ?? null };
        }),
        timetable: timetable.map((e) => ({
          weekday: e.weekday,
          startTime: hhmmFromMinutes(e.startMinute),
          endTime: hhmmFromMinutes(e.endMinute),
          subject: e.subjectLabel,
          teacher: e.staff ? `${e.staff.lastName} ${e.staff.firstName}` : null,
          room: e.room?.name ?? null,
        })),
      };
    });
    // Balances and receipts come from the finance module's statement (same figures as the school sees).
    const statement = await this.billing.statement(a, studentId);
    return {
      ...base,
      fees: {
        balances: statement.balances,
        payments: statement.payments
          .filter((p) => p.status === 'CONFIRMED' || p.status === 'REVERSED')
          .slice(0, 10)
          .map((p) => ({ id: p.id, receivedOn: p.receivedOn, amount: p.amount, currency: p.currency, receipt: p.receipt, status: p.status })),
      },
    };
  }

  /** PDF of a published card of a child (or of oneself); drafts and superseded cards are never served. */
  async reportCardPdf(a: Actor, studentId: string, cardId: string, lang: 'fr' | 'en') {
    await this.run(a, async (tx) => {
      await this.assertCanSee(tx, a, studentId);
      const card = await tx.reportCard.findFirst({ where: { id: cardId, tenantId: a.tenantId, studentId, status: 'PUBLISHED' }, select: { id: true } });
      if (!card) throw Errors.notFound('Report card');
    });
    return this.cards.pdf(a, { cardId }, lang);
  }

  /** The single gate of every portal read. */
  private async assertCanSee(tx: Tx, a: Actor, studentId: string) {
    const isParent = a.permissions.has('portal.parent');
    const isStudent = a.permissions.has('portal.student');
    if (!isParent && !isStudent) throw Errors.notFound('Student');
    const me = await identityOf(tx, a.tenantId, a.membershipId);
    if (!me.studentIds.includes(studentId)) throw Errors.notFound('Student');
    if (!isParent && me.studentId !== studentId) throw Errors.notFound('Student');
  }
}
