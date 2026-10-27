import Decimal from 'decimal.js';
import { z } from 'zod';

/**
 * Payroll engine (Phase 6, Cameroon). Pure and deterministic like the grading engine: a payslip is
 * reproducible from the rule version saved with its run. Amounts are XAF (no minor unit); every
 * contribution line is rounded half-up to the franc, then summed.
 *
 * Bases:
 *  - gross            = base salary − unpaid absence + every earning
 *  - taxable gross    = base salary − unpaid absence + taxable earnings          (IRPP, CFC, RAV)
 *  - CNPS base        = base salary − unpaid absence + earnings subject to CNPS, capped per branch
 * IRPP (monthly, from the annual scale):
 *    annual net taxable = (taxable gross × (1 − professional deduction) − employee pension) × 12 − annual allowance
 *    IRPP = scale(annual net taxable) / 12, nil when taxable gross < exemption threshold; CAC = rate × IRPP
 * RAV and TDL are flat amounts from bracket tables (TDL on the base salary).
 * Net pay = gross − employee contributions − other deductions (advances, loans…).
 *
 * The default rules follow the general regime as published in the CGI and CNPS circulars; they MUST be
 * checked by the school's accountant (work-accident group, family-benefit rate, local TDL table).
 */

const rate = z.string().regex(/^0(\.\d{1,6})?$|^1(\.0{1,6})?$/, 'invalid_rate');
const amount = z.string().regex(/^\d{1,13}$/, 'invalid_amount');
const bracketTable = z
  .array(z.object({ upTo: amount.nullable(), amount }))
  .min(1)
  .max(30)
  .refine((rows) => rows.at(-1)!.upTo === null, 'last_bracket_unbounded');

export const payrollRulesSchema = z.object({
  label: z.string().min(1).max(80),
  daysPerMonth: z.number().int().min(20).max(31),
  professionalDeductionRate: rate,
  annualAllowance: amount,
  irppExemptBelow: amount,
  irppScale: z
    .array(z.object({ upTo: amount.nullable(), rate }))
    .min(1)
    .max(10)
    .refine((rows) => rows.at(-1)!.upTo === null, 'last_bracket_unbounded'),
  cacRate: rate,
  cnps: z.object({
    pensionEmployee: rate,
    pensionEmployer: rate,
    family: rate,
    workAccident: rate,
    /** Monthly salary ceiling for pension and family benefits; work accident is uncapped. */
    ceiling: amount,
  }),
  cfcEmployee: rate,
  cfcEmployer: rate,
  fneEmployer: rate,
  rav: bracketTable,
  tdl: bracketTable,
});
export type PayrollRules = z.infer<typeof payrollRulesSchema>;

/** General regime defaults; family benefits at the private-education rate, work accident group A. */
export const DEFAULT_PAYROLL_RULES_CM: PayrollRules = {
  label: 'Cameroun — régime général (enseignement privé)',
  daysPerMonth: 30,
  professionalDeductionRate: '0.30',
  annualAllowance: '500000',
  irppExemptBelow: '62000',
  irppScale: [
    { upTo: '2000000', rate: '0.10' },
    { upTo: '3000000', rate: '0.15' },
    { upTo: '5000000', rate: '0.25' },
    { upTo: null, rate: '0.35' },
  ],
  cacRate: '0.10',
  cnps: { pensionEmployee: '0.042', pensionEmployer: '0.042', family: '0.037', workAccident: '0.0175', ceiling: '750000' },
  cfcEmployee: '0.01',
  cfcEmployer: '0.015',
  fneEmployer: '0.01',
  rav: [
    { upTo: '50000', amount: '0' },
    { upTo: '100000', amount: '750' },
    { upTo: '200000', amount: '1950' },
    { upTo: '300000', amount: '3250' },
    { upTo: '400000', amount: '4550' },
    { upTo: '500000', amount: '5850' },
    { upTo: '600000', amount: '7150' },
    { upTo: '700000', amount: '8450' },
    { upTo: '800000', amount: '9750' },
    { upTo: '900000', amount: '11050' },
    { upTo: '1000000', amount: '12350' },
    { upTo: null, amount: '13000' },
  ],
  tdl: [
    { upTo: '62000', amount: '0' },
    { upTo: '75000', amount: '250' },
    { upTo: '100000', amount: '500' },
    { upTo: '125000', amount: '750' },
    { upTo: '150000', amount: '1000' },
    { upTo: '200000', amount: '1250' },
    { upTo: '250000', amount: '1500' },
    { upTo: '300000', amount: '2000' },
    { upTo: '500000', amount: '2250' },
    { upTo: null, amount: '2500' },
  ],
};

export const PAY_ITEM_KINDS = ['EARNING', 'DEDUCTION'] as const;

/** A monthly variable: allowance, overtime, bonus (earnings) or advance, loan repayment (deductions). */
export const payItemSchema = z.object({
  label: z.string().trim().min(1).max(60),
  kind: z.enum(PAY_ITEM_KINDS),
  amount,
  /** Earnings only: subject to IRPP/CFC/RAV, and to CNPS. Ignored for deductions. */
  taxable: z.boolean().default(true),
  cnps: z.boolean().default(true),
});
export type PayItem = z.infer<typeof payItemSchema>;

export const payslipInputSchema = z.object({
  items: z.array(payItemSchema).max(30),
  unpaidDays: z.number().int().min(0).max(31).default(0),
});
export type PayslipInput = z.infer<typeof payslipInputSchema>;

export const payrollRunCreateSchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'invalid_period') });
export type PayrollRunCreateInput = z.infer<typeof payrollRunCreateSchema>;
export const payrollReturnSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export interface PayslipLine {
  code: string;
  label: string;
  base: string | null;
  rate: string | null;
  employee: string;
  employer: string;
}

export interface PayslipResult {
  baseSalary: string;
  absenceDeduction: string;
  gross: string;
  taxableGross: string;
  cnpsBase: string;
  earnings: { label: string; amount: string; taxable: boolean; cnps: boolean }[];
  contributions: PayslipLine[];
  otherDeductions: { label: string; amount: string }[];
  totalEmployee: string;
  totalEmployer: string;
  net: string;
  employerCost: string;
}

const D = (v: string | number) => new Decimal(v);
const franc = (v: Decimal) => v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

function bracket(table: { upTo: string | null; amount: string }[], value: Decimal): Decimal {
  for (const row of table) if (row.upTo === null || value.lte(row.upTo)) return D(row.amount);
  return D(table.at(-1)!.amount);
}

/** Annual IRPP on the progressive scale. */
export function irppAnnual(rules: PayrollRules, annualNetTaxable: Decimal): Decimal {
  let tax = D(0);
  let lower = D(0);
  for (const b of rules.irppScale) {
    if (annualNetTaxable.lte(lower)) break;
    const upper = b.upTo === null ? annualNetTaxable : Decimal.min(annualNetTaxable, b.upTo);
    tax = tax.plus(upper.minus(lower).times(b.rate));
    if (b.upTo === null) break;
    lower = D(b.upTo);
  }
  return tax;
}

export function computePayslip(rules: PayrollRules, baseSalary: string, input: PayslipInput): PayslipResult {
  const base = D(baseSalary);
  const absence = franc(base.times(input.unpaidDays).div(rules.daysPerMonth));
  const paidBase = Decimal.max(0, base.minus(absence));
  const earnings = input.items.filter((i) => i.kind === 'EARNING');
  const deductions = input.items.filter((i) => i.kind === 'DEDUCTION');
  const sumOf = (xs: PayItem[]) => xs.reduce((s, i) => s.plus(i.amount), D(0));

  const gross = paidBase.plus(sumOf(earnings));
  const taxableGross = paidBase.plus(sumOf(earnings.filter((e) => e.taxable)));
  const cnpsBase = paidBase.plus(sumOf(earnings.filter((e) => e.cnps)));
  const capped = Decimal.min(cnpsBase, rules.cnps.ceiling);

  const lines: PayslipLine[] = [];
  const add = (code: string, label: string, b: Decimal | null, r: string | null, employee: Decimal, employer: Decimal) =>
    lines.push({ code, label, base: b?.toFixed(0) ?? null, rate: r, employee: employee.toFixed(0), employer: employer.toFixed(0) });

  const pensionEmployee = franc(capped.times(rules.cnps.pensionEmployee));
  add('CNPS_PVID', 'CNPS — pension vieillesse, invalidité, décès', capped, rules.cnps.pensionEmployee, pensionEmployee, franc(capped.times(rules.cnps.pensionEmployer)));
  add('CNPS_PF', 'CNPS — prestations familiales', capped, rules.cnps.family, D(0), franc(capped.times(rules.cnps.family)));
  add('CNPS_AT', 'CNPS — accidents du travail', cnpsBase, rules.cnps.workAccident, D(0), franc(cnpsBase.times(rules.cnps.workAccident)));

  let irpp = D(0);
  if (taxableGross.gte(rules.irppExemptBelow)) {
    const monthlyNet = taxableGross.times(D(1).minus(rules.professionalDeductionRate)).minus(pensionEmployee);
    const annual = Decimal.max(0, monthlyNet.times(12).minus(rules.annualAllowance));
    irpp = franc(irppAnnual(rules, annual).div(12));
  }
  add('IRPP', 'IRPP', taxableGross, null, irpp, D(0));
  add('CAC', 'Centimes additionnels communaux', irpp, rules.cacRate, franc(irpp.times(rules.cacRate)), D(0));
  add('CFC', 'Crédit foncier', taxableGross, null, franc(taxableGross.times(rules.cfcEmployee)), franc(taxableGross.times(rules.cfcEmployer)));
  add('FNE', 'Fonds national de l\'emploi', taxableGross, rules.fneEmployer, D(0), franc(taxableGross.times(rules.fneEmployer)));
  add('RAV', 'Redevance audiovisuelle', taxableGross, null, bracket(rules.rav, taxableGross), D(0));
  add('TDL', 'Taxe de développement local', paidBase, null, bracket(rules.tdl, paidBase), D(0));

  const totalEmployee = lines.reduce((s, l) => s.plus(l.employee), D(0));
  const totalEmployer = lines.reduce((s, l) => s.plus(l.employer), D(0));
  const other = sumOf(deductions);
  const net = gross.minus(totalEmployee).minus(other);

  return {
    baseSalary: base.toFixed(0),
    absenceDeduction: absence.toFixed(0),
    gross: gross.toFixed(0),
    taxableGross: taxableGross.toFixed(0),
    cnpsBase: cnpsBase.toFixed(0),
    earnings: earnings.map((e) => ({ label: e.label, amount: D(e.amount).toFixed(0), taxable: e.taxable, cnps: e.cnps })),
    contributions: lines,
    otherDeductions: deductions.map((d) => ({ label: d.label, amount: D(d.amount).toFixed(0) })),
    totalEmployee: totalEmployee.toFixed(0),
    totalEmployer: totalEmployer.toFixed(0),
    net: net.toFixed(0),
    employerCost: gross.plus(totalEmployer).toFixed(0),
  };
}

/** Sums the payslips of a run per contribution, for the CNPS and tax declarations. */
export function declarationTotals(results: PayslipResult[]) {
  const by = new Map<string, { code: string; label: string; base: Decimal; employee: Decimal; employer: Decimal }>();
  for (const r of results) {
    for (const l of r.contributions) {
      const t = by.get(l.code) ?? { code: l.code, label: l.label, base: D(0), employee: D(0), employer: D(0) };
      t.base = t.base.plus(l.base ?? 0);
      t.employee = t.employee.plus(l.employee);
      t.employer = t.employer.plus(l.employer);
      by.set(l.code, t);
    }
  }
  const sum = (f: (r: PayslipResult) => string) => results.reduce((s, r) => s.plus(f(r)), D(0)).toFixed(0);
  return {
    headcount: results.length,
    gross: sum((r) => r.gross),
    net: sum((r) => r.net),
    employerCost: sum((r) => r.employerCost),
    lines: [...by.values()].map((t) => ({ code: t.code, label: t.label, base: t.base.toFixed(0), employee: t.employee.toFixed(0), employer: t.employer.toFixed(0), total: t.employee.plus(t.employer).toFixed(0) })),
  };
}
