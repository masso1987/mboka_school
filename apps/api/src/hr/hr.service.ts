import { HttpStatus, Injectable } from '@nestjs/common';
import {
  workingDays,
  type CompensationInput,
  type ContractInput,
  type EntitlementInput,
  type LeaveDecisionInput,
  type LeaveRequestInput,
} from '@mboka/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toDate, toIso, toIsoOrNull, todayIn } from '../common/dates';
import { NotificationsService } from '../community/notifications.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const staffName = { select: { id: true, staffNumber: true, firstName: true, lastName: true } } as const;

/** Contracts, compensation history and leave (Module 11: HR-002…010). */
@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  private async staffOrThrow(tx: Tx, a: Actor, staffId: string) {
    const s = await tx.staff.findFirst({ where: { id: staffId, tenantId: a.tenantId } });
    if (!s) throw Errors.notFound('Staff member');
    return s;
  }

  // ------------------------------------------------------------ contracts

  listContracts(a: Actor, staffId?: string) {
    return this.run(a, async (tx) => {
      const rows = await tx.employmentContract.findMany({
        where: { tenantId: a.tenantId, ...(staffId && { staffId }) },
        include: { staff: staffName },
        orderBy: [{ startDate: 'desc' }],
      });
      return rows.map((c) => ({ id: c.id, staff: c.staff, type: c.type, position: c.position, startDate: toIso(c.startDate), endDate: toIsoOrNull(c.endDate), notes: c.notes }));
    });
  }

  createContract(a: Actor, input: ContractInput) {
    return this.run(a, async (tx) => {
      await this.staffOrThrow(tx, a, input.staffId);
      const c = await tx.employmentContract.create({
        data: {
          tenantId: a.tenantId,
          staffId: input.staffId,
          type: input.type,
          position: input.position,
          startDate: toDate(input.startDate),
          endDate: input.endDate ? toDate(input.endDate) : null,
          notes: input.notes,
          createdBy: a.userId,
        },
      });
      await tx.staff.update({ where: { id: input.staffId }, data: { employmentType: input.type, position: input.position } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'contract.created', entityType: 'staff', entityId: input.staffId, metadata: { contractId: c.id, type: input.type, endDate: input.endDate ?? null }, ip: a.ip }, tx);
      return { id: c.id };
    });
  }

  /** Latest contract per active staff member ending within `days` (HR-010 contract-expiry alerts). */
  expiringContracts(a: Actor, days: number) {
    return this.run(a, async (tx) => {
      const today = todayIn(a.timezone);
      const limit = new Date(toDate(today).getTime() + days * 86_400_000);
      const rows = await tx.employmentContract.findMany({
        where: { tenantId: a.tenantId, endDate: { gte: toDate(today), lte: limit }, staff: { status: 'ACTIVE' } },
        include: { staff: staffName },
        orderBy: { endDate: 'asc' },
      });
      const newer = await tx.employmentContract.findMany({
        where: { tenantId: a.tenantId, staffId: { in: rows.map((r) => r.staffId) } },
        select: { staffId: true, startDate: true },
      });
      return rows
        .filter((r) => !newer.some((n) => n.staffId === r.staffId && n.startDate > r.startDate))
        .map((r) => ({
          id: r.id,
          staff: r.staff,
          type: r.type,
          endDate: toIso(r.endDate!),
          daysLeft: Math.round((r.endDate!.getTime() - toDate(today).getTime()) / 86_400_000),
        }));
    });
  }

  // ------------------------------------------------------------ compensation (confidential)

  listCompensation(a: Actor, staffId: string) {
    return this.run(a, async (tx) => {
      await this.staffOrThrow(tx, a, staffId);
      const rows = await tx.compensation.findMany({ where: { tenantId: a.tenantId, staffId }, orderBy: { effectiveFrom: 'desc' } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'compensation.viewed', entityType: 'staff', entityId: staffId, ip: a.ip }, tx);
      return rows.map((c) => ({ id: c.id, effectiveFrom: toIso(c.effectiveFrom), currency: c.currency, baseSalary: c.baseSalary.toString(), allowances: c.allowances }));
    });
  }

  /** A salary change is a new row from its effective date; history is never rewritten (insert-only grant). */
  recordCompensation(a: Actor, input: CompensationInput) {
    return this.run(a, async (tx) => {
      await this.staffOrThrow(tx, a, input.staffId);
      const c = await tx.compensation.create({
        data: {
          tenantId: a.tenantId,
          staffId: input.staffId,
          effectiveFrom: toDate(input.effectiveFrom),
          currency: input.currency,
          baseSalary: new Prisma.Decimal(input.baseSalary),
          allowances: input.allowances as unknown as Prisma.InputJsonValue,
          createdBy: a.userId,
        },
      });
      // Amounts stay out of the audit log on purpose (confidential): only the fact of the change.
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'compensation.recorded', entityType: 'staff', entityId: input.staffId, metadata: { effectiveFrom: input.effectiveFrom }, ip: a.ip }, tx);
      return { id: c.id };
    });
  }

  // ------------------------------------------------------------ leave

  setEntitlement(a: Actor, input: EntitlementInput) {
    return this.run(a, async (tx) => {
      await this.staffOrThrow(tx, a, input.staffId);
      await tx.leaveEntitlement.upsert({
        where: { tenantId_staffId_year: { tenantId: a.tenantId, staffId: input.staffId, year: input.year } },
        create: { tenantId: a.tenantId, ...input },
        update: { days: input.days },
      });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'leave.entitlement_set', entityType: 'staff', entityId: input.staffId, metadata: { year: input.year, days: input.days }, ip: a.ip }, tx);
      return { ...input };
    });
  }

  /** Annual-leave balance for a year: entitlement − approved − pending (pending is reserved). */
  private async balance(tx: Tx, a: Actor, staffId: string, year: number) {
    const ent = await tx.leaveEntitlement.findUnique({ where: { tenantId_staffId_year: { tenantId: a.tenantId, staffId, year } } });
    const used = await tx.leaveRequest.groupBy({
      by: ['status'],
      where: { tenantId: a.tenantId, staffId, type: 'ANNUAL', status: { in: ['APPROVED', 'REQUESTED'] }, startDate: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) } },
      _sum: { days: true },
    });
    const approved = used.find((u) => u.status === 'APPROVED')?._sum.days ?? 0;
    const pending = used.find((u) => u.status === 'REQUESTED')?._sum.days ?? 0;
    const entitled = ent?.days ?? 0;
    return { year, entitled, approved, pending, remaining: entitled - approved - pending };
  }

  balances(a: Actor, year: number) {
    return this.run(a, async (tx) => {
      const staff = await tx.staff.findMany({ where: { tenantId: a.tenantId, status: 'ACTIVE' }, select: { id: true, staffNumber: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } });
      return Promise.all(staff.map(async (s) => ({ staff: s, ...(await this.balance(tx, a, s.id, year)) })));
    });
  }

  request(a: Actor, input: LeaveRequestInput) {
    return this.run(a, async (tx) => {
      const own = await tx.staff.findFirst({ where: { tenantId: a.tenantId, membershipId: a.membershipId } });
      const staffId = input.staffId ?? own?.id;
      if (!staffId) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'NOT_STAFF', 'Your account is not linked to a staff record');
      if (staffId !== own?.id && !a.permissions.has('hr.leave.approve')) throw Errors.forbidden('You can only request leave for yourself');
      await this.staffOrThrow(tx, a, staffId);
      const days = workingDays(input.startDate, input.endDate);
      if (days === 0) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'NO_WORKING_DAYS', 'The range contains no working day');
      const overlap = await tx.leaveRequest.count({
        where: { tenantId: a.tenantId, staffId, status: { in: ['REQUESTED', 'APPROVED'] }, startDate: { lte: toDate(input.endDate) }, endDate: { gte: toDate(input.startDate) } },
      });
      if (overlap) throw Errors.conflict('LEAVE_OVERLAP', 'This period overlaps another leave request');
      if (input.type === 'ANNUAL') {
        const b = await this.balance(tx, a, staffId, Number(input.startDate.slice(0, 4)));
        if (days > b.remaining) {
          throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'INSUFFICIENT_LEAVE_BALANCE', `Only ${b.remaining} day(s) of annual leave remain`, b);
        }
      }
      const r = await tx.leaveRequest.create({
        data: { tenantId: a.tenantId, staffId, type: input.type, startDate: toDate(input.startDate), endDate: toDate(input.endDate), days, reason: input.reason, requestedBy: a.userId },
      });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'leave.requested', entityType: 'leave_request', entityId: r.id, metadata: { staffId, type: input.type, days }, ip: a.ip }, tx);
      return { id: r.id, days, status: r.status };
    });
  }

  /** Neither the requester nor the person on leave may decide (§3.3); the decision is notified. */
  decide(a: Actor, id: string, input: LeaveDecisionInput) {
    return this.run(a, async (tx) => {
      await tx.$queryRaw`SELECT id FROM leave_requests WHERE id = ${id}::uuid AND tenant_id = ${a.tenantId}::uuid FOR UPDATE`;
      const r = await tx.leaveRequest.findFirst({ where: { id, tenantId: a.tenantId }, include: { staff: true } });
      if (!r) throw Errors.notFound('Leave request');
      if (r.status !== 'REQUESTED') throw Errors.conflict('LEAVE_ALREADY_DECIDED', 'This request has already been decided');
      if (r.requestedBy === a.userId || r.staff.membershipId === a.membershipId) throw Errors.forbidden('You cannot decide on your own leave');
      const status = input.approve ? 'APPROVED' : 'REJECTED';
      await tx.leaveRequest.update({ where: { id }, data: { status, decidedBy: a.userId, decidedAt: new Date(), decisionNote: input.note } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: `leave.${status.toLowerCase()}`, entityType: 'leave_request', entityId: id, metadata: { note: input.note ?? null }, ip: a.ip }, tx);
      await this.notifications.notify(tx, a.tenantId, [r.requestedBy], {
        kind: 'leave.decided',
        title: status === 'APPROVED' ? 'Congé approuvé' : 'Congé refusé',
        body: `${toIso(r.startDate)} → ${toIso(r.endDate)} (${r.days} j)${input.note ? ` — ${input.note}` : ''}`,
        link: '/hr',
      });
      return { id, status };
    });
  }

  cancel(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const r = await tx.leaveRequest.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!r) throw Errors.notFound('Leave request');
      if (r.requestedBy !== a.userId) throw Errors.forbidden('Only the requester can cancel');
      if (r.status !== 'REQUESTED') throw Errors.conflict('LEAVE_ALREADY_DECIDED', 'This request has already been decided');
      await tx.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'leave.cancelled', entityType: 'leave_request', entityId: id, ip: a.ip }, tx);
      return { id, status: 'CANCELLED' as const };
    });
  }

  /** Own requests; everyone's with hr.staff.read or hr.leave.approve. */
  listLeave(a: Actor, status?: string) {
    return this.run(a, async (tx) => {
      const seeAll = a.permissions.has('hr.staff.read') || a.permissions.has('hr.leave.approve');
      const rows = await tx.leaveRequest.findMany({
        where: { tenantId: a.tenantId, ...(status && { status: status as 'REQUESTED' }), ...(!seeAll && { requestedBy: a.userId }) },
        include: { staff: staffName },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.map((r) => ({
        id: r.id,
        staff: r.staff,
        type: r.type,
        startDate: toIso(r.startDate),
        endDate: toIso(r.endDate),
        days: r.days,
        reason: r.reason,
        status: r.status,
        isMine: r.requestedBy === a.userId,
        decisionNote: r.decisionNote,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }
}
