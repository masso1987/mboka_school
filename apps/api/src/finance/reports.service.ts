import { Injectable } from '@nestjs/common';
import type { Actor } from '../common/actor';
import { toDate, toIso } from '../common/dates';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { FinanceCore, min, round, sum, ZERO, type Dec } from './finance-core';

/** KPI definitions returned with every report so figures can be reconciled (REP-006, Module 10). */
const DEFINITIONS = {
  billed: 'Charges minus discounts of invoices issued in the range (cancelled invoices excluded), at each invoice\'s issue rate.',
  collected: 'Payments received in the range (confirmed, or later reversed) minus reversals dated in the range, at each payment\'s recorded rate. Pending and failed payments are excluded.',
  refunds: 'Refunds approved in the range.',
  outstanding: 'Balance at the end date of invoices issued on or before it, counting only payments received by then and not reversed by then.',
  collectionRate: 'Eligible collections ÷ eligible amounts due × 100. Due = installments due by the end date, less discounts. Collections are capped at the amount due per invoice, so prepayments and credit do not inflate the rate; amounts not yet due are excluded.',
  expenses: 'Expenses approved or paid, dated in the range.',
  netCashResult: 'Collected − refunds − expenses paid in the range. A cash view, not profitability.',
  operatingResult: 'Billed − expenses (approved or paid) in the range. Accrual-style view under the school\'s policy; validate against the accounting basis before relying on it.',
  exchangeDifferences: 'Realized gains (+) or losses (−) on allocations of payments received in the range, between the invoice\'s issue rate and the payment\'s rate.',
} as const;

/** Financial reporting (Module 13 financial reports, annual dashboard of Module 10). */
@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: FinanceCore,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  summary(a: Actor, from: string, to: string) {
    return this.run(a, async (tx) => {
      const settings = await this.core.settings(tx, a.tenantId);
      const R = settings.reportingCurrency;
      const rMinor = await this.core.minorUnits(tx, R);
      const r = (v: Dec) => round(v, rMinor);
      const f = (v: Dec) => this.core.format(tx, v, R);
      const range = { gte: toDate(from), lte: toDate(to) };

      // Billed
      const issued = await tx.invoice.findMany({
        where: { tenantId: a.tenantId, status: 'ISSUED', issueDate: range },
        select: { id: true, reportingRate: true },
      });
      const issuedBal = await this.core.invoiceBalances(tx, a.tenantId, issued.map((i) => i.id));
      const billed = sum(issued.map((i) => r(issuedBal.get(i.id)!.total.times(i.reportingRate))));

      // Collections, reversals, by method
      const received = await tx.payment.findMany({
        where: { tenantId: a.tenantId, status: { in: ['CONFIRMED', 'REVERSED'] }, receivedOn: range },
        select: { method: true, reportingAmount: true },
      });
      const reversed = await tx.payment.findMany({
        where: { tenantId: a.tenantId, status: 'REVERSED', reversalDate: range },
        select: { method: true, reportingAmount: true },
      });
      const byMethod = new Map<string, Dec>();
      for (const p of received) byMethod.set(p.method, (byMethod.get(p.method) ?? ZERO).plus(p.reportingAmount));
      for (const p of reversed) byMethod.set(p.method, (byMethod.get(p.method) ?? ZERO).minus(p.reportingAmount));
      const collected = sum(received.map((p) => p.reportingAmount)).minus(sum(reversed.map((p) => p.reportingAmount)));

      const refundsRows = await tx.refund.findMany({
        where: { tenantId: a.tenantId, status: 'APPROVED', decidedAt: { gte: toDate(from), lt: dayAfter(to) } },
        select: { amount: true, payment: { select: { reportingRate: true } } },
      });
      const refunds = sum(refundsRows.map((x) => r(x.amount.times(x.payment.reportingRate))));

      const pending = await tx.payment.aggregate({
        where: { tenantId: a.tenantId, status: 'PENDING_VERIFICATION', receivedOn: range },
        _sum: { reportingAmount: true },
        _count: true,
      });

      // Expenses
      const expenseRows = await tx.expense.groupBy({
        by: ['categoryId'],
        where: { tenantId: a.tenantId, status: { in: ['APPROVED', 'PAID'] }, expenseDate: range },
        _sum: { reportingAmount: true },
      });
      const categories = await tx.expenseCategory.findMany({
        where: { tenantId: a.tenantId, id: { in: expenseRows.map((x) => x.categoryId) } },
        select: { id: true, code: true, nameFr: true, nameEn: true },
      });
      const expenses = sum(expenseRows.map((x) => x._sum.reportingAmount ?? ZERO));
      const paidExpenses = await tx.expense.aggregate({
        where: { tenantId: a.tenantId, status: 'PAID', paidAt: { gte: toDate(from), lt: dayAfter(to) } },
        _sum: { reportingAmount: true },
      });

      const fx = await tx.paymentAllocation.aggregate({
        where: { tenantId: a.tenantId, payment: { status: 'CONFIRMED', receivedOn: range } },
        _sum: { exchangeDifference: true },
      });

      const { outstanding, due, eligibleCollected } = await this.positionAt(tx, a.tenantId, to, rMinor);

      return {
        period: { from, to },
        currency: R,
        status: (await this.isFinal(tx, a.tenantId, from, to)) ? 'FINAL' : 'PROVISIONAL',
        billed: await f(billed),
        collected: await f(collected),
        collectedByMethod: await Promise.all([...byMethod].map(async ([method, v]) => ({ method, amount: await f(v) }))),
        refunds: await f(refunds),
        pendingVerification: { count: pending._count, amount: await f(pending._sum.reportingAmount ?? ZERO) },
        outstanding: await f(outstanding),
        amountsDue: await f(due),
        eligibleCollected: await f(eligibleCollected),
        collectionRate: due.isZero() ? null : Number(eligibleCollected.dividedBy(due).times(100).toFixed(1)),
        expenses: await f(expenses),
        expensesByCategory: await Promise.all(
          expenseRows.map(async (x) => ({ category: categories.find((c) => c.id === x.categoryId)!, amount: await f(x._sum.reportingAmount ?? ZERO) })),
        ),
        exchangeDifferences: await f(fx._sum.exchangeDifference ?? ZERO),
        netCashResult: await f(collected.minus(refunds).minus(paidExpenses._sum.reportingAmount ?? ZERO)),
        operatingResult: await f(billed.minus(expenses)),
        definitions: DEFINITIONS,
      };
    });
  }

  /** Overdue balances by age of the oldest unpaid installment (FIN-012, aging report). */
  aging(a: Actor, asOf: string) {
    return this.run(a, async (tx) => {
      const settings = await this.core.settings(tx, a.tenantId);
      const R = settings.reportingCurrency;
      const rMinor = await this.core.minorUnits(tx, R);
      const invoices = await this.invoicesAsOf(tx, a.tenantId, asOf);
      const buckets = { notDue: ZERO, d0_30: ZERO, d31_60: ZERO, d61_90: ZERO, d90plus: ZERO };
      const perStudent = new Map<string, { student: { id: string; matricule: string; firstName: string; lastName: string }; overdue: Dec }>();
      const asOfMs = toDate(asOf).getTime();

      for (const inv of invoices) {
        let unpaid = inv.balanceAsOf; // invoice currency
        if (unpaid.lessThanOrEqualTo(0)) continue;
        // Payments settle the earliest installments first, so what remains unpaid is the latest-due part.
        const lines = [...inv.charges].sort((x, y) => y.due.localeCompare(x.due));
        for (const line of lines) {
          if (unpaid.lessThanOrEqualTo(0)) break;
          const part = min(unpaid, line.amount);
          unpaid = unpaid.minus(part);
          const value = round(part.times(inv.reportingRate), rMinor);
          const days = Math.floor((asOfMs - toDate(line.due).getTime()) / 86_400_000);
          const key = days < 0 ? 'notDue' : days <= 30 ? 'd0_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90plus';
          buckets[key] = buckets[key].plus(value);
          if (days >= 0) {
            const s = perStudent.get(inv.student.id) ?? { student: inv.student, overdue: ZERO };
            s.overdue = s.overdue.plus(value);
            perStudent.set(inv.student.id, s);
          }
        }
      }
      const f = (v: Dec) => this.core.format(tx, v, R);
      const top = [...perStudent.values()].sort((x, y) => y.overdue.comparedTo(x.overdue)).slice(0, 50);
      return {
        asOf,
        currency: R,
        buckets: {
          notDue: await f(buckets.notDue),
          d0_30: await f(buckets.d0_30),
          d31_60: await f(buckets.d31_60),
          d61_90: await f(buckets.d61_90),
          d90plus: await f(buckets.d90plus),
        },
        totalOverdue: await f(buckets.d0_30.plus(buckets.d31_60).plus(buckets.d61_90).plus(buckets.d90plus)),
        students: await Promise.all(top.map(async (s) => ({ ...s.student, overdue: await f(s.overdue) }))),
        basis: 'Unpaid amounts are attributed to the latest installments (payments settle the oldest first) and aged by days past each installment\'s due date.',
      };
    });
  }

  // ------------------------------------------------------------ internals

  /** Invoice positions as of a date: only payments received by then and not reversed by then count. */
  private async invoicesAsOf(tx: Tx, tenantId: string, asOf: string) {
    const d = toDate(asOf);
    const invoices = await tx.invoice.findMany({
      where: { tenantId, status: 'ISSUED', issueDate: { lte: d } },
      include: {
        student: { select: { id: true, matricule: true, firstName: true, lastName: true } },
        lines: { select: { kind: true, amount: true, dueDate: true } },
        allocations: {
          where: {
            payment: {
              receivedOn: { lte: d },
              OR: [{ status: 'CONFIRMED' }, { status: 'REVERSED', reversalDate: { gt: d } }],
            },
          },
          select: { invoiceAmount: true },
        },
      },
    });
    return invoices.map((inv) => {
      const charges = inv.lines
        .filter((l) => l.kind === 'CHARGE')
        .map((l) => ({ amount: l.amount, due: toIso(l.dueDate ?? inv.issueDate) }));
      const discounts = sum(inv.lines.filter((l) => l.kind === 'DISCOUNT').map((l) => l.amount));
      const paid = sum(inv.allocations.map((x) => x.invoiceAmount));
      const total = sum(charges.map((c) => c.amount)).minus(discounts);
      return { ...inv, charges, discounts, paid, total, balanceAsOf: total.minus(paid) };
    });
  }

  private async positionAt(tx: Tx, tenantId: string, to: string, rMinor: number) {
    const invoices = await this.invoicesAsOf(tx, tenantId, to);
    let outstanding = ZERO;
    let due = ZERO;
    let eligibleCollected = ZERO;
    for (const inv of invoices) {
      const rr = (v: Dec) => round(v.times(inv.reportingRate), rMinor);
      outstanding = outstanding.plus(rr(maxDec(inv.balanceAsOf, ZERO)));
      const dueNow = maxDec(sum(inv.charges.filter((c) => c.due <= to).map((c) => c.amount)).minus(inv.discounts), ZERO);
      due = due.plus(rr(dueNow));
      eligibleCollected = eligibleCollected.plus(rr(min(inv.paid, dueNow)));
    }
    return { outstanding, due, eligibleCollected };
  }

  /** Figures are final only when every day of the range lies in a closed financial period (REP-005). */
  private async isFinal(tx: Tx, tenantId: string, from: string, to: string): Promise<boolean> {
    const closed = await tx.financialPeriod.findMany({
      where: { tenantId, status: 'CLOSED', endDate: { gte: toDate(from) }, startDate: { lte: toDate(to) } },
      orderBy: { startDate: 'asc' },
    });
    let cursor = from;
    for (const p of closed) {
      if (toIso(p.startDate) > cursor) return false;
      const next = toIso(new Date(p.endDate.getTime() + 86_400_000));
      if (next > cursor) cursor = next;
      if (cursor > to) return true;
    }
    return cursor > to;
  }
}

function dayAfter(iso: string): Date {
  return new Date(toDate(iso).getTime() + 86_400_000);
}

function maxDec(a: Dec, b: Dec): Dec {
  return a.greaterThan(b) ? a : b;
}

