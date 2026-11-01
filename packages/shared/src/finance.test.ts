import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feeScheduleSchema, money, paymentSchema } from './finance';

test('money accepts decimal strings only, never floats or zero', () => {
  assert.equal(money.safeParse('65596').success, true);
  assert.equal(money.safeParse('100.50').success, true);
  assert.equal(money.safeParse('0').success, false);
  assert.equal(money.safeParse('0.00').success, false);
  assert.equal(money.safeParse('1.005').success, false);
  assert.equal(money.safeParse('-5').success, false);
  assert.equal(money.safeParse(12 as unknown as string).success, false);
});

test('fee schedule installments must be in due-date order and single-scoped', () => {
  const base = {
    academicYearId: '7a0b5d1e-6f1c-4c3a-9a43-1b2c3d4e5f60',
    categoryId: '7a0b5d1e-6f1c-4c3a-9a43-1b2c3d4e5f61',
    name: 'Scolarité',
    currency: 'xaf',
  };
  const ok = feeScheduleSchema.safeParse({
    ...base,
    installments: [
      { label: 'T1', dueDate: '2026-09-30', amount: '50000' },
      { label: 'T2', dueDate: '2027-01-15', amount: '50000' },
    ],
  });
  assert.equal(ok.success, true);
  assert.equal(ok.success && ok.data.currency, 'XAF');
  const unordered = feeScheduleSchema.safeParse({
    ...base,
    installments: [
      { label: 'T2', dueDate: '2027-01-15', amount: '50000' },
      { label: 'T1', dueDate: '2026-09-30', amount: '50000' },
    ],
  });
  assert.equal(unordered.success, false);
});

test('payments require an idempotency key', () => {
  const r = paymentSchema.safeParse({
    studentId: '7a0b5d1e-6f1c-4c3a-9a43-1b2c3d4e5f60',
    method: 'CASH',
    currency: 'XAF',
    amount: '25000',
    receivedOn: '2026-10-27',
  });
  assert.equal(r.success, false);
});
