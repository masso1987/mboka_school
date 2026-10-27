import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  ExchangeRateInput,
  FinanceSettingsInput,
  FinancialPeriodInput,
  ProviderConfigInput,
} from '@mboka/shared';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toDate, toIso } from '../common/dates';
import { guardDb } from '../common/db-errors';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { Decimal, FinanceCore } from './finance-core';
import { encryptSecret } from './secrets';

/** Currencies, exchange-rate history, financial periods and provider credentials (Module 9, EXP-010). */
@Injectable()
export class FinanceSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly core: FinanceCore,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  getSettings(a: Actor) {
    return this.run(a, async (tx) => {
      const s = await this.core.settings(tx, a.tenantId);
      const [currencies, providers] = await Promise.all([
        tx.currency.findMany({ orderBy: { code: 'asc' } }),
        tx.paymentProvider.findMany({ where: { tenantId: a.tenantId, isActive: true }, select: { code: true } }),
      ]);
      return {
        reportingCurrency: s.reportingCurrency,
        enabledCurrencies: s.enabledCurrencies,
        expenseApprovalThreshold: await this.core.format(tx, s.expenseApprovalThreshold, s.reportingCurrency),
        currencies,
        /** Codes only — cashiers need to pick a provider; secrets never leave the server. */
        providers: providers.map((p) => p.code),
      };
    });
  }

  /** The reporting currency is fixed once set: changing it would silently re-denominate history (CUR-002). */
  updateSettings(a: Actor, input: FinanceSettingsInput) {
    return this.run(a, async (tx) => {
      const before = await this.core.settings(tx, a.tenantId);
      const enabled = [...new Set(input.enabledCurrencies)];
      for (const c of enabled) await this.core.minorUnits(tx, c);
      if (!enabled.includes(before.reportingCurrency)) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'REPORTING_CURRENCY_REQUIRED', 'The reporting currency must stay enabled');
      }
      const threshold = await this.core.amount(tx, input.expenseApprovalThreshold, before.reportingCurrency);
      await tx.financeSettings.update({
        where: { tenantId: a.tenantId },
        data: { enabledCurrencies: enabled, expenseApprovalThreshold: threshold },
      });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'finance.settings_changed',
          metadata: {
            before: { enabledCurrencies: before.enabledCurrencies, threshold: before.expenseApprovalThreshold.toString() },
            after: { enabledCurrencies: enabled, threshold: threshold.toString() },
          },
          ip: a.ip,
        },
        tx,
      );
      return this.getSettingsTx(tx, a);
    });
  }

  private async getSettingsTx(tx: Tx, a: Actor) {
    const s = await this.core.settings(tx, a.tenantId);
    return {
      reportingCurrency: s.reportingCurrency,
      enabledCurrencies: s.enabledCurrencies,
      expenseApprovalThreshold: await this.core.format(tx, s.expenseApprovalThreshold, s.reportingCurrency),
    };
  }

  // ------------------------------------------------------------ exchange rates

  listRates(a: Actor) {
    return this.run(a, async (tx) => {
      const rows = await tx.exchangeRate.findMany({
        where: { tenantId: a.tenantId },
        orderBy: [{ effectiveDate: 'desc' }, { baseCurrency: 'asc' }],
        take: 200,
      });
      return rows.map((r) => ({
        id: r.id,
        baseCurrency: r.baseCurrency,
        quoteCurrency: r.quoteCurrency,
        rate: r.rate.toString(),
        effectiveDate: toIso(r.effectiveDate),
        source: r.source,
        label: `1 ${r.baseCurrency} = ${r.rate.toString()} ${r.quoteCurrency}`,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  /** Rates are append-only: a correction is a new rate with a later effective date (CUR-011). */
  createRate(a: Actor, input: ExchangeRateInput) {
    return guardDb(
      this.run(a, async (tx) => {
        await this.core.minorUnits(tx, input.baseCurrency);
        await this.core.minorUnits(tx, input.quoteCurrency);
        const rate = await tx.exchangeRate.create({
          data: {
            tenantId: a.tenantId,
            baseCurrency: input.baseCurrency,
            quoteCurrency: input.quoteCurrency,
            rate: new Decimal(input.rate),
            effectiveDate: toDate(input.effectiveDate),
            createdBy: a.userId,
          },
        });
        await this.audit.record(
          {
            tenantId: a.tenantId,
            actorId: a.userId,
            action: 'exchange_rate.created',
            entityType: 'exchange_rate',
            entityId: rate.id,
            metadata: { rate: `1 ${input.baseCurrency} = ${input.rate} ${input.quoteCurrency}`, effectiveDate: input.effectiveDate },
            ip: a.ip,
          },
          tx,
        );
        return { id: rate.id, label: `1 ${rate.baseCurrency} = ${rate.rate.toString()} ${rate.quoteCurrency}`, effectiveDate: input.effectiveDate };
      }),
      { ExchangeRate: () => Errors.conflict('RATE_EXISTS', 'A rate for this pair and date already exists; use a later effective date') },
    );
  }

  // ------------------------------------------------------------ periods

  listPeriods(a: Actor) {
    return this.run(a, async (tx) => {
      const rows = await tx.financialPeriod.findMany({ where: { tenantId: a.tenantId }, orderBy: { startDate: 'desc' } });
      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        startDate: toIso(p.startDate),
        endDate: toIso(p.endDate),
        status: p.status,
        closedAt: p.closedAt?.toISOString() ?? null,
      }));
    });
  }

  createPeriod(a: Actor, input: FinancialPeriodInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const p = await tx.financialPeriod.create({
          data: { tenantId: a.tenantId, name: input.name, startDate: toDate(input.startDate), endDate: toDate(input.endDate) },
        });
        await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'financial_period.created', entityType: 'financial_period', entityId: p.id, ip: a.ip }, tx);
        return { id: p.id, name: p.name, status: p.status };
      }),
      { financial_periods_no_overlap: () => Errors.conflict('PERIOD_OVERLAP', 'This period overlaps another financial period') },
    );
  }

  /**
   * Closing is one-way in this release: reopening a closed period would let history change
   * under already-issued reports. Corrections are posted in the next open period instead.
   * Payments still pending verification inside the period block the close.
   */
  closePeriod(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const p = await tx.financialPeriod.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!p) throw Errors.notFound('Financial period');
      if (p.status === 'CLOSED') throw Errors.conflict('PERIOD_ALREADY_CLOSED', 'This period is already closed');
      const pending = await tx.payment.count({
        where: { tenantId: a.tenantId, status: 'PENDING_VERIFICATION', receivedOn: { gte: p.startDate, lte: p.endDate } },
      });
      if (pending > 0) {
        throw Errors.conflict('PENDING_PAYMENTS_IN_PERIOD', `${pending} payment(s) still await provider verification in this period`);
      }
      const openTills = await tx.cashierSession.count({ where: { tenantId: a.tenantId, status: 'OPEN', openedAt: { lte: endOfDay(p.endDate) } } });
      if (openTills > 0) throw Errors.conflict('OPEN_CASHIER_SESSIONS', 'Close every cash register opened in this period first');
      await tx.financialPeriod.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), closedBy: a.userId } });
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'financial_period.closed', entityType: 'financial_period', entityId: id, metadata: { name: p.name }, ip: a.ip },
        tx,
      );
      return { id, status: 'CLOSED' as const };
    });
  }

  // ------------------------------------------------------------ providers

  listProviders(a: Actor) {
    return this.run(a, (tx) =>
      tx.paymentProvider.findMany({ where: { tenantId: a.tenantId }, select: { code: true, isActive: true, createdAt: true } }),
    );
  }

  /** Stores (or rotates) a provider's callback signing secret, encrypted. The secret is never returned. */
  configureProvider(a: Actor, input: ProviderConfigInput) {
    return this.run(a, async (tx) => {
      const secretEncrypted = encryptSecret(input.secret);
      await tx.paymentProvider.upsert({
        where: { tenantId_code: { tenantId: a.tenantId, code: input.code } },
        create: { tenantId: a.tenantId, code: input.code, secretEncrypted },
        update: { secretEncrypted, isActive: true },
      });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'payment_provider.configured', metadata: { code: input.code }, ip: a.ip }, tx);
      return { code: input.code, isActive: true };
    });
  }
}

function endOfDay(d: Date): Date {
  return new Date(d.getTime() + 24 * 3600_000 - 1);
}
