import { HttpStatus, Injectable } from '@nestjs/common';
import {
  computePayslip,
  declarationTotals,
  DEFAULT_PAYROLL_RULES_CM,
  payrollRulesSchema,
  type PayItem,
  type PayrollRules,
  type PayslipInput,
  type PayslipResult,
} from '@mboka/shared';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toIso } from '../common/dates';
import { PrismaService, type Tx } from '../prisma/prisma.service';

/** Payroll is computed in the currency of the Cameroonian rules. */
const PAYROLL_CURRENCY = 'XAF';

export interface StoredInput {
  /** Recurring allowances copied from the compensation record when the payslip is (re)built. */
  allowances: PayItem[];
  /** Monthly variables entered on the draft: overtime, bonuses, advances… */
  items: PayItem[];
  unpaidDays: number;
}

export interface Employee {
  staffNumber: string;
  firstName: string;
  lastName: string;
  position: string;
}

const franc = (v: Prisma.Decimal | string) => new Decimal(v.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);
const periodStart = (p: string) => new Date(`${p}-01T00:00:00Z`);
const periodEnd = (p: string) => {
  const d = periodStart(p);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
};
const periodLabel = (d: Date) => toIso(d).slice(0, 7);

/**
 * Monthly payroll (Phase 6): a draft run builds one payslip per active employee from their latest
 * compensation; HR enters the month's variables; the run is submitted, approved by someone else, then
 * marked paid. From submission on, payslips are frozen by the database, and every figure can be
 * recomputed from the rule snapshot kept on the run. Amounts never go into the audit log.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  // ------------------------------------------------------------ rules

  private async currentRules(tx: Tx, tenantId: string): Promise<{ version: number; rules: PayrollRules }> {
    const v = await tx.payrollRuleVersion.findFirst({ where: { tenantId }, orderBy: { version: 'desc' } });
    return v ? { version: v.version, rules: v.rules as unknown as PayrollRules } : { version: 0, rules: DEFAULT_PAYROLL_RULES_CM };
  }

  rules(a: Actor) {
    return this.run(a, (tx) => this.currentRules(tx, a.tenantId));
  }

  /** A rule change is a new version; existing runs keep the snapshot they were computed with. */
  updateRules(a: Actor, input: PayrollRules) {
    const rules = payrollRulesSchema.parse(input);
    return this.run(a, async (tx) => {
      const { version } = await this.currentRules(tx, a.tenantId);
      const created = await tx.payrollRuleVersion.create({
        data: { tenantId: a.tenantId, version: version + 1, rules: rules as unknown as Prisma.InputJsonValue, createdBy: a.userId },
      });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'payroll.rules_changed', metadata: { version: created.version }, ip: a.ip }, tx);
      return { version: created.version, rules };
    });
  }

  // ------------------------------------------------------------ runs

  listRuns(a: Actor) {
    return this.run(a, async (tx) => {
      const runs = await tx.payrollRun.findMany({ where: { tenantId: a.tenantId }, orderBy: { period: 'desc' }, include: { payslips: { select: { gross: true, net: true, employerCost: true } } } });
      return runs.map((r) => ({
        id: r.id,
        period: periodLabel(r.period),
        status: r.status,
        headcount: r.payslips.length,
        gross: r.payslips.reduce((s, p) => s.plus(p.gross.toString()), new Decimal(0)).toFixed(0),
        net: r.payslips.reduce((s, p) => s.plus(p.net.toString()), new Decimal(0)).toFixed(0),
        employerCost: r.payslips.reduce((s, p) => s.plus(p.employerCost.toString()), new Decimal(0)).toFixed(0),
      }));
    });
  }

  createRun(a: Actor, period: string) {
    return this.run(a, async (tx) => {
      const existing = await tx.payrollRun.findUnique({ where: { tenantId_period: { tenantId: a.tenantId, period: periodStart(period) } } });
      if (existing) throw Errors.conflict('PAYROLL_RUN_EXISTS', `Payroll for ${period} already exists`);
      const { version, rules } = await this.currentRules(tx, a.tenantId);
      const run = await tx.payrollRun.create({
        data: {
          tenantId: a.tenantId,
          period: periodStart(period),
          currency: PAYROLL_CURRENCY,
          rulesVersion: version,
          rules: rules as unknown as Prisma.InputJsonValue,
          createdBy: a.userId,
        },
      });
      const skipped = await this.build(tx, a, run.id, period, rules);
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'payroll.run_created', entityType: 'payroll_run', entityId: run.id, metadata: { period, rulesVersion: version }, ip: a.ip }, tx);
      return { ...(await this.detail(tx, a, run.id)), skipped };
    });
  }

  /**
   * (Re)builds the payslips of a draft from staff and compensation, keeping the variables already entered.
   * Returns who was left out and why, so nobody is silently unpaid.
   */
  private async build(tx: Tx, a: Actor, runId: string, period: string, rules: PayrollRules) {
    const start = periodStart(period);
    const end = periodEnd(period);
    const staff = await tx.staff.findMany({
      where: { tenantId: a.tenantId, status: 'ACTIVE' },
      include: {
        compensations: { where: { effectiveFrom: { lte: end } }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], take: 1 },
        contracts: { orderBy: { startDate: 'desc' }, take: 1 },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const existing = new Map((await tx.payslip.findMany({ where: { runId } })).map((p) => [p.staffId, p]));
    const skipped: { staffId: string; name: string; reason: 'NO_COMPENSATION' | 'OTHER_CURRENCY' | 'CONTRACT_ENDED' }[] = [];
    let sequence = (await tx.payslip.count({ where: { tenantId: a.tenantId, number: { startsWith: `PAY-${period.replace('-', '')}-` } } })) + 1;

    for (const s of staff) {
      const name = `${s.lastName} ${s.firstName}`;
      const comp = s.compensations[0];
      const contract = s.contracts[0];
      if (!comp) skipped.push({ staffId: s.id, name, reason: 'NO_COMPENSATION' });
      else if (comp.currency !== PAYROLL_CURRENCY) skipped.push({ staffId: s.id, name, reason: 'OTHER_CURRENCY' });
      else if (contract?.endDate && contract.endDate < start) skipped.push({ staffId: s.id, name, reason: 'CONTRACT_ENDED' });
      else {
        const allowances = ((comp.allowances ?? []) as { label: string; amount: string; taxable?: boolean }[]).map(
          (al): PayItem => ({ label: al.label, kind: 'EARNING', amount: franc(al.amount), taxable: al.taxable ?? true, cnps: al.taxable ?? true }),
        );
        const previous = existing.get(s.id);
        const prevInput = previous?.input as unknown as StoredInput | undefined;
        const input: StoredInput = { allowances, items: prevInput?.items ?? [], unpaidDays: prevInput?.unpaidDays ?? 0 };
        const baseSalary = franc(comp.baseSalary);
        const result = computePayslip(rules, baseSalary, { items: [...input.allowances, ...input.items], unpaidDays: input.unpaidDays });
        const employee: Employee = { staffNumber: s.staffNumber, firstName: s.firstName, lastName: s.lastName, position: contract?.position ?? s.position };
        const data = {
          employee: employee as unknown as Prisma.InputJsonValue,
          baseSalary,
          input: input as unknown as Prisma.InputJsonValue,
          result: result as unknown as Prisma.InputJsonValue,
          gross: result.gross,
          net: result.net,
          employerCost: result.employerCost,
        };
        if (previous) await tx.payslip.update({ where: { id: previous.id }, data });
        else {
          const number = `PAY-${period.replace('-', '')}-${String(sequence++).padStart(4, '0')}`;
          await tx.payslip.create({ data: { tenantId: a.tenantId, runId, staffId: s.id, number, ...data } });
        }
        existing.delete(s.id);
        continue;
      }
      // Someone no longer payable drops out of a draft they were in.
      const stale = existing.get(s.id);
      if (stale) {
        await tx.payslip.delete({ where: { id: stale.id } });
        existing.delete(s.id);
      }
    }
    // Staff who left (no longer ACTIVE) since the draft was built.
    for (const p of existing.values()) await tx.payslip.delete({ where: { id: p.id } });
    return skipped;
  }

  private async runOrThrow(tx: Tx, a: Actor, runId: string) {
    const run = await tx.payrollRun.findFirst({ where: { id: runId, tenantId: a.tenantId } });
    if (!run) throw Errors.notFound('Payroll run');
    return run;
  }

  private async detail(tx: Tx, a: Actor, runId: string) {
    const run = await this.runOrThrow(tx, a, runId);
    const payslips = await tx.payslip.findMany({ where: { runId }, orderBy: { number: 'asc' } });
    const results = payslips.map((p) => p.result as unknown as PayslipResult);
    return {
      id: run.id,
      period: periodLabel(run.period),
      status: run.status,
      currency: run.currency,
      rulesVersion: run.rulesVersion,
      rulesLabel: (run.rules as unknown as PayrollRules).label,
      submittedBy: run.submittedBy,
      submittedAt: run.submittedAt?.toISOString() ?? null,
      approvedBy: run.approvedBy,
      approvedAt: run.approvedAt?.toISOString() ?? null,
      paidAt: run.paidAt?.toISOString() ?? null,
      payslips: payslips.map((p) => ({
        id: p.id,
        number: p.number,
        staffId: p.staffId,
        employee: p.employee as unknown as Employee,
        baseSalary: franc(p.baseSalary),
        gross: franc(p.gross),
        net: franc(p.net),
        employerCost: franc(p.employerCost),
        input: p.input as unknown as StoredInput,
      })),
      totals: declarationTotals(results),
    };
  }

  getRun(a: Actor, runId: string) {
    return this.run(a, (tx) => this.detail(tx, a, runId));
  }

  refreshRun(a: Actor, runId: string) {
    return this.run(a, async (tx) => {
      const run = await this.runOrThrow(tx, a, runId);
      this.assertDraft(run.status);
      // A refresh also picks up a rule change made since the draft was created.
      const { version, rules } = await this.currentRules(tx, a.tenantId);
      await tx.payrollRun.update({ where: { id: run.id }, data: { rulesVersion: version, rules: rules as unknown as Prisma.InputJsonValue } });
      const skipped = await this.build(tx, a, run.id, periodLabel(run.period), rules);
      return { ...(await this.detail(tx, a, run.id)), skipped };
    });
  }

  deleteRun(a: Actor, runId: string) {
    return this.run(a, async (tx) => {
      const run = await this.runOrThrow(tx, a, runId);
      this.assertDraft(run.status);
      await tx.payrollRun.delete({ where: { id: run.id } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'payroll.run_deleted', entityType: 'payroll_run', entityId: run.id, metadata: { period: periodLabel(run.period) }, ip: a.ip }, tx);
    });
  }

  private assertDraft(status: string) {
    if (status !== 'DRAFT') throw Errors.conflict('PAYROLL_RUN_LOCKED', 'Only a draft payroll can be changed');
  }

  /** Enters the month's variables for one payslip and recomputes it. */
  updatePayslip(a: Actor, payslipId: string, input: PayslipInput) {
    return this.run(a, async (tx) => {
      const p = await tx.payslip.findFirst({ where: { id: payslipId, tenantId: a.tenantId }, include: { run: true } });
      if (!p) throw Errors.notFound('Payslip');
      this.assertDraft(p.run.status);
      const stored = p.input as unknown as StoredInput;
      const next: StoredInput = { allowances: stored.allowances, items: input.items, unpaidDays: input.unpaidDays };
      const result = computePayslip(p.run.rules as unknown as PayrollRules, franc(p.baseSalary), { items: [...next.allowances, ...next.items], unpaidDays: next.unpaidDays });
      if (new Decimal(result.net).isNegative()) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'NEGATIVE_NET_PAY', 'Deductions exceed the pay for this month');
      }
      await tx.payslip.update({
        where: { id: p.id },
        data: { input: next as unknown as Prisma.InputJsonValue, result: result as unknown as Prisma.InputJsonValue, gross: result.gross, net: result.net, employerCost: result.employerCost },
      });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'payroll.payslip_changed', entityType: 'payslip', entityId: p.id, metadata: { variables: next.items.length, unpaidDays: next.unpaidDays }, ip: a.ip }, tx);
      return this.payslipView(p.id, p.number, p.employee as unknown as Employee, periodLabel(p.run.period), p.run.status, next, result);
    });
  }

  private payslipView(id: string, number: string, employee: Employee, period: string, status: string, input: StoredInput, result: PayslipResult) {
    return { id, number, employee, period, runStatus: status, input, result };
  }

  getPayslip(a: Actor, payslipId: string) {
    return this.run(a, async (tx) => {
      const p = await tx.payslip.findFirst({ where: { id: payslipId, tenantId: a.tenantId }, include: { run: true } });
      if (!p) throw Errors.notFound('Payslip');
      return this.payslipView(p.id, p.number, p.employee as unknown as Employee, periodLabel(p.run.period), p.run.status, p.input as unknown as StoredInput, p.result as unknown as PayslipResult);
    });
  }

  // ------------------------------------------------------------ workflow

  submit(a: Actor, runId: string) {
    return this.transition(a, runId, 'DRAFT', 'SUBMITTED', 'payroll.run_submitted', async (tx, run) => {
      if ((await tx.payslip.count({ where: { runId: run.id } })) === 0) throw Errors.conflict('PAYROLL_RUN_EMPTY', 'There is no payslip to submit');
      return { submittedBy: a.userId, submittedAt: new Date() };
    });
  }

  approve(a: Actor, runId: string) {
    return this.transition(a, runId, 'SUBMITTED', 'APPROVED', 'payroll.run_approved', async (_tx, run) => {
      if (run.submittedBy === a.userId) throw Errors.forbidden('Payroll must be approved by someone other than who submitted it');
      return { approvedBy: a.userId, approvedAt: new Date() };
    });
  }

  sendBack(a: Actor, runId: string, reason: string) {
    return this.transition(a, runId, 'SUBMITTED', 'DRAFT', 'payroll.run_returned', async () => ({ submittedBy: null, submittedAt: null }), { reason });
  }

  markPaid(a: Actor, runId: string) {
    return this.transition(a, runId, 'APPROVED', 'PAID', 'payroll.run_paid', async () => ({ paidBy: a.userId, paidAt: new Date() }));
  }

  private transition(
    a: Actor,
    runId: string,
    from: 'DRAFT' | 'SUBMITTED' | 'APPROVED',
    to: 'SUBMITTED' | 'APPROVED' | 'DRAFT' | 'PAID',
    action: string,
    extra: (tx: Tx, run: Prisma.PayrollRunGetPayload<object>) => Promise<Prisma.PayrollRunUpdateInput>,
    metadata: Record<string, string> = {},
  ) {
    return this.run(a, async (tx) => {
      const run = await this.runOrThrow(tx, a, runId);
      await tx.$queryRaw`SELECT id FROM payroll_runs WHERE id = ${run.id}::uuid FOR UPDATE`;
      if (run.status !== from) throw Errors.conflict('PAYROLL_WRONG_STATUS', `The payroll is ${run.status.toLowerCase()}, not ${from.toLowerCase()}`);
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: to, ...(await extra(tx, run)) } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action, entityType: 'payroll_run', entityId: run.id, metadata: { period: periodLabel(run.period), ...metadata }, ip: a.ip }, tx);
      return this.detail(tx, a, run.id);
    });
  }

  // ------------------------------------------------------------ documents

  /** Payslips for PDFs. `own`: only the signed-in employee's approved or paid payslips. */
  async payslipsForPdf(a: Actor, where: { runId?: string; payslipId?: string; own?: boolean }) {
    return this.run(a, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { legalName: true, tradingName: true } });
      let staffFilter: Prisma.PayslipWhereInput = {};
      if (where.own) {
        const me = await tx.staff.findFirst({ where: { tenantId: a.tenantId, membership: { userId: a.userId } }, select: { id: true } });
        if (!me) throw Errors.notFound('Payslip');
        staffFilter = { staffId: me.id, run: { status: { in: ['APPROVED', 'PAID'] } } };
      }
      const rows = await tx.payslip.findMany({
        where: { tenantId: a.tenantId, ...(where.runId && { runId: where.runId }), ...(where.payslipId && { id: where.payslipId }), ...staffFilter },
        include: { run: { select: { period: true, status: true, rulesVersion: true, rules: true } } },
        orderBy: { number: 'asc' },
      });
      if (rows.length === 0) throw Errors.notFound('Payslip');
      return rows.map((p) => ({
        school: tenant.tradingName ?? tenant.legalName,
        legalName: tenant.legalName,
        number: p.number,
        period: periodLabel(p.run.period),
        status: p.run.status,
        rulesLabel: `${(p.run.rules as unknown as PayrollRules).label} — v${p.run.rulesVersion ?? 0}`,
        employee: p.employee as unknown as Employee,
        result: p.result as unknown as PayslipResult,
      }));
    });
  }

  /** The signed-in employee's own payslips (approved or paid runs only). */
  myPayslips(a: Actor) {
    return this.run(a, async (tx) => {
      const me = await tx.staff.findFirst({ where: { tenantId: a.tenantId, membership: { userId: a.userId } }, select: { id: true } });
      if (!me) return [];
      const rows = await tx.payslip.findMany({
        where: { tenantId: a.tenantId, staffId: me.id, run: { status: { in: ['APPROVED', 'PAID'] } } },
        include: { run: { select: { period: true, status: true } } },
        orderBy: { number: 'desc' },
      });
      return rows.map((p) => ({ id: p.id, number: p.number, period: periodLabel(p.run.period), status: p.run.status, net: franc(p.net) }));
    });
  }

  /** CNPS and tax declaration figures for one run, as CSV (Excel-friendly: BOM, semicolons). */
  async declarationsCsv(a: Actor, runId: string) {
    const d = await this.getRun(a, runId);
    const rows = [
      ['Code', 'Libellé', 'Assiette', 'Part salariale', 'Part patronale', 'Total'],
      ...d.totals.lines.map((l) => [l.code, l.label, l.base, l.employee, l.employer, l.total]),
      [],
      ['Effectif', String(d.totals.headcount)],
      ['Salaires bruts', d.totals.gross],
      ['Nets à payer', d.totals.net],
      ['Coût employeur', d.totals.employerCost],
    ];
    await this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, (tx) =>
      this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'payroll.declarations_exported', entityType: 'payroll_run', entityId: runId, metadata: { period: d.period }, ip: a.ip }, tx),
    );
    return { period: d.period, csv: '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n') + '\r\n' };
  }
}
