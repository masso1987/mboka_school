import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  applyScheduleSchema,
  budgetSchema,
  cashierCloseSchema,
  cashierOpenSchema,
  discountSchema,
  exchangeRateSchema,
  expenseActionSchema,
  expenseCategorySchema,
  expenseSchema,
  feeCategorySchema,
  feeScheduleSchema,
  financeSettingsSchema,
  financialPeriodSchema,
  isoDate,
  paymentSchema,
  providerConfigSchema,
  reasonSchema,
  refundDecisionSchema,
  refundRequestSchema,
  reportRangeSchema,
  type ApplyScheduleInput,
  type BudgetInput,
  type CashierCloseInput,
  type CashierOpenInput,
  type DiscountInput,
  type ExchangeRateInput,
  type ExpenseActionInput,
  type ExpenseCategoryInput,
  type ExpenseInput,
  type FeeCategoryInput,
  type FeeScheduleInput,
  type FinanceSettingsInput,
  type FinancialPeriodInput,
  type PaymentInput,
  type ProviderConfigInput,
  type ReasonInput,
  type RefundDecisionInput,
  type RefundRequestInput,
  type ReportRange,
} from '@mboka/shared';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { Public, RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { Errors } from '../common/api-error';
import { ApiZodBody, ZodBody, ZodPipe } from '../common/zod';
import { BillingService } from './billing.service';
import { ExpensesService } from './expenses.service';
import { MobileMoneyService } from './mobile-money.service';
import { PaymentsService } from './payments.service';
import { FinanceReportsService } from './reports.service';
import { FinanceSetupService } from './setup.service';

const optionalUuid = new ParseUUIDPipe({ optional: true });
const asOfQuery = z.object({ asOf: isoDate });

@ApiTags('finance')
@Controller()
export class FinanceController {
  constructor(
    private readonly setup: FinanceSetupService,
    private readonly billing: BillingService,
    private readonly payments: PaymentsService,
    private readonly mobileMoney: MobileMoneyService,
    private readonly expenses: ExpensesService,
    private readonly reports: FinanceReportsService,
  ) {}

  // ------------------------------------------------------------ settings, rates, periods, providers

  @Get('finance/settings')
  @RequirePermissions('fees.invoice.read')
  getSettings(@CurrentActor() a: Actor) {
    return this.setup.getSettings(a);
  }

  @Put('finance/settings')
  @RequirePermissions('finance.settings.manage')
  @ApiZodBody(financeSettingsSchema)
  updateSettings(@CurrentActor() a: Actor, @ZodBody(financeSettingsSchema) body: FinanceSettingsInput) {
    return this.setup.updateSettings(a, body);
  }

  @Get('finance/exchange-rates')
  @RequirePermissions('fees.invoice.read')
  listRates(@CurrentActor() a: Actor) {
    return this.setup.listRates(a);
  }

  @Post('finance/exchange-rates')
  @RequirePermissions('finance.settings.manage')
  @ApiZodBody(exchangeRateSchema)
  createRate(@CurrentActor() a: Actor, @ZodBody(exchangeRateSchema) body: ExchangeRateInput) {
    return this.setup.createRate(a, body);
  }

  @Get('finance/periods')
  @RequirePermissions('reports.financial.read')
  listPeriods(@CurrentActor() a: Actor) {
    return this.setup.listPeriods(a);
  }

  @Post('finance/periods')
  @RequirePermissions('finance.periods.close')
  @ApiZodBody(financialPeriodSchema)
  createPeriod(@CurrentActor() a: Actor, @ZodBody(financialPeriodSchema) body: FinancialPeriodInput) {
    return this.setup.createPeriod(a, body);
  }

  @Post('finance/periods/:id/close')
  @HttpCode(200)
  @RequirePermissions('finance.periods.close')
  closePeriod(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.setup.closePeriod(a, id);
  }

  @Get('finance/providers')
  @RequirePermissions('finance.settings.manage')
  listProviders(@CurrentActor() a: Actor) {
    return this.setup.listProviders(a);
  }

  @Put('finance/providers')
  @RequirePermissions('finance.settings.manage')
  @ApiZodBody(providerConfigSchema)
  configureProvider(@CurrentActor() a: Actor, @ZodBody(providerConfigSchema) body: ProviderConfigInput) {
    return this.setup.configureProvider(a, body);
  }

  // ------------------------------------------------------------ fees and invoices

  @Get('fee-categories')
  @RequirePermissions('fees.invoice.read')
  listFeeCategories(@CurrentActor() a: Actor) {
    return this.billing.listCategories(a);
  }

  @Post('fee-categories')
  @RequirePermissions('fees.invoice.create')
  @ApiZodBody(feeCategorySchema)
  createFeeCategory(@CurrentActor() a: Actor, @ZodBody(feeCategorySchema) body: FeeCategoryInput) {
    return this.billing.createCategory(a, body);
  }

  @Get('fee-schedules')
  @RequirePermissions('fees.invoice.read')
  listSchedules(@CurrentActor() a: Actor, @Query('academicYearId', optionalUuid) academicYearId?: string) {
    return this.billing.listSchedules(a, academicYearId);
  }

  @Post('fee-schedules')
  @RequirePermissions('fees.invoice.create')
  @ApiZodBody(feeScheduleSchema)
  createSchedule(@CurrentActor() a: Actor, @ZodBody(feeScheduleSchema) body: FeeScheduleInput) {
    return this.billing.createSchedule(a, body);
  }

  @Post('fee-schedules/:id/apply')
  @HttpCode(200)
  @RequirePermissions('fees.invoice.create')
  @ApiZodBody(applyScheduleSchema)
  applySchedule(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(applyScheduleSchema) body: ApplyScheduleInput) {
    return this.billing.applySchedule(a, id, body);
  }

  @Get('invoices')
  @RequirePermissions('fees.invoice.read')
  listInvoices(
    @CurrentActor() a: Actor,
    @Query('studentId', optionalUuid) studentId?: string,
    @Query('outstanding') outstanding?: string,
    @Query('q') q?: string,
  ) {
    return this.billing.listInvoices(a, { studentId, outstandingOnly: outstanding === 'true', q: q?.trim() || undefined });
  }

  @Get('invoices/:id')
  @RequirePermissions('fees.invoice.read')
  getInvoice(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.getInvoice(a, id);
  }

  @Post('invoices/:id/discounts')
  @RequirePermissions('fees.adjust')
  @ApiZodBody(discountSchema)
  addDiscount(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(discountSchema) body: DiscountInput) {
    return this.billing.addDiscount(a, id, body);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('fees.adjust')
  @ApiZodBody(reasonSchema)
  cancelInvoice(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(reasonSchema) body: ReasonInput) {
    return this.billing.cancel(a, id, body);
  }

  @Get('students/:id/statement')
  @RequirePermissions('fees.invoice.read')
  statement(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.statement(a, id);
  }

  // ------------------------------------------------------------ payments

  @Post('payments')
  @RequirePermissions('payments.record')
  @ApiZodBody(paymentSchema)
  recordPayment(@CurrentActor() a: Actor, @ZodBody(paymentSchema) body: PaymentInput) {
    // Operator providers (MTN MoMo, Orange Money) are asked to collect once the payment is recorded.
    return this.mobileMoney.record(a, body);
  }

  /** Asks the operator for a pending Mobile Money payment's result now. */
  @Post('payments/:id/verify')
  @HttpCode(200)
  @RequirePermissions('payments.record')
  verifyPayment(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.mobileMoney.verify(a, id);
  }

  @Get('payments')
  @RequirePermissions('fees.invoice.read')
  listPayments(
    @CurrentActor() a: Actor,
    @Query('studentId', optionalUuid) studentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    return this.payments.list(a, { studentId, from, to, status });
  }

  @Get('payments/:id')
  @RequirePermissions('fees.invoice.read')
  getPayment(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(a, id);
  }

  @Get('payments/:id/receipt')
  @RequirePermissions('fees.invoice.read')
  receipt(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.receipt(a, id);
  }

  @Post('payments/:id/reverse')
  @HttpCode(200)
  @RequirePermissions('payments.reverse')
  @ApiZodBody(reasonSchema)
  reverse(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(reasonSchema) body: ReasonInput) {
    return this.payments.reverse(a, id, body);
  }

  @Post('payments/:id/refunds')
  @RequirePermissions('payments.record')
  @ApiZodBody(refundRequestSchema)
  requestRefund(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(refundRequestSchema) body: RefundRequestInput) {
    return this.payments.requestRefund(a, id, body);
  }

  @Get('refunds')
  @RequirePermissions('fees.invoice.read')
  listRefunds(@CurrentActor() a: Actor, @Query('status') status?: string) {
    return this.payments.listRefunds(a, status);
  }

  @Post('refunds/:id/decision')
  @HttpCode(200)
  @RequirePermissions('payments.refund.approve')
  @ApiZodBody(refundDecisionSchema)
  decideRefund(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(refundDecisionSchema) body: RefundDecisionInput) {
    return this.payments.decideRefund(a, id, body);
  }

  // ------------------------------------------------------------ cash registers

  @Post('cashier-sessions')
  @RequirePermissions('payments.record')
  @ApiZodBody(cashierOpenSchema)
  openSession(@CurrentActor() a: Actor, @ZodBody(cashierOpenSchema) body: CashierOpenInput) {
    return this.payments.openSession(a, body);
  }

  @Get('cashier-sessions/mine')
  @RequirePermissions('payments.record')
  mySessions(@CurrentActor() a: Actor) {
    return this.payments.mySessions(a);
  }

  @Get('cashier-sessions')
  @RequirePermissions('reports.financial.read')
  listSessions(@CurrentActor() a: Actor) {
    return this.payments.listSessions(a);
  }

  @Post('cashier-sessions/:id/close')
  @HttpCode(200)
  @RequirePermissions('payments.record')
  @ApiZodBody(cashierCloseSchema)
  closeSession(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(cashierCloseSchema) body: CashierCloseInput) {
    return this.payments.closeSession(a, id, body);
  }

  // ------------------------------------------------------------ expenses and budgets

  @Get('expense-categories')
  @RequirePermissions()
  listExpenseCategories(@CurrentActor() a: Actor) {
    assertExpenseAccess(a);
    return this.expenses.listCategories(a);
  }

  @Post('expense-categories')
  @RequirePermissions('budgets.manage')
  @ApiZodBody(expenseCategorySchema)
  createExpenseCategory(@CurrentActor() a: Actor, @ZodBody(expenseCategorySchema) body: ExpenseCategoryInput) {
    return this.expenses.createCategory(a, body);
  }

  @Get('expenses')
  @RequirePermissions()
  listExpenses(@CurrentActor() a: Actor, @Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string) {
    assertExpenseAccess(a);
    return this.expenses.list(a, { status, from, to });
  }

  @Get('expenses/:id')
  @RequirePermissions()
  getExpense(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    assertExpenseAccess(a);
    return this.expenses.get(a, id);
  }

  @Post('expenses')
  @RequirePermissions('expenses.create')
  @ApiZodBody(expenseSchema)
  createExpense(@CurrentActor() a: Actor, @ZodBody(expenseSchema) body: ExpenseInput) {
    return this.expenses.create(a, body);
  }

  /** Permission depends on the action (approve vs cancel own); the service decides. */
  @Post('expenses/:id/actions')
  @HttpCode(200)
  @RequirePermissions()
  @ApiZodBody(expenseActionSchema)
  actOnExpense(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(expenseActionSchema) body: ExpenseActionInput) {
    assertExpenseAccess(a);
    return this.expenses.act(a, id, body);
  }

  @Get('budgets/:academicYearId')
  @RequirePermissions('reports.financial.read')
  budget(@CurrentActor() a: Actor, @Param('academicYearId', ParseUUIDPipe) academicYearId: string) {
    return this.expenses.budgetReport(a, academicYearId);
  }

  @Put('budgets')
  @RequirePermissions('budgets.manage')
  @ApiZodBody(budgetSchema)
  saveBudget(@CurrentActor() a: Actor, @ZodBody(budgetSchema) body: BudgetInput) {
    return this.expenses.saveBudget(a, body);
  }

  // ------------------------------------------------------------ reports

  @Get('finance/reports/summary')
  @RequirePermissions('reports.financial.read')
  summary(@CurrentActor() a: Actor, @Query(new ZodPipe(reportRangeSchema)) q: ReportRange) {
    return this.reports.summary(a, q.from, q.to);
  }

  @Get('finance/reports/aging')
  @RequirePermissions('reports.financial.read')
  aging(@CurrentActor() a: Actor, @Query(new ZodPipe(asOfQuery)) q: z.infer<typeof asOfQuery>) {
    return this.reports.aging(a, q.asOf);
  }
}

function assertExpenseAccess(a: Actor) {
  if (!['expenses.create', 'expenses.approve', 'expenses.approve.unlimited'].some((p) => a.permissions.has(p))) throw Errors.forbidden();
}

/**
 * Provider → Mboka webhook. No session: authenticity comes from the HMAC signature over the
 * raw body with the school's provider secret. Unknown schools and providers answer 404.
 */
@ApiTags('payment-callbacks')
@Controller('payment-callbacks')
export class PaymentCallbacksController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly mobileMoney: MobileMoneyService,
  ) {}

  /** MTN MoMo / Orange Money notifications: unsigned, so they only trigger a status check with the operator. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post(':tenantSlug/:provider/notify')
  @HttpCode(200)
  notify(@Param('tenantSlug') tenantSlug: string, @Param('provider') provider: string, @Body() body: unknown) {
    return this.mobileMoney.notify(tenantSlug, provider, body);
  }

  /** MTN may deliver the callback with PUT. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Put(':tenantSlug/:provider/notify')
  @HttpCode(200)
  notifyPut(@Param('tenantSlug') tenantSlug: string, @Param('provider') provider: string, @Body() body: unknown) {
    return this.mobileMoney.notify(tenantSlug, provider, body);
  }

  @Public()
  @SkipThrottle()
  @Post(':tenantSlug/:provider')
  @HttpCode(200)
  callback(
    @Param('tenantSlug') tenantSlug: string,
    @Param('provider') provider: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-mboka-signature') signature: string | undefined,
    @Body() _parsed: unknown,
  ) {
    return this.payments.providerCallback(tenantSlug, provider, req.rawBody, signature);
  }
}
