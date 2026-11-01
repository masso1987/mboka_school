import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { nextCounter } from '../common/counters';
import { toDate, toIso } from '../common/dates';
import type { Tx } from '../prisma/prisma.service';

export const Decimal = Prisma.Decimal;
export type Dec = Prisma.Decimal;
export const ZERO = new Prisma.Decimal(0);
export const ONE = new Prisma.Decimal(1);

/** Rounding rule (CUR-012): half-up to the currency's minor units, applied once per converted amount. */
export function round(value: Dec, minorUnits: number): Dec {
  return value.toDecimalPlaces(minorUnits, Prisma.Decimal.ROUND_HALF_UP);
}

export function sum(values: Iterable<Dec>): Dec {
  let total = ZERO;
  for (const v of values) total = total.plus(v);
  return total;
}

export const min = (a: Dec, b: Dec) => (a.lessThan(b) ? a : b);

export interface Rate {
  /** 1 `from` = `value` `to`. */
  value: Dec;
  effectiveDate: string | null;
}

export interface FinanceSettingsView {
  reportingCurrency: string;
  enabledCurrencies: string[];
  expenseApprovalThreshold: Dec;
}

/** Finance rules every finance service relies on: currencies, rates, periods, numbering. */
@Injectable()
export class FinanceCore {
  private minorUnitsCache: Map<string, number> | undefined;

  async settings(tx: Tx, tenantId: string): Promise<FinanceSettingsView> {
    let s = await tx.financeSettings.findUnique({ where: { tenantId } });
    if (!s) {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCurrency: true } });
      s = await tx.financeSettings.create({
        data: {
          tenantId,
          reportingCurrency: tenant.defaultCurrency,
          enabledCurrencies: [tenant.defaultCurrency],
          expenseApprovalThreshold: new Decimal(500000),
        },
      });
    }
    return {
      reportingCurrency: s.reportingCurrency,
      enabledCurrencies: s.enabledCurrencies,
      expenseApprovalThreshold: s.expenseApprovalThreshold,
    };
  }

  async minorUnits(tx: Tx, currency: string): Promise<number> {
    if (!this.minorUnitsCache) {
      const all = await tx.currency.findMany();
      this.minorUnitsCache = new Map(all.map((c) => [c.code, c.minorUnits]));
    }
    const units = this.minorUnitsCache.get(currency);
    if (units === undefined) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'UNKNOWN_CURRENCY', `Unknown currency ${currency}`);
    return units;
  }

  /** Parses an API amount and rejects more decimals than the currency allows (e.g. "100.5" XAF). */
  async amount(tx: Tx, value: string, currency: string): Promise<Dec> {
    const units = await this.minorUnits(tx, currency);
    const d = new Decimal(value);
    if (d.decimalPlaces() > units) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'AMOUNT_PRECISION', `${currency} amounts allow ${units} decimal place(s)`, {
        currency,
        minorUnits: units,
      });
    }
    return d;
  }

  async format(tx: Tx, value: Dec, currency: string): Promise<string> {
    return round(value, await this.minorUnits(tx, currency)).toFixed(await this.minorUnits(tx, currency));
  }

  async assertEnabled(tx: Tx, tenantId: string, currency: string): Promise<void> {
    const s = await this.settings(tx, tenantId);
    if (!s.enabledCurrencies.includes(currency)) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'CURRENCY_NOT_ENABLED', `${currency} is not enabled for this school`);
    }
  }

  /**
   * Rate in force on `date` (latest effective_date ≤ date), using the inverse pair if only
   * that one is recorded. Never applies a later rate to an earlier transaction (CUR-006).
   */
  async rate(tx: Tx, tenantId: string, from: string, to: string, date: string): Promise<Rate> {
    if (from === to) return { value: ONE, effectiveDate: null };
    const on = toDate(date);
    const [direct, inverse] = await Promise.all([
      tx.exchangeRate.findFirst({
        where: { tenantId, baseCurrency: from, quoteCurrency: to, effectiveDate: { lte: on } },
        orderBy: { effectiveDate: 'desc' },
      }),
      tx.exchangeRate.findFirst({
        where: { tenantId, baseCurrency: to, quoteCurrency: from, effectiveDate: { lte: on } },
        orderBy: { effectiveDate: 'desc' },
      }),
    ]);
    const pick = direct && (!inverse || direct.effectiveDate >= inverse.effectiveDate) ? direct : inverse;
    if (!pick) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'RATE_MISSING', `No ${from}/${to} exchange rate in force on ${date}`, {
        from,
        to,
        date,
      });
    }
    const value = pick === direct ? pick.rate : ONE.dividedBy(pick.rate).toDecimalPlaces(10, Prisma.Decimal.ROUND_HALF_UP);
    return { value, effectiveDate: toIso(pick.effectiveDate) };
  }

  /** Refuses any posting dated inside a closed financial period (EXP-010, §13.2 scenario 11). */
  async assertPeriodOpen(tx: Tx, tenantId: string, date: string): Promise<void> {
    const closed = await tx.financialPeriod.findFirst({
      where: { tenantId, status: 'CLOSED', startDate: { lte: toDate(date) }, endDate: { gte: toDate(date) } },
      select: { name: true },
    });
    if (closed) {
      throw new ApiException(HttpStatus.CONFLICT, 'PERIOD_CLOSED', `The financial period ${closed.name} is closed`, { period: closed.name, date });
    }
  }

  /** e.g. INV-2026-00042 — unique per school, gap-free per year under concurrency. */
  async number(tx: Tx, tenantId: string, prefix: string, date: string, width = 5): Promise<string> {
    const year = date.slice(0, 4);
    const n = await nextCounter(tx, tenantId, `${prefix}:${year}`);
    return `${prefix}-${year}-${String(n).padStart(width, '0')}`;
  }

  /** Recomputes balances of invoices from lines and confirmed allocations (never cached). */
  async invoiceBalances(tx: Tx, tenantId: string, invoiceIds: string[]) {
    if (invoiceIds.length === 0) return new Map<string, InvoiceBalance>();
    const [lines, allocations] = await Promise.all([
      tx.invoiceLine.groupBy({
        by: ['invoiceId', 'kind'],
        where: { tenantId, invoiceId: { in: invoiceIds } },
        _sum: { amount: true },
      }),
      tx.paymentAllocation.groupBy({
        by: ['invoiceId'],
        where: { tenantId, invoiceId: { in: invoiceIds }, payment: { status: 'CONFIRMED' } },
        _sum: { invoiceAmount: true },
      }),
    ]);
    const result = new Map<string, InvoiceBalance>();
    for (const id of invoiceIds) result.set(id, { charges: ZERO, discounts: ZERO, total: ZERO, paid: ZERO, balance: ZERO });
    for (const l of lines) {
      const b = result.get(l.invoiceId)!;
      if (l.kind === 'CHARGE') b.charges = l._sum.amount ?? ZERO;
      else b.discounts = l._sum.amount ?? ZERO;
    }
    for (const a of allocations) result.get(a.invoiceId)!.paid = a._sum.invoiceAmount ?? ZERO;
    for (const b of result.values()) {
      b.total = b.charges.minus(b.discounts);
      b.balance = b.total.minus(b.paid);
    }
    return result;
  }

  today(a: Actor): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: a.timezone }).format(new Date());
  }

  assertNotFuture(a: Actor, date: string, what = 'date'): void {
    if (date > this.today(a)) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'DATE_IN_FUTURE', `The ${what} cannot be in the future`);
    }
  }
}

export interface InvoiceBalance {
  charges: Dec;
  discounts: Dec;
  total: Dec;
  paid: Dec;
  balance: Dec;
}

export const notFound = Errors.notFound;
