import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  providerCallbackSchema,
  type CashierCloseInput,
  type CashierOpenInput,
  type PaymentInput,
  type ReasonInput,
  type RefundDecisionInput,
  type RefundRequestInput,
} from '@mboka/shared';
import { Prisma, type Payment } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toDate, toIso } from '../common/dates';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { Decimal, FinanceCore, round, sum, ZERO, type Dec } from './finance-core';
import { decryptSecret, signatureValid } from '../common/secrets';

const paymentInclude = {
  student: { select: { id: true, matricule: true, firstName: true, lastName: true } },
  receipt: { select: { number: true, issuedAt: true } },
  allocations: { include: { invoice: { select: { id: true, number: true, currency: true } } }, orderBy: { createdAt: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PaymentInclude;
type PaymentFull = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

/**
 * Payments, allocations, receipts, reversals, refunds, provider callbacks and cash registers
 * (Module 8 + payment integrity rules). Every money movement happens in one transaction with
 * its audit record; posted rows are never edited or deleted.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly core: FinanceCore,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  // ------------------------------------------------------------ recording

  async record(a: Actor, input: PaymentInput) {
    try {
      return await this.run(a, (tx) => this.recordTx(tx, a, input));
    } catch (e) {
      // Two deliveries of the same request raced; the loser answers with the winner's payment.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && e.meta?.modelName === 'Payment') {
        return this.run(a, async (tx) => {
          const existing = await tx.payment.findUnique({
            where: { tenantId_idempotencyKey: { tenantId: a.tenantId, idempotencyKey: input.idempotencyKey } },
            include: paymentInclude,
          });
          if (!existing) throw e;
          this.assertSameRequest(existing, input);
          return { ...(await this.present(tx, existing)), replayed: true };
        });
      }
      throw e;
    }
  }

  private async recordTx(tx: Tx, a: Actor, input: PaymentInput) {
    const existing = await tx.payment.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: a.tenantId, idempotencyKey: input.idempotencyKey } },
      include: paymentInclude,
    });
    if (existing) {
      this.assertSameRequest(existing, input);
      return { ...(await this.present(tx, existing)), replayed: true };
    }

    const student = await tx.student.findFirst({ where: { id: input.studentId, tenantId: a.tenantId }, select: { id: true } });
    if (!student) throw Errors.notFound('Student');
    await this.core.assertEnabled(tx, a.tenantId, input.currency);
    const amount = await this.core.amount(tx, input.amount, input.currency);
    this.core.assertNotFuture(a, input.receivedOn, 'payment date');
    await this.core.assertPeriodOpen(tx, a.tenantId, input.receivedOn);

    if (input.provider) {
      const provider = await tx.paymentProvider.findUnique({ where: { tenantId_code: { tenantId: a.tenantId, code: input.provider } } });
      if (!provider?.isActive) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'PROVIDER_NOT_CONFIGURED', 'This payment provider is not configured');
      if (provider.kind === 'MTN_MOMO' && !input.payerMsisdn) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'PAYER_MSISDN_REQUIRED', 'Enter the Mobile Money number to debit');
      }
    } else if (input.method !== 'CASH' && !input.externalReference) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'REFERENCE_REQUIRED', 'Non-cash payments need the bank, card or Mobile Money reference');
    }

    let cashierSessionId: string | undefined;
    if (input.method === 'CASH') {
      const session = await tx.cashierSession.findFirst({
        where: { tenantId: a.tenantId, cashierId: a.userId, currency: input.currency, status: 'OPEN' },
      });
      if (!session) throw Errors.conflict('NO_OPEN_CASHIER_SESSION', `Open your ${input.currency} cash register before taking cash`);
      cashierSessionId = session.id;
    }

    const settings = await this.core.settings(tx, a.tenantId);
    const reportingRate = await this.core.rate(tx, a.tenantId, input.currency, settings.reportingCurrency, input.receivedOn);
    const reportingAmount = round(amount.times(reportingRate.value), await this.core.minorUnits(tx, settings.reportingCurrency));
    // An uncertain provider outcome is pending verification, never success (Module 8 integrity rules).
    const status = input.provider ? 'PENDING_VERIFICATION' : 'CONFIRMED';

    const payment = await tx.payment.create({
      data: {
        tenantId: a.tenantId,
        studentId: input.studentId,
        method: input.method,
        currency: input.currency,
        amount,
        receivedOn: toDate(input.receivedOn),
        status,
        externalReference: input.externalReference,
        provider: input.provider,
        payerMsisdn: input.provider ? input.payerMsisdn : undefined,
        idempotencyKey: input.idempotencyKey,
        cashierSessionId,
        recordedBy: a.userId,
        reportingCurrency: settings.reportingCurrency,
        reportingRate: reportingRate.value,
        reportingAmount,
        notes: input.notes,
        confirmedAt: status === 'CONFIRMED' ? new Date() : null,
      },
    });
    if (status === 'CONFIRMED') await this.settle(tx, a.tenantId, a.userId, payment, input.allocations);

    await this.audit.record(
      {
        tenantId: a.tenantId,
        actorId: a.userId,
        action: status === 'CONFIRMED' ? 'payment.recorded' : 'payment.initiated',
        entityType: 'payment',
        entityId: payment.id,
        metadata: {
          studentId: input.studentId,
          method: input.method,
          amount: amount.toString(),
          currency: input.currency,
          reportingAmount: reportingAmount.toString(),
          rate: reportingRate.value.toString(),
          provider: input.provider ?? null,
        },
        ip: a.ip,
      },
      tx,
    );
    const full = await tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: paymentInclude });
    return { ...(await this.present(tx, full)), replayed: false };
  }

  /** Allocates a confirmed payment and issues its receipt. */
  private async settle(tx: Tx, tenantId: string, actorId: string | null, payment: Payment, requested?: PaymentInput['allocations']) {
    await this.allocate(tx, tenantId, payment, requested);
    await tx.receipt.create({
      data: {
        tenantId,
        paymentId: payment.id,
        number: await this.core.number(tx, tenantId, 'REC', toIso(payment.receivedOn), 6),
        issuedBy: actorId,
      },
    });
  }

  /**
   * Applies the payment to the student's open invoices — the requested split, or oldest due
   * first. Cross-currency amounts use the rate in force on the payment date; whatever is not
   * needed stays on the payment as credit (refundable). Invoices are row-locked meanwhile.
   */
  private async allocate(tx: Tx, tenantId: string, payment: Payment, requested?: PaymentInput['allocations']) {
    await tx.$queryRaw`
      SELECT id FROM invoices WHERE tenant_id = ${tenantId}::uuid AND student_id = ${payment.studentId}::uuid AND status = 'ISSUED'
      ORDER BY id FOR UPDATE`;
    const invoices = await tx.invoice.findMany({
      where: { tenantId, studentId: payment.studentId, status: 'ISSUED' },
      include: { lines: { where: { kind: 'CHARGE' }, select: { dueDate: true } } },
    });
    const balances = await this.core.invoiceBalances(tx, tenantId, invoices.map((i) => i.id));
    const payMinor = await this.core.minorUnits(tx, payment.currency);
    const date = toIso(payment.receivedOn);
    const reportingMinor = await this.core.minorUnits(tx, payment.reportingCurrency);

    const plan: { invoice: (typeof invoices)[number]; payPart: Dec; invAmount: Dec; rate: Dec }[] = [];
    if (requested?.length) {
      let total = ZERO;
      for (const r of requested) {
        const invoice = invoices.find((i) => i.id === r.invoiceId);
        if (!invoice) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVOICE_NOT_PAYABLE', 'The invoice is not an open invoice of this student');
        const payPart = await this.core.amount(tx, r.amount, payment.currency);
        const rate = await this.core.rate(tx, tenantId, payment.currency, invoice.currency, date);
        const invAmount = round(payPart.times(rate.value), await this.core.minorUnits(tx, invoice.currency));
        if (invAmount.greaterThan(balances.get(invoice.id)!.balance)) {
          throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'ALLOCATION_EXCEEDS_BALANCE', `More than the balance of ${invoice.number}`);
        }
        total = total.plus(payPart);
        plan.push({ invoice, payPart, invAmount, rate: rate.value });
      }
      if (total.greaterThan(payment.amount)) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'ALLOCATION_EXCEEDS_PAYMENT', 'Allocations exceed the payment amount');
      }
    } else {
      const firstDue = (inv: (typeof invoices)[number]) =>
        inv.lines.reduce<string>((m, l) => (l.dueDate && toIso(l.dueDate) < m ? toIso(l.dueDate) : m), '9999-12-31');
      const ordered = [...invoices].sort(
        (x, y) => firstDue(x).localeCompare(firstDue(y)) || x.issueDate.getTime() - y.issueDate.getTime() || x.number.localeCompare(y.number),
      );
      let remaining = new Decimal(payment.amount);
      for (const invoice of ordered) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const balance = balances.get(invoice.id)!.balance;
        if (balance.lessThanOrEqualTo(0)) continue;
        const rate = await this.core.rate(tx, tenantId, payment.currency, invoice.currency, date);
        const invMinor = await this.core.minorUnits(tx, invoice.currency);
        const covers = round(remaining.times(rate.value), invMinor);
        let invAmount: Dec;
        let payPart: Dec;
        if (covers.lessThanOrEqualTo(balance)) {
          invAmount = covers;
          payPart = remaining;
        } else {
          invAmount = balance;
          payPart = Decimal.min(remaining, round(balance.dividedBy(rate.value), payMinor));
        }
        if (payPart.lessThanOrEqualTo(0) || invAmount.lessThanOrEqualTo(0)) continue;
        plan.push({ invoice, payPart, invAmount, rate: rate.value });
        remaining = remaining.minus(payPart);
      }
    }

    for (const p of plan) {
      // Realized difference: value of the settlement at the payment's rate vs at the invoice's issue rate.
      const exchangeDifference = round(
        p.payPart.times(payment.reportingRate).minus(p.invAmount.times(p.invoice.reportingRate)),
        reportingMinor,
      );
      await tx.paymentAllocation.create({
        data: {
          tenantId,
          paymentId: payment.id,
          invoiceId: p.invoice.id,
          amount: p.payPart,
          invoiceAmount: p.invAmount,
          rate: p.rate,
          exchangeDifference,
        },
      });
    }
  }

  private assertSameRequest(existing: Payment, input: PaymentInput) {
    if (existing.studentId !== input.studentId || existing.currency !== input.currency || !existing.amount.equals(new Decimal(input.amount))) {
      throw Errors.conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was used for a different payment');
    }
  }

  // ------------------------------------------------------------ queries

  list(a: Actor, filter: { studentId?: string; from?: string; to?: string; status?: string }) {
    return this.run(a, async (tx) => {
      const rows = await tx.payment.findMany({
        where: {
          tenantId: a.tenantId,
          ...(filter.studentId && { studentId: filter.studentId }),
          ...(filter.status && { status: filter.status as Payment['status'] }),
          ...((filter.from || filter.to) && {
            receivedOn: { ...(filter.from && { gte: toDate(filter.from) }), ...(filter.to && { lte: toDate(filter.to) }) },
          }),
        },
        include: paymentInclude,
        orderBy: [{ receivedOn: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      });
      return Promise.all(rows.map((p) => this.present(tx, p)));
    });
  }

  get(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const p = await tx.payment.findFirst({ where: { id, tenantId: a.tenantId }, include: paymentInclude });
      if (!p) throw Errors.notFound('Payment');
      return this.present(tx, p);
    });
  }

  /** Data for the printable receipt. */
  receipt(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const p = await tx.payment.findFirst({ where: { id, tenantId: a.tenantId }, include: paymentInclude });
      if (!p?.receipt) throw Errors.notFound('Receipt');
      const [tenant, recorder] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { legalName: true, tradingName: true, settings: true } }),
        p.recordedBy ? tx.user.findUnique({ where: { id: p.recordedBy }, select: { fullName: true } }) : null,
      ]);
      const open = await tx.invoice.findMany({ where: { tenantId: a.tenantId, studentId: p.studentId, status: 'ISSUED' }, select: { id: true, currency: true } });
      const balances = await this.core.invoiceBalances(tx, a.tenantId, open.map((i) => i.id));
      const remaining = new Map<string, Dec>();
      for (const inv of open) remaining.set(inv.currency, (remaining.get(inv.currency) ?? ZERO).plus(balances.get(inv.id)!.balance));
      return {
        school: { legalName: tenant.legalName, tradingName: tenant.tradingName },
        cashier: recorder?.fullName ?? null,
        payment: await this.present(tx, p),
        balancesAfter: await Promise.all([...remaining].map(async ([currency, v]) => ({ currency, balance: await this.core.format(tx, v, currency) }))),
      };
    });
  }

  // ------------------------------------------------------------ reversal and refunds

  /**
   * Reversal keeps the original payment, receipt and allocations; it marks the payment
   * REVERSED and dates the reversal entry today (an open period), so a closed period's
   * figures never change (FIN-013, §13.2 scenario 11).
   */
  reverse(a: Actor, id: string, input: ReasonInput) {
    return this.run(a, async (tx) => {
      const p = await this.lockPayment(tx, a, id);
      if (p.status !== 'CONFIRMED') throw Errors.conflict('PAYMENT_NOT_CONFIRMED', 'Only a confirmed payment can be reversed');
      const refunded = await tx.refund.count({ where: { tenantId: a.tenantId, paymentId: id, status: { in: ['REQUESTED', 'APPROVED'] } } });
      if (refunded > 0) throw Errors.conflict('PAYMENT_HAS_REFUNDS', 'This payment has refunds; settle them before reversing');
      const today = this.core.today(a);
      await this.core.assertPeriodOpen(tx, a.tenantId, today);
      await tx.payment.update({
        where: { id },
        data: { status: 'REVERSED', reversedAt: new Date(), reversedBy: a.userId, reversalReason: input.reason, reversalDate: toDate(today) },
      });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'payment.reversed',
          entityType: 'payment',
          entityId: id,
          metadata: { reason: input.reason, amount: p.amount.toString(), currency: p.currency, receivedOn: toIso(p.receivedOn), reversalDate: today },
          ip: a.ip,
        },
        tx,
      );
      return this.present(tx, await tx.payment.findUniqueOrThrow({ where: { id }, include: paymentInclude }));
    });
  }

  /** Refunds return unallocated credit only; the requested amount is reserved until decided. */
  requestRefund(a: Actor, paymentId: string, input: RefundRequestInput) {
    return this.run(a, async (tx) => {
      const p = await this.lockPayment(tx, a, paymentId);
      if (p.status !== 'CONFIRMED') throw Errors.conflict('PAYMENT_NOT_CONFIRMED', 'Only a confirmed payment can be refunded');
      const amount = await this.core.amount(tx, input.amount, p.currency);
      const credit = await this.credit(tx, a.tenantId, p);
      if (amount.greaterThan(credit)) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'REFUND_EXCEEDS_CREDIT', 'Refunds are limited to the payment\'s unallocated credit', {
          credit: await this.core.format(tx, credit, p.currency),
        });
      }
      const refund = await tx.refund.create({
        data: { tenantId: a.tenantId, paymentId, amount, reason: input.reason, requestedBy: a.userId },
      });
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'refund.requested', entityType: 'refund', entityId: refund.id, metadata: { paymentId, amount: amount.toString(), currency: p.currency, reason: input.reason }, ip: a.ip },
        tx,
      );
      return { id: refund.id, status: refund.status, amount: await this.core.format(tx, amount, p.currency) };
    });
  }

  /** The person who requested a refund can never approve it (separation of duties, §3.3). */
  decideRefund(a: Actor, refundId: string, input: RefundDecisionInput) {
    return this.run(a, async (tx) => {
      await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${refundId}::uuid AND tenant_id = ${a.tenantId}::uuid FOR UPDATE`;
      const r = await tx.refund.findFirst({ where: { id: refundId, tenantId: a.tenantId }, include: { payment: true } });
      if (!r) throw Errors.notFound('Refund');
      if (r.status !== 'REQUESTED') throw Errors.conflict('REFUND_ALREADY_DECIDED', 'This refund has already been decided');
      if (r.requestedBy === a.userId) throw Errors.forbidden('You cannot approve a refund you requested');
      if (input.approve) await this.core.assertPeriodOpen(tx, a.tenantId, this.core.today(a));
      const status = input.approve ? 'APPROVED' : 'REJECTED';
      await tx.refund.update({ where: { id: refundId }, data: { status, decidedBy: a.userId, decidedAt: new Date(), decisionNote: input.note } });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: `refund.${status.toLowerCase()}`,
          entityType: 'refund',
          entityId: refundId,
          metadata: { paymentId: r.paymentId, amount: r.amount.toString(), currency: r.payment.currency, note: input.note ?? null },
          ip: a.ip,
        },
        tx,
      );
      return { id: refundId, status };
    });
  }

  listRefunds(a: Actor, status?: string) {
    return this.run(a, async (tx) => {
      const rows = await tx.refund.findMany({
        where: { tenantId: a.tenantId, ...(status && { status: status as 'REQUESTED' }) },
        include: { payment: { include: { student: { select: { id: true, matricule: true, firstName: true, lastName: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          status: r.status,
          amount: await this.core.format(tx, r.amount, r.payment.currency),
          currency: r.payment.currency,
          reason: r.reason,
          paymentId: r.paymentId,
          student: r.payment.student,
          requestedBy: r.requestedBy,
          isMine: r.requestedBy === a.userId,
          createdAt: r.createdAt.toISOString(),
        })),
      );
    });
  }

  // ------------------------------------------------------------ provider callbacks

  /**
   * Public endpoint for Mobile Money / card providers. The body must be signed with the
   * school's provider secret. Each (transaction, status) is processed once; a payment is
   * confirmed only on SUCCESS with the exact amount and currency (FIN-009/010).
   */
  async providerCallback(tenantSlug: string, providerCode: string, rawBody: Buffer | undefined, signature: string | undefined) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, status: true } });
    if (!tenant || tenant.status !== 'ACTIVE' || !rawBody) throw Errors.notFound();
    try {
      return await this.prisma.scoped({ tenantId: tenant.id }, (tx) => this.callbackTx(tx, tenant.id, providerCode, rawBody, signature));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && e.meta?.modelName === 'PaymentProviderEvent') {
        return { received: true, outcome: 'duplicate' };
      }
      throw e;
    }
  }

  private async callbackTx(tx: Tx, tenantId: string, providerCode: string, rawBody: Buffer, signature: string | undefined) {
    const provider = await tx.paymentProvider.findUnique({ where: { tenantId_code: { tenantId, code: providerCode } } });
    // Operator providers (MTN, Orange) never use this signed endpoint; their notifications go to /notify.
    if (!provider?.isActive || provider.kind !== 'SIGNED_WEBHOOK') throw Errors.notFound();
    if (!signatureValid(decryptSecret(provider.secretEncrypted), rawBody, signature)) {
      this.logger.warn(`Rejected unsigned or mis-signed ${providerCode} callback for tenant ${tenantId}`);
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Invalid callback signature');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw Errors.validation([{ path: '', code: 'invalid_json', message: 'Body is not JSON' }]);
    }
    const body = providerCallbackSchema.safeParse(parsed);
    if (!body.success) throw Errors.validation(body.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })));
    const cb = body.data;

    const seen = await tx.paymentProviderEvent.findUnique({
      where: { tenantId_provider_providerTxId_providerStatus: { tenantId, provider: providerCode, providerTxId: cb.transactionId, providerStatus: cb.status } },
    });
    if (seen) return { received: true, outcome: 'duplicate' };

    const payment = await tx.payment.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: cb.reference } } });
    const outcome = await this.applyProviderResult(tx, tenantId, providerCode, payment, cb, cb as unknown as Prisma.InputJsonValue);
    return { received: true, outcome };
  }

  /**
   * Applies one provider result to a pending payment, once per (transaction, status). Shared by signed
   * webhooks and by operator status checks. A payment is confirmed only on SUCCESS with the exact amount
   * and currency we asked for; anything unexpected stays pending for review (FIN-009/010).
   */
  async applyProviderResult(
    tx: Tx,
    tenantId: string,
    providerCode: string,
    payment: Payment | null,
    cb: { transactionId: string; status: 'SUCCESS' | 'FAILED' | 'PENDING'; amount: string; currency: string; reason?: string | null },
    payload: Prisma.InputJsonValue,
  ): Promise<string> {
    let outcome: string;
    if (!payment || payment.provider !== providerCode) {
      outcome = 'unknown_payment';
    } else if (cb.status === 'PENDING') {
      outcome = 'still_pending';
    } else if (payment.status !== 'PENDING_VERIFICATION') {
      outcome = `ignored_${payment.status.toLowerCase()}`;
    } else if (cb.status === 'FAILED') {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', externalReference: cb.transactionId, failureReason: cb.reason?.slice(0, 200) ?? null },
      });
      outcome = 'failed';
    } else if (cb.currency !== payment.currency || !new Decimal(cb.amount).equals(payment.amount)) {
      // Never confirm an amount we did not expect; it stays pending for manual review.
      outcome = 'amount_mismatch';
    } else {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), externalReference: cb.transactionId },
      });
      await this.settle(tx, tenantId, null, updated);
      outcome = 'confirmed';
    }

    await tx.paymentProviderEvent.create({
      data: {
        tenantId,
        provider: providerCode,
        providerTxId: cb.transactionId,
        providerStatus: cb.status,
        payload,
        paymentId: payment?.id,
        outcome,
      },
    });
    await this.audit.record(
      {
        tenantId,
        action: 'payment.provider_callback',
        entityType: 'payment',
        entityId: payment?.id,
        metadata: { provider: providerCode, transactionId: cb.transactionId, status: cb.status, outcome },
      },
      tx,
    );
    return outcome;
  }

  // ------------------------------------------------------------ cash registers

  openSession(a: Actor, input: CashierOpenInput) {
    return this.run(a, async (tx) => {
      await this.core.assertEnabled(tx, a.tenantId, input.currency);
      const float = await this.core.amount(tx, input.openingFloat, input.currency);
      const existing = await tx.cashierSession.findFirst({ where: { tenantId: a.tenantId, cashierId: a.userId, currency: input.currency, status: 'OPEN' } });
      if (existing) throw Errors.conflict('SESSION_ALREADY_OPEN', 'You already have an open cash register in this currency');
      const s = await tx.cashierSession.create({ data: { tenantId: a.tenantId, cashierId: a.userId, currency: input.currency, openingFloat: float } });
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'cashier_session.opened', entityType: 'cashier_session', entityId: s.id, metadata: { currency: input.currency, openingFloat: float.toString() }, ip: a.ip },
        tx,
      );
      return this.sessionReport(tx, a.tenantId, s.id);
    });
  }

  mySessions(a: Actor) {
    return this.run(a, async (tx) => {
      const open = await tx.cashierSession.findMany({ where: { tenantId: a.tenantId, cashierId: a.userId, status: 'OPEN' }, orderBy: { openedAt: 'asc' } });
      return Promise.all(open.map((s) => this.sessionReport(tx, a.tenantId, s.id)));
    });
  }

  listSessions(a: Actor) {
    return this.run(a, async (tx) => {
      const rows = await tx.cashierSession.findMany({ where: { tenantId: a.tenantId }, orderBy: { openedAt: 'desc' }, take: 100 });
      return Promise.all(rows.map((s) => this.sessionReport(tx, a.tenantId, s.id)));
    });
  }

  /** Closing compares the counted cash with what was recorded; any gap is kept as a discrepancy (FIN-014). */
  closeSession(a: Actor, id: string, input: CashierCloseInput) {
    return this.run(a, async (tx) => {
      await tx.$queryRaw`SELECT id FROM cashier_sessions WHERE id = ${id}::uuid AND tenant_id = ${a.tenantId}::uuid FOR UPDATE`;
      const s = await tx.cashierSession.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!s) throw Errors.notFound('Cash register session');
      if (s.cashierId !== a.userId) throw Errors.forbidden('Only the cashier who opened this register can close it');
      if (s.status !== 'OPEN') throw Errors.conflict('SESSION_CLOSED', 'This cash register is already closed');
      const counted = await this.core.amount(tx, input.countedAmount, s.currency);
      const expected = s.openingFloat.plus(await this.cashTaken(tx, a.tenantId, s.id));
      const discrepancy = counted.minus(expected);
      await tx.cashierSession.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date(), expectedAmount: expected, countedAmount: counted, discrepancy, notes: input.notes },
      });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: discrepancy.isZero() ? 'cashier_session.closed' : 'cashier_session.closed_with_discrepancy',
          entityType: 'cashier_session',
          entityId: id,
          metadata: { expected: expected.toString(), counted: counted.toString(), discrepancy: discrepancy.toString(), currency: s.currency },
          ip: a.ip,
        },
        tx,
      );
      return this.sessionReport(tx, a.tenantId, id);
    });
  }

  private async cashTaken(tx: Tx, tenantId: string, sessionId: string): Promise<Dec> {
    const agg = await tx.payment.aggregate({ where: { tenantId, cashierSessionId: sessionId, status: 'CONFIRMED' }, _sum: { amount: true } });
    return agg._sum.amount ?? ZERO;
  }

  private async sessionReport(tx: Tx, tenantId: string, id: string) {
    const s = await tx.cashierSession.findUniqueOrThrow({ where: { id } });
    const [cashier, payments] = await Promise.all([
      tx.user.findUnique({ where: { id: s.cashierId }, select: { fullName: true } }),
      tx.payment.findMany({
        where: { tenantId, cashierSessionId: id },
        include: { student: { select: { firstName: true, lastName: true, matricule: true } }, receipt: { select: { number: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const taken = sum(payments.filter((p) => p.status === 'CONFIRMED').map((p) => p.amount));
    const f = (v: Dec | null) => (v === null ? Promise.resolve(null) : this.core.format(tx, v, s.currency));
    return {
      id: s.id,
      cashier: cashier?.fullName ?? null,
      currency: s.currency,
      status: s.status,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      openingFloat: await f(s.openingFloat),
      cashTaken: await f(taken),
      expectedAmount: await f(s.expectedAmount ?? s.openingFloat.plus(taken)),
      countedAmount: await f(s.countedAmount),
      discrepancy: await f(s.discrepancy),
      payments: await Promise.all(
        payments.map(async (p) => ({
          id: p.id,
          receipt: p.receipt?.number ?? null,
          student: `${p.student.lastName} ${p.student.firstName}`,
          amount: await this.core.format(tx, p.amount, p.currency),
          status: p.status,
        })),
      ),
    };
  }

  // ------------------------------------------------------------ helpers

  private async lockPayment(tx: Tx, a: Actor, id: string) {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id}::uuid AND tenant_id = ${a.tenantId}::uuid FOR UPDATE`;
    const p = await tx.payment.findFirst({ where: { id, tenantId: a.tenantId } });
    if (!p) throw Errors.notFound('Payment');
    return p;
  }

  /** Unallocated part of a payment, minus refunds requested or approved. */
  private async credit(tx: Tx, tenantId: string, p: Payment): Promise<Dec> {
    const [alloc, refunds] = await Promise.all([
      tx.paymentAllocation.aggregate({ where: { tenantId, paymentId: p.id }, _sum: { amount: true } }),
      tx.refund.aggregate({ where: { tenantId, paymentId: p.id, status: { in: ['REQUESTED', 'APPROVED'] } }, _sum: { amount: true } }),
    ]);
    return p.amount.minus(alloc._sum.amount ?? ZERO).minus(refunds._sum.amount ?? ZERO);
  }

  private async present(tx: Tx, p: PaymentFull) {
    const f = (v: Dec, c: string) => this.core.format(tx, v, c);
    const allocated = sum(p.allocations.map((x) => x.amount));
    const reserved = sum(p.refunds.filter((r) => r.status !== 'REJECTED').map((r) => r.amount));
    return {
      id: p.id,
      status: p.status,
      receipt: p.receipt?.number ?? null,
      student: p.student,
      method: p.method,
      currency: p.currency,
      amount: await f(p.amount, p.currency),
      receivedOn: toIso(p.receivedOn),
      externalReference: p.externalReference,
      provider: p.provider,
      idempotencyKey: p.idempotencyKey,
      reporting: { currency: p.reportingCurrency, amount: await f(p.reportingAmount, p.reportingCurrency), rate: p.reportingRate.toString() },
      allocations: await Promise.all(
        p.allocations.map(async (al) => ({
          invoiceId: al.invoiceId,
          invoiceNumber: al.invoice.number,
          amount: await f(al.amount, p.currency),
          invoiceAmount: await f(al.invoiceAmount, al.invoice.currency),
          invoiceCurrency: al.invoice.currency,
          rate: al.rate.toString(),
          exchangeDifference: await f(al.exchangeDifference, p.reportingCurrency),
        })),
      ),
      credit: p.status === 'CONFIRMED' ? await f(p.amount.minus(allocated).minus(reserved), p.currency) : await f(ZERO, p.currency),
      refunds: await Promise.all(p.refunds.map(async (r) => ({ id: r.id, status: r.status, amount: await f(r.amount, p.currency), reason: r.reason }))),
      reversal: p.reversedAt ? { at: p.reversedAt.toISOString(), date: p.reversalDate ? toIso(p.reversalDate) : null, reason: p.reversalReason } : null,
    };
  }
}
