import { HttpStatus, Injectable } from '@nestjs/common';
import type { ApplyScheduleInput, DiscountInput, FeeCategoryInput, FeeScheduleInput, ReasonInput, SubscribeServicesInput } from '@mboka/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toDate, toIso, toIsoOrNull } from '../common/dates';
import { guardDb } from '../common/db-errors';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { FinanceCore, sum, ZERO, type InvoiceBalance } from './finance-core';

const ACTIVE_ENROLLMENT = ['ENROLLED', 'REPEATING'] as const;

/** Fee categories and schedules, invoices, discounts and student statements (FIN-001…005, 012, 016). */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly core: FinanceCore,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  // ------------------------------------------------------------ categories

  listCategories(a: Actor) {
    return this.run(a, (tx) => tx.feeCategory.findMany({ where: { tenantId: a.tenantId }, orderBy: { code: 'asc' } }));
  }

  createCategory(a: Actor, input: FeeCategoryInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const c = await tx.feeCategory.create({ data: { tenantId: a.tenantId, ...input } });
        await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'fee_category.created', entityType: 'fee_category', entityId: c.id, ip: a.ip }, tx);
        return c;
      }),
      { FeeCategory: () => Errors.conflict('CODE_TAKEN', 'Fee category code already in use') },
    );
  }

  // ------------------------------------------------------------ schedules

  listSchedules(a: Actor, academicYearId?: string) {
    return this.run(a, async (tx) => {
      const rows = await tx.feeSchedule.findMany({
        where: { tenantId: a.tenantId, ...(academicYearId && { academicYearId }) },
        include: {
          category: { select: { code: true, nameFr: true, nameEn: true, kind: true } },
          installments: { orderBy: { position: 'asc' } },
          _count: { select: { assignments: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return Promise.all(
        rows.map(async (s) => ({
          id: s.id,
          academicYearId: s.academicYearId,
          name: s.name,
          currency: s.currency,
          amount: await this.core.format(tx, s.amount, s.currency),
          levelId: s.levelId,
          classId: s.classId,
          isActive: s.isActive,
          optional: s.isOptional,
          category: s.category,
          billedCount: s._count.assignments,
          installments: await Promise.all(
            s.installments.map(async (i) => ({ label: i.label, dueDate: toIso(i.dueDate), amount: await this.core.format(tx, i.amount, s.currency) })),
          ),
        })),
      );
    });
  }

  createSchedule(a: Actor, input: FeeScheduleInput) {
    return guardDb(
      this.run(a, async (tx) => {
        await this.core.assertEnabled(tx, a.tenantId, input.currency);
        const amounts = await Promise.all(input.installments.map((i) => this.core.amount(tx, i.amount, input.currency)));
        const total = sum(amounts);
        const schedule = await tx.feeSchedule.create({
          data: {
            tenantId: a.tenantId,
            academicYearId: input.academicYearId,
            categoryId: input.categoryId,
            name: input.name,
            currency: input.currency,
            amount: total,
            levelId: input.levelId,
            classId: input.classId,
            isOptional: input.optional,
            installments: {
              create: input.installments.map((i, n) => ({
                position: n + 1,
                label: i.label,
                dueDate: toDate(i.dueDate),
                amount: amounts[n]!,
              })),
            },
          },
        });
        await this.audit.record(
          {
            tenantId: a.tenantId,
            actorId: a.userId,
            action: 'fee_schedule.created',
            entityType: 'fee_schedule',
            entityId: schedule.id,
            metadata: { name: input.name, currency: input.currency, total: total.toString(), installments: input.installments.length, optional: input.optional },
            ip: a.ip,
          },
          tx,
        );
        return { id: schedule.id, amount: await this.core.format(tx, total, input.currency) };
      }),
    );
  }

  /**
   * Bills a schedule to every matching active enrollment that has not received it yet:
   * one invoice per student, one line per installment. Running it again bills only
   * newcomers, never twice (Module 2 AC: re-running cannot duplicate invoices).
   */
  applySchedule(a: Actor, scheduleId: string, input: ApplyScheduleInput) {
    return this.run(a, async (tx) => {
      const schedule = await tx.feeSchedule.findFirst({
        where: { id: scheduleId, tenantId: a.tenantId },
        include: { installments: { orderBy: { position: 'asc' } }, category: true, assignments: { select: { enrollmentId: true } } },
      });
      if (!schedule) throw Errors.notFound('Fee schedule');
      if (!schedule.isActive) throw Errors.conflict('SCHEDULE_INACTIVE', 'This fee schedule is inactive');
      if (schedule.isOptional) throw Errors.conflict('OPTIONAL_SCHEDULE', 'An optional service is billed per pupil, from the pupil account');
      await this.core.assertPeriodOpen(tx, a.tenantId, input.issueDate);
      const settings = await this.core.settings(tx, a.tenantId);
      const reportingRate = await this.core.rate(tx, a.tenantId, schedule.currency, settings.reportingCurrency, input.issueDate);

      const already = new Set(schedule.assignments.map((x) => x.enrollmentId));
      const enrollments = await tx.enrollment.findMany({
        where: {
          tenantId: a.tenantId,
          academicYearId: schedule.academicYearId,
          status: { in: [...ACTIVE_ENROLLMENT] },
          ...(schedule.classId && { classId: schedule.classId }),
          ...(schedule.levelId && { schoolClass: { levelId: schedule.levelId } }),
        },
        select: { id: true, studentId: true },
      });

      let created = 0;
      for (const e of enrollments.filter((x) => !already.has(x.id))) {
        const invoice = await tx.invoice.create({
          data: {
            tenantId: a.tenantId,
            number: await this.core.number(tx, a.tenantId, 'INV', input.issueDate),
            studentId: e.studentId,
            academicYearId: schedule.academicYearId,
            enrollmentId: e.id,
            currency: schedule.currency,
            issueDate: toDate(input.issueDate),
            reportingCurrency: settings.reportingCurrency,
            reportingRate: reportingRate.value,
            createdBy: a.userId,
            lines: {
              create: schedule.installments.map((i) => ({
                kind: 'CHARGE' as const,
                categoryId: schedule.categoryId,
                description: `${schedule.name} — ${i.label}`,
                amount: i.amount,
                dueDate: i.dueDate,
                installmentId: i.id,
                createdBy: a.userId,
              })),
            },
          },
        });
        await tx.studentFeeAssignment.create({
          data: { tenantId: a.tenantId, scheduleId: schedule.id, enrollmentId: e.id, invoiceId: invoice.id },
        });
        created++;
      }
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'fee_schedule.applied',
          entityType: 'fee_schedule',
          entityId: schedule.id,
          metadata: { invoicesCreated: created, alreadyBilled: already.size, issueDate: input.issueDate },
          ip: a.ip,
        },
        tx,
      );
      return { invoicesCreated: created, alreadyBilled: enrollments.length - created };
    });
  }

  // ------------------------------------------------------------ per-pupil fees and services

  /** The pupil's active enrollment for the year with every schedule that applies to its class (school, level or class). */
  private async applicable(tx: Tx, a: Actor, studentId: string, academicYearId: string) {
    const enrollment = await tx.enrollment.findFirst({
      where: { tenantId: a.tenantId, studentId, academicYearId, status: { in: [...ACTIVE_ENROLLMENT] } },
      select: { id: true, studentId: true, academicYearId: true, classId: true, schoolClass: { select: { name: true, levelId: true } } },
    });
    if (!enrollment) return null;
    const schedules = await tx.feeSchedule.findMany({
      where: {
        tenantId: a.tenantId,
        academicYearId,
        isActive: true,
        OR: [{ classId: null, levelId: null }, { classId: enrollment.classId }, { levelId: enrollment.schoolClass.levelId }],
      },
      include: {
        installments: { orderBy: { position: 'asc' } },
        category: { select: { code: true, nameFr: true, nameEn: true, kind: true } },
        // Any enrollment of the pupil this year: a class change does not bill school or level fees again.
        assignments: { where: { invoice: { studentId } }, select: { invoiceId: true } },
      },
      orderBy: [{ isOptional: 'asc' }, { createdAt: 'asc' }],
    });
    return { enrollment, schedules };
  }

  /** Bills schedules to one enrollment: one invoice per currency, one line per installment, recorded so it is never billed twice. */
  private async billSchedules(
    tx: Tx,
    a: Actor,
    enrollment: { id: string; studentId: string; academicYearId: string },
    schedules: { id: string; name: string; currency: string; categoryId: string; installments: { id: string; label: string; dueDate: Date; amount: Prisma.Decimal }[] }[],
    issueDate: string,
  ) {
    await this.core.assertPeriodOpen(tx, a.tenantId, issueDate);
    const settings = await this.core.settings(tx, a.tenantId);
    const currencies = [...new Set(schedules.map((s) => s.currency))];
    // Every check runs before the first write.
    const rates = await Promise.all(currencies.map((c) => this.core.rate(tx, a.tenantId, c, settings.reportingCurrency, issueDate)));
    const invoices: string[] = [];
    for (const [n, currency] of currencies.entries()) {
      const group = schedules.filter((s) => s.currency === currency);
      const reportingRate = rates[n]!;
      const invoice = await tx.invoice.create({
        data: {
          tenantId: a.tenantId,
          number: await this.core.number(tx, a.tenantId, 'INV', issueDate),
          studentId: enrollment.studentId,
          academicYearId: enrollment.academicYearId,
          enrollmentId: enrollment.id,
          currency,
          issueDate: toDate(issueDate),
          reportingCurrency: settings.reportingCurrency,
          reportingRate: reportingRate.value,
          createdBy: a.userId,
          lines: {
            create: group.flatMap((s) =>
              s.installments.map((i) => ({
                kind: 'CHARGE' as const,
                categoryId: s.categoryId,
                description: s.installments.length > 1 ? `${s.name} — ${i.label}` : s.name,
                amount: i.amount,
                dueDate: i.dueDate,
                installmentId: i.id,
                createdBy: a.userId,
              })),
            ),
          },
        },
      });
      await tx.studentFeeAssignment.createMany({ data: group.map((s) => ({ tenantId: a.tenantId, scheduleId: s.id, enrollmentId: enrollment.id, invoiceId: invoice.id })) });
      invoices.push(invoice.id);
    }
    return invoices;
  }

  /** What the pupil pays this year: the class's compulsory fees and the optional services, each with whether it is billed. */
  feeOptions(a: Actor, studentId: string, academicYearId: string) {
    return this.run(a, async (tx) => {
      const found = await this.applicable(tx, a, studentId, academicYearId);
      if (!found) return { enrollment: null, compulsory: [], services: [] };
      const present = await Promise.all(
        found.schedules.map(async (s) => ({
          id: s.id,
          name: s.name,
          currency: s.currency,
          amount: await this.core.format(tx, s.amount, s.currency),
          category: s.category,
          installments: await Promise.all(s.installments.map(async (i) => ({ label: i.label, dueDate: toIso(i.dueDate), amount: await this.core.format(tx, i.amount, s.currency) }))),
          invoiceId: s.assignments[0]?.invoiceId ?? null,
          optional: s.isOptional,
        })),
      );
      return {
        enrollment: { id: found.enrollment.id, classId: found.enrollment.classId, className: found.enrollment.schoolClass.name },
        compulsory: present.filter((s) => !s.optional),
        services: present.filter((s) => s.optional),
      };
    });
  }

  /** Bills the optional services ticked for a pupil, in one invoice per currency. */
  subscribeServices(a: Actor, studentId: string, input: SubscribeServicesInput) {
    return this.run(a, async (tx) => {
      const found = await this.applicable(tx, a, studentId, input.academicYearId);
      if (!found) throw Errors.conflict('NOT_ENROLLED', 'The pupil has no active enrollment this year');
      const wanted = new Set(input.scheduleIds);
      const chosen = found.schedules.filter((s) => wanted.has(s.id));
      if (chosen.length !== wanted.size || chosen.some((s) => !s.isOptional)) throw Errors.conflict('SERVICE_NOT_AVAILABLE', "A selected service doesn't apply to this pupil's class");
      if (chosen.some((s) => s.assignments.length > 0)) throw Errors.conflict('SERVICE_ALREADY_BILLED', 'A selected service is already billed to this pupil');
      const invoices = await this.billSchedules(tx, a, found.enrollment, chosen, input.issueDate);
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'fee_services.subscribed',
          entityType: 'student',
          entityId: studentId,
          metadata: { schedules: chosen.map((s) => s.name), invoices },
          ip: a.ip,
        },
        tx,
      );
      return { invoices };
    });
  }

  /**
   * Bills the class's compulsory fees to a new enrollment, inside the caller's transaction. Never blocks the enrollment:
   * when billing is impossible (closed period, missing rate) it reports why and the bursar can apply the fees later.
   */
  async billCompulsory(tx: Tx, a: Actor, studentId: string, academicYearId: string, issueDate: string): Promise<{ invoices: number; skipped: string | null }> {
    const found = await this.applicable(tx, a, studentId, academicYearId);
    const due = found?.schedules.filter((s) => !s.isOptional && s.assignments.length === 0) ?? [];
    if (!found || due.length === 0) return { invoices: 0, skipped: null };
    try {
      const invoices = await this.billSchedules(tx, a, found.enrollment, due, issueDate);
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'fee_schedule.billed_on_enrollment', entityType: 'enrollment', entityId: found.enrollment.id, metadata: { schedules: due.map((s) => s.name), invoices }, ip: a.ip },
        tx,
      );
      return { invoices: invoices.length, skipped: null };
    } catch (e) {
      // Raised by the period and rate checks before any write, so the transaction is still usable.
      if (e instanceof ApiException) return { invoices: 0, skipped: (e.getResponse() as { code: string }).code };
      throw e;
    }
  }

  // ------------------------------------------------------------ invoices

  listInvoices(a: Actor, filter: { studentId?: string; outstandingOnly?: boolean; q?: string }) {
    return this.run(a, async (tx) => {
      const rows = await tx.invoice.findMany({
        where: {
          tenantId: a.tenantId,
          ...(filter.studentId && { studentId: filter.studentId }),
          ...(filter.outstandingOnly && { status: 'ISSUED' }),
          ...(filter.q && {
            OR: [
              { number: { contains: filter.q, mode: 'insensitive' } },
              { student: { lastName: { contains: filter.q, mode: 'insensitive' } } },
              { student: { matricule: { contains: filter.q, mode: 'insensitive' } } },
            ],
          }),
        },
        include: { student: { select: { id: true, matricule: true, firstName: true, lastName: true } } },
        orderBy: [{ issueDate: 'desc' }, { number: 'desc' }],
        take: 200,
      });
      const balances = await this.core.invoiceBalances(tx, a.tenantId, rows.map((r) => r.id));
      const items = await Promise.all(rows.map(async (r) => ({ ...(await this.presentInvoice(tx, r, balances.get(r.id)!)), student: r.student })));
      return filter.outstandingOnly ? items.filter((i) => i.paymentStatus !== 'PAID') : items;
    });
  }

  getInvoice(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { id, tenantId: a.tenantId },
        include: {
          student: { select: { id: true, matricule: true, firstName: true, lastName: true } },
          lines: { orderBy: [{ kind: 'asc' }, { dueDate: 'asc' }] },
          allocations: {
            include: { payment: { select: { id: true, status: true, method: true, currency: true, receivedOn: true, receipt: { select: { number: true } } } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!inv) throw Errors.notFound('Invoice');
      const balance = (await this.core.invoiceBalances(tx, a.tenantId, [id])).get(id)!;
      return {
        ...(await this.presentInvoice(tx, inv, balance)),
        student: inv.student,
        notes: inv.notes,
        cancelledReason: inv.cancelledReason,
        lines: await Promise.all(
          inv.lines.map(async (l) => ({
            id: l.id,
            kind: l.kind,
            description: l.description,
            amount: await this.core.format(tx, l.amount, inv.currency),
            dueDate: toIsoOrNull(l.dueDate),
            discountKind: l.discountKind,
            reason: l.reason,
          })),
        ),
        payments: await Promise.all(
          inv.allocations.map(async (al) => ({
            paymentId: al.paymentId,
            status: al.payment.status,
            method: al.payment.method,
            receivedOn: toIso(al.payment.receivedOn),
            receipt: al.payment.receipt?.number ?? null,
            amount: await this.core.format(tx, al.amount, al.payment.currency),
            paymentCurrency: al.payment.currency,
            invoiceAmount: await this.core.format(tx, al.invoiceAmount, inv.currency),
            rate: al.rate.toString(),
          })),
        ),
      };
    });
  }

  /** Discounts, scholarships and waivers are approved lines, never edits of the charge (FIN-004). */
  addDiscount(a: Actor, invoiceId: string, input: DiscountInput) {
    return this.run(a, async (tx) => {
      const inv = await this.lockInvoice(tx, a, invoiceId);
      await this.core.assertPeriodOpen(tx, a.tenantId, this.core.today(a));
      const amount = await this.core.amount(tx, input.amount, inv.currency);
      const balance = (await this.core.invoiceBalances(tx, a.tenantId, [invoiceId])).get(invoiceId)!;
      if (amount.greaterThan(balance.balance)) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'DISCOUNT_EXCEEDS_BALANCE', 'A reduction cannot exceed the outstanding balance', {
          balance: await this.core.format(tx, balance.balance, inv.currency),
        });
      }
      const line = await tx.invoiceLine.create({
        data: {
          tenantId: a.tenantId,
          invoiceId,
          kind: 'DISCOUNT',
          discountKind: input.kind,
          description: input.reason,
          reason: input.reason,
          amount,
          createdBy: a.userId,
        },
      });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'invoice.discount_granted',
          entityType: 'invoice',
          entityId: invoiceId,
          metadata: { kind: input.kind, amount: amount.toString(), currency: inv.currency, reason: input.reason, lineId: line.id },
          ip: a.ip,
        },
        tx,
      );
      return { lineId: line.id };
    });
  }

  /** Only an invoice with no confirmed payment can be cancelled; paid ones are corrected by reversal/discount. */
  cancel(a: Actor, invoiceId: string, input: ReasonInput) {
    return this.run(a, async (tx) => {
      const inv = await this.lockInvoice(tx, a, invoiceId);
      const balance = (await this.core.invoiceBalances(tx, a.tenantId, [invoiceId])).get(invoiceId)!;
      if (!balance.paid.isZero()) {
        throw Errors.conflict('INVOICE_HAS_PAYMENTS', 'Reverse the payments before cancelling this invoice');
      }
      await tx.invoice.update({ where: { id: inv.id }, data: { status: 'CANCELLED', cancelledReason: input.reason } });
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'invoice.cancelled', entityType: 'invoice', entityId: invoiceId, metadata: { reason: input.reason }, ip: a.ip },
        tx,
      );
      return { id: invoiceId, status: 'CANCELLED' as const };
    });
  }

  /** Parent-facing statement: invoices, payments and balance per currency (FIN-016). */
  statement(a: Actor, studentId: string) {
    return this.run(a, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId, tenantId: a.tenantId },
        select: { id: true, matricule: true, firstName: true, lastName: true },
      });
      if (!student) throw Errors.notFound('Student');
      const invoices = await tx.invoice.findMany({
        where: { tenantId: a.tenantId, studentId, status: 'ISSUED' },
        orderBy: { issueDate: 'asc' },
      });
      const balances = await this.core.invoiceBalances(tx, a.tenantId, invoices.map((i) => i.id));
      const payments = await tx.payment.findMany({
        where: { tenantId: a.tenantId, studentId },
        include: { receipt: { select: { number: true } }, allocations: { select: { amount: true } }, refunds: { where: { status: { in: ['REQUESTED', 'APPROVED'] } } } },
        orderBy: { receivedOn: 'desc' },
      });
      const totals = new Map<string, { total: Prisma.Decimal; paid: Prisma.Decimal; balance: Prisma.Decimal }>();
      for (const inv of invoices) {
        const b = balances.get(inv.id)!;
        const t = totals.get(inv.currency) ?? { total: ZERO, paid: ZERO, balance: ZERO };
        totals.set(inv.currency, { total: t.total.plus(b.total), paid: t.paid.plus(b.paid), balance: t.balance.plus(b.balance) });
      }
      return {
        student,
        balances: await Promise.all(
          [...totals].map(async ([currency, t]) => ({
            currency,
            total: await this.core.format(tx, t.total, currency),
            paid: await this.core.format(tx, t.paid, currency),
            balance: await this.core.format(tx, t.balance, currency),
          })),
        ),
        invoices: await Promise.all(invoices.map((inv) => this.presentInvoice(tx, inv, balances.get(inv.id)!))),
        payments: await Promise.all(
          payments.map(async (p) => {
            const allocated = sum(p.allocations.map((x) => x.amount));
            const reserved = sum(p.refunds.map((r) => r.amount));
            return {
              id: p.id,
              receivedOn: toIso(p.receivedOn),
              method: p.method,
              status: p.status,
              currency: p.currency,
              amount: await this.core.format(tx, p.amount, p.currency),
              credit: p.status === 'CONFIRMED' ? await this.core.format(tx, p.amount.minus(allocated).minus(reserved), p.currency) : '0',
              receipt: p.receipt?.number ?? null,
              externalReference: p.externalReference,
            };
          }),
        ),
      };
    });
  }

  private async lockInvoice(tx: Tx, a: Actor, invoiceId: string) {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid AND tenant_id = ${a.tenantId}::uuid FOR UPDATE`;
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, tenantId: a.tenantId } });
    if (!inv) throw Errors.notFound('Invoice');
    if (inv.status !== 'ISSUED') throw Errors.conflict('INVOICE_CANCELLED', 'This invoice is cancelled');
    return inv;
  }

  private async presentInvoice(
    tx: Tx,
    inv: { id: string; number: string; currency: string; issueDate: Date; status: string; studentId: string },
    b: InvoiceBalance,
  ) {
    const f = (v: Prisma.Decimal) => this.core.format(tx, v, inv.currency);
    return {
      id: inv.id,
      number: inv.number,
      studentId: inv.studentId,
      currency: inv.currency,
      issueDate: toIso(inv.issueDate),
      status: inv.status,
      paymentStatus: inv.status === 'CANCELLED' ? 'CANCELLED' : b.balance.lessThanOrEqualTo(0) ? 'PAID' : b.paid.isZero() ? 'UNPAID' : 'PARTIALLY_PAID',
      charges: await f(b.charges),
      discounts: await f(b.discounts),
      total: await f(b.total),
      paid: await f(b.paid),
      balance: await f(b.balance),
    };
  }
}
