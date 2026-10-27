import { test } from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { computePayslip, declarationTotals, DEFAULT_PAYROLL_RULES_CM as R, irppAnnual, payrollRulesSchema } from './payroll';

const line = (r: ReturnType<typeof computePayslip>, code: string) => r.contributions.find((l) => l.code === code)!;

test('default rules are valid', () => {
  assert.equal(payrollRulesSchema.safeParse(R).success, true);
});

test('annual IRPP scale, worked by hand', () => {
  // 2 263 600: 2 000 000 × 10 % + 263 600 × 15 % = 200 000 + 39 540
  assert.equal(irppAnnual(R, new Decimal(2_263_600)).toString(), '239540');
  // 6 000 000: 200 000 + 150 000 + 500 000 + 1 000 000 × 35 % = 1 200 000
  assert.equal(irppAnnual(R, new Decimal(6_000_000)).toString(), '1200000');
  assert.equal(irppAnnual(R, new Decimal(0)).toString(), '0');
});

test('payslip worked by hand: 300 000 base, taxable housing 50 000, transport 20 000 exempt, advance 25 000', () => {
  const r = computePayslip(R, '300000', {
    unpaidDays: 0,
    items: [
      { label: 'Logement', kind: 'EARNING', amount: '50000', taxable: true, cnps: true },
      { label: 'Transport', kind: 'EARNING', amount: '20000', taxable: false, cnps: false },
      { label: 'Avance', kind: 'DEDUCTION', amount: '25000', taxable: true, cnps: true },
    ],
  });
  assert.equal(r.gross, '370000');
  assert.equal(r.taxableGross, '350000');
  assert.equal(r.cnpsBase, '350000');
  // CNPS pension 4.2 % of 350 000 = 14 700 each side
  assert.deepEqual([line(r, 'CNPS_PVID').employee, line(r, 'CNPS_PVID').employer], ['14700', '14700']);
  assert.equal(line(r, 'CNPS_PF').employer, '12950'); // 3.7 %
  assert.equal(line(r, 'CNPS_AT').employer, '6125'); // 1.75 %
  // IRPP: (350 000 × 0.7 − 14 700) × 12 − 500 000 = 2 263 600 → 239 540 / 12 = 19 961.67 → 19 962
  assert.equal(line(r, 'IRPP').employee, '19962');
  assert.equal(line(r, 'CAC').employee, '1996'); // 10 % of 19 962 = 1 996.2
  assert.deepEqual([line(r, 'CFC').employee, line(r, 'CFC').employer], ['3500', '5250']);
  assert.equal(line(r, 'FNE').employer, '3500');
  assert.equal(line(r, 'RAV').employee, '4550'); // 300 001–400 000
  assert.equal(line(r, 'TDL').employee, '2000'); // base 250 001–300 000
  // 14 700 + 19 962 + 1 996 + 3 500 + 4 550 + 2 000 = 46 708
  assert.equal(r.totalEmployee, '46708');
  // 14 700 + 12 950 + 6 125 + 5 250 + 3 500 = 42 525
  assert.equal(r.totalEmployer, '42525');
  // 370 000 − 46 708 − 25 000
  assert.equal(r.net, '298292');
  assert.equal(r.employerCost, '412525');
});

test('caps pension and family contributions at the CNPS ceiling, not work accident', () => {
  const r = computePayslip(R, '1000000', { unpaidDays: 0, items: [] });
  assert.equal(line(r, 'CNPS_PVID').base, '750000');
  assert.equal(line(r, 'CNPS_PVID').employee, '31500');
  assert.equal(line(r, 'CNPS_PF').employer, '27750');
  assert.equal(line(r, 'CNPS_AT').employer, '17500');
});

test('exempts salaries under 62 000 from IRPP and deducts unpaid days on a 30-day month', () => {
  const r = computePayslip(R, '60000', { unpaidDays: 0, items: [] });
  assert.equal(line(r, 'IRPP').employee, '0');
  assert.equal(line(r, 'CAC').employee, '0');
  assert.equal(line(r, 'TDL').employee, '0');
  const absent = computePayslip(R, '150000', { unpaidDays: 3, items: [] });
  assert.equal(absent.absenceDeduction, '15000');
  assert.equal(absent.gross, '135000');
});

test('sums a run per contribution for the declarations', () => {
  const a = computePayslip(R, '300000', { unpaidDays: 0, items: [] });
  const b = computePayslip(R, '200000', { unpaidDays: 0, items: [] });
  const t = declarationTotals([a, b]);
  assert.equal(t.headcount, 2);
  assert.equal(t.gross, '500000');
  const pvid = t.lines.find((l) => l.code === 'CNPS_PVID')!;
  assert.deepEqual([pvid.base, pvid.employee, pvid.employer, pvid.total], ['500000', '21000', '21000', '42000']);
});
