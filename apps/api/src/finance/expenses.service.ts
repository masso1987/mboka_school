import { HttpStatus, Injectable } from '@nestjs/common';
import type { BudgetInput, ExpenseActionInput, ExpenseCategoryInput, ExpenseInput } from '@mboka/shared';
import type { Expense, ExpenseStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toDate, toIso } from '../common/dates';
import { guardDb } from '../common/db-errors';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { FinanceCore, round, ZERO, type Dec } from './finance-core';

/** Which action moves an expense from which state (EXP-003). */
const TRANSITIONS: Record<ExpenseActionInput['action'], { from: ExpenseStatus[]; to: ExpenseStatus }> = {
  APPROVE: { from: ['SUBMITTED'], to: 'APPROVED' },
  REJECT: { from: ['SUBMITTED'], to: 'REJECTED' },
  PAY: { from: ['APPROVED'], to: 'PAID' },
  CANCEL: { from: ['SUBMITTED', 'APPROVED'], to: 'CANCELLED' },
};

const COMMITTED: ExpenseStatus[] = ['APPROVED', 'PAID'];

/** Expenses with approval thresholds and separation of duties, and budgets vs actuals (Module 10). */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly core: FinanceCore,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  listCategories(a: Actor) {
    return this.run(a, (tx) => tx.expenseCategory.findMany({ where: { tenantId: a.tenantId }, orderBy: { code: 'asc' } }));
  }

  createCategory(a: Actor, input: ExpenseCategoryInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const c = await tx.expenseCategory.create({ data: { tenantId: a.tenantId, ...input } });
        await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'expense_category.created', entityType: 'expense_category', entityId: c.id, ip: a.ip }, tx);
        return c;
      }),
      { ExpenseCategory: () => Errors.conflict('CODE_TAKEN', 'Expense category code already in use') },
    );
  }

  list(a: Actor, filter: { status?: string; from?: string; to?: string }) {
    return this.run(a, async (tx) => {
      const rows = await tx.expense.findMany({
        where: {
          tenantId: a.tenantId,
          ...(filter.status && { status: filter.status as ExpenseStatus }),
          ...((filter.from || filter.to) && {
            expenseDate: { ...(filter.from && { gte: toDate(filter.from) }), ...(filter.to && { lte: toDate(filter.to) }) },
          }),
        },
        include: { category: { select: { code: true, nameFr: true, nameEn: true } } },
        orderBy: [{ expenseDate: 'desc' }, { number: 'desc' }],
        take: 200,
      });
      return Promise.all(rows.map((e) => this.present(tx, a, e)));
    });
  }

  get(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const e = await tx.expense.findFirst({
        where: { id, tenantId: a.tenantId },
        include: { category: { select: { code: true, nameFr: true, nameEn: true } }, events: { orderBy: { createdAt: 'asc' } } },
      });
      if (!e) throw Errors.notFound('Expense');
      return {
        ...(await this.present(tx, a, e)),
        history: e.events.map((ev) => ({ from: ev.fromStatus, to: ev.toStatus, actorId: ev.actorId, comment: ev.comment, at: ev.createdAt.toISOString() })),
      };
    });
  }

  create(a: Actor, input: ExpenseInput) {
    return this.run(a, async (tx) => {
      const category = await tx.expenseCategory.findFirst({ where: { id: input.categoryId, tenantId: a.tenantId } });
      if (!category) throw Errors.notFound('Expense category');
      await this.core.assertEnabled(tx, a.tenantId, input.currency);
      const amount = await this.core.amount(tx, input.amount, input.currency);
      this.core.assertNotFuture(a, input.expenseDate, 'expense date');
      await this.core.assertPeriodOpen(tx, a.tenantId, input.expenseDate);
      const settings = await this.core.settings(tx, a.tenantId);
      const rate = await this.core.rate(tx, a.tenantId, input.currency, settings.reportingCurrency, input.expenseDate);
      const expense = await tx.expense.create({
        data: {
          tenantId: a.tenantId,
          number: await this.core.number(tx, a.tenantId, 'EXP', input.expenseDate),
          categoryId: input.categoryId,
          supplier: input.supplier,
          description: input.description,
          amount,
          currency: input.currency,
          expenseDate: toDate(input.expenseDate),
          reportingRate: rate.value,
          reportingAmount: round(amount.times(rate.value), await this.core.minorUnits(tx, settings.reportingCurrency)),
          submittedBy: a.userId,
          events: { create: { toStatus: 'SUBMITTED', actorId: a.userId } },
        },
        include: { category: { select: { code: true, nameFr: true, nameEn: true } } },
      });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'expense.submitted',
          entityType: 'expense',
          entityId: expense.id,
          metadata: { amount: amount.toString(), currency: input.currency, category: category.code },
          ip: a.ip,
        },
        tx,
      );
      return this.present(tx, a, expense);
    });
  }

  /**
   * Approval rules: the submitter never approves their own expense; amounts above the
   * school's threshold need `expenses.approve.unlimited` (EXP-004, Module 10 AC).
   * Approving reports a budget warning when the category's budget would be exceeded (EXP-007).
   */
  act(a: Actor, id: string, input: ExpenseActionInput) {
    return this.run(a, async (tx) => {
      await tx.$queryRaw`SELECT id FROM expenses WHERE id = ${id}::uuid AND tenant_id = ${a.tenantId}::uuid FOR UPDATE`;
      const e = await tx.expense.findFirst({ where: { id, tenantId: a.tenantId }, include: { category: { select: { code: true, nameFr: true, nameEn: true } } } });
      if (!e) throw Errors.notFound('Expense');
      const t = TRANSITIONS[input.action];
      if (!t.from.includes(e.status)) {
        throw new ApiException(HttpStatus.CONFLICT, 'INVALID_TRANSITION', `Cannot ${input.action.toLowerCase()} an expense that is ${e.status}`);
      }

      if (input.action === 'APPROVE' || input.action === 'REJECT') {
        if (!a.permissions.has('expenses.approve') && !a.permissions.has('expenses.approve.unlimited')) throw Errors.forbidden();
        if (e.submittedBy === a.userId) throw Errors.forbidden('You cannot approve or reject an expense you submitted');
        const settings = await this.core.settings(tx, a.tenantId);
        if (input.action === 'APPROVE' && e.reportingAmount.greaterThan(settings.expenseApprovalThreshold) && !a.permissions.has('expenses.approve.unlimited')) {
          throw new ApiException(HttpStatus.FORBIDDEN, 'ABOVE_APPROVAL_THRESHOLD', 'This amount exceeds your approval limit', {
            threshold: await this.core.format(tx, settings.expenseApprovalThreshold, settings.reportingCurrency),
          });
        }
      }
      if (input.action === 'PAY') {
        if (!a.permissions.has('expenses.approve') && !a.permissions.has('expenses.approve.unlimited')) throw Errors.forbidden();
        await this.core.assertPeriodOpen(tx, a.tenantId, this.core.today(a));
      }
      if (input.action === 'CANCEL' && e.submittedBy !== a.userId && !a.permissions.has('expenses.approve')) throw Errors.forbidden();

      const budgetWarning = input.action === 'APPROVE' ? await this.budgetWarning(tx, a, e) : null;
      const updated = await tx.expense.update({
        where: { id },
        data: {
          status: t.to,
          ...(t.to === 'APPROVED' && { approvedBy: a.userId, approvedAt: new Date() }),
          ...(t.to === 'PAID' && { paidAt: new Date(), paymentReference: input.paymentReference }),
          events: { create: { fromStatus: e.status, toStatus: t.to, actorId: a.userId, comment: input.comment } },
        },
        include: { category: { select: { code: true, nameFr: true, nameEn: true } } },
      });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: `expense.${t.to.toLowerCase()}`,
          entityType: 'expense',
          entityId: id,
          metadata: { from: e.status, to: t.to, comment: input.comment ?? null, budgetWarning },
          ip: a.ip,
        },
        tx,
      );
      return { ...(await this.present(tx, a, updated)), budgetWarning };
    });
  }

  // ------------------------------------------------------------ budgets

  /** One budget per academic year; saving replaces its lines (the audit log keeps the previous ones). */
  saveBudget(a: Actor, input: BudgetInput) {
    return this.run(a, async (tx) => {
      const settings = await this.core.settings(tx, a.tenantId);
      const lines = await Promise.all(
        input.lines.map(async (l) => ({ categoryId: l.categoryId, amount: await this.core.amount(tx, l.amount, settings.reportingCurrency) })),
      );
      const existing = await tx.budget.findUnique({
        where: { tenantId_academicYearId: { tenantId: a.tenantId, academicYearId: input.academicYearId } },
        include: { lines: true },
      });
      const budget = existing
        ? await tx.budget.update({ where: { id: existing.id }, data: { name: input.name } })
        : await tx.budget.create({
            data: { tenantId: a.tenantId, academicYearId: input.academicYearId, name: input.name, currency: settings.reportingCurrency, createdBy: a.userId },
          });
      await tx.budgetLine.deleteMany({ where: { tenantId: a.tenantId, budgetId: budget.id } });
      await tx.budgetLine.createMany({ data: lines.map((l) => ({ tenantId: a.tenantId, budgetId: budget.id, ...l })) });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: existing ? 'budget.updated' : 'budget.created',
          entityType: 'budget',
          entityId: budget.id,
          metadata: {
            before: existing?.lines.map((l) => ({ categoryId: l.categoryId, amount: l.amount.toString() })) ?? null,
            after: lines.map((l) => ({ categoryId: l.categoryId, amount: l.amount.toString() })),
          },
          ip: a.ip,
        },
        tx,
      );
      return this.budgetReportTx(tx, a, input.academicYearId);
    });
  }

  budgetReport(a: Actor, academicYearId: string) {
    return this.run(a, (tx) => this.budgetReportTx(tx, a, academicYearId));
  }

  /** Budget vs actual per category over the academic year's dates (EXP-007). Actual = approved + paid. */
  private async budgetReportTx(tx: Tx, a: Actor, academicYearId: string) {
    const year = await tx.academicYear.findFirst({ where: { id: academicYearId, tenantId: a.tenantId } });
    if (!year) throw Errors.notFound('Academic year');
    const budget = await tx.budget.findUnique({
      where: { tenantId_academicYearId: { tenantId: a.tenantId, academicYearId } },
      include: { lines: { include: { category: { select: { id: true, code: true, nameFr: true, nameEn: true } } } } },
    });
    const settings = await this.core.settings(tx, a.tenantId);
    const actuals = await tx.expense.groupBy({
      by: ['categoryId'],
      where: { tenantId: a.tenantId, status: { in: COMMITTED }, expenseDate: { gte: year.startDate, lte: year.endDate } },
      _sum: { reportingAmount: true },
    });
    const actualBy = new Map(actuals.map((x) => [x.categoryId, x._sum.reportingAmount ?? ZERO]));
    const f = (v: Dec) => this.core.format(tx, v, settings.reportingCurrency);
    const lines = await Promise.all(
      (budget?.lines ?? []).map(async (l) => {
        const actual = actualBy.get(l.categoryId) ?? ZERO;
        return {
          category: l.category,
          budgeted: await f(l.amount),
          actual: await f(actual),
          remaining: await f(l.amount.minus(actual)),
          utilization: l.amount.isZero() ? null : Number(actual.dividedBy(l.amount).times(100).toFixed(1)),
          overrun: actual.greaterThan(l.amount),
        };
      }),
    );
    return {
      academicYear: { id: year.id, name: year.name, startDate: toIso(year.startDate), endDate: toIso(year.endDate) },
      budget: budget ? { id: budget.id, name: budget.name } : null,
      currency: settings.reportingCurrency,
      basis: 'Actual = expenses APPROVED or PAID, dated within the academic year, in reporting currency at each expense\'s recorded rate.',
      lines,
    };
  }

  private async budgetWarning(tx: Tx, a: Actor, e: Expense) {
    const year = await tx.academicYear.findFirst({
      where: { tenantId: a.tenantId, startDate: { lte: e.expenseDate }, endDate: { gte: e.expenseDate } },
    });
    if (!year) return null;
    const line = await tx.budgetLine.findFirst({
      where: { tenantId: a.tenantId, categoryId: e.categoryId, budget: { academicYearId: year.id } },
    });
    if (!line) return null;
    const spent = await tx.expense.aggregate({
      where: { tenantId: a.tenantId, categoryId: e.categoryId, status: { in: COMMITTED }, expenseDate: { gte: year.startDate, lte: year.endDate } },
      _sum: { reportingAmount: true },
    });
    const after = (spent._sum.reportingAmount ?? ZERO).plus(e.reportingAmount);
    if (after.lessThanOrEqualTo(line.amount)) return null;
    const settings = await this.core.settings(tx, a.tenantId);
    return {
      code: 'BUDGET_OVERRUN',
      budgeted: await this.core.format(tx, line.amount, settings.reportingCurrency),
      afterApproval: await this.core.format(tx, after, settings.reportingCurrency),
    };
  }

  private async present(tx: Tx, a: Actor, e: Expense & { category: { code: string; nameFr: string; nameEn: string } }) {
    return {
      id: e.id,
      number: e.number,
      status: e.status,
      category: e.category,
      supplier: e.supplier,
      description: e.description,
      currency: e.currency,
      amount: await this.core.format(tx, e.amount, e.currency),
      expenseDate: toIso(e.expenseDate),
      reportingAmount: e.reportingAmount.toString(),
      submittedBy: e.submittedBy,
      isMine: e.submittedBy === a.userId,
      approvedAt: e.approvedAt?.toISOString() ?? null,
      paidAt: e.paidAt?.toISOString() ?? null,
      paymentReference: e.paymentReference,
    };
  }
}
