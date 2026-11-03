import { test } from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { appreciationOf, competenceRulesSchema, computeCompetenceResults, DEFAULT_COMPETENCE_RULES, monthsOfTerm, termOfMonth, type CompetenceDef } from './competences';

// "6B — Practise artistic activities (20 marks)": oral 4, written 2, practical 10, attitude 4, as in the booklet.
const artistic: CompetenceDef = { id: '6B', components: [{ kind: 'ORAL', max: '4' }, { kind: 'WRITTEN', max: '2' }, { kind: 'PRACTICAL', max: '10' }, { kind: 'ATTITUDE', max: '4' }] };
// A second competence to reach a 40-mark total.
const ict: CompetenceDef = { id: '3', components: [{ kind: 'ORAL', max: '3' }, { kind: 'WRITTEN', max: '4' }, { kind: 'PRACTICAL', max: '10' }, { kind: 'ATTITUDE', max: '3' }] };

const mark = (studentId: string, competenceId: string, month: number, kind: 'ORAL' | 'WRITTEN' | 'PRACTICAL' | 'ATTITUDE', score: string) => ({ studentId, competenceId, month, kind, score });

test('months map to terms three by three', () => {
  assert.deepEqual([1, 3, 4, 9].map(termOfMonth), [1, 1, 2, 3]);
  assert.deepEqual(monthsOfTerm(2), [4, 5, 6]);
});

test('a term mark is the average of its months; totals, average /20 and appreciation follow', () => {
  const r = computeCompetenceResults({
    rules: DEFAULT_COMPETENCE_RULES,
    competences: [artistic, ict],
    studentIds: ['ama', 'ben'],
    marks: [
      // Ama, term 1: two months for 6B, one for ICT.
      mark('ama', '6B', 1, 'ORAL', '4'), mark('ama', '6B', 1, 'WRITTEN', '2'), mark('ama', '6B', 1, 'PRACTICAL', '6'), mark('ama', '6B', 1, 'ATTITUDE', '2'),
      mark('ama', '6B', 3, 'ORAL', '4'), mark('ama', '6B', 3, 'WRITTEN', '2'), mark('ama', '6B', 3, 'PRACTICAL', '7'), mark('ama', '6B', 3, 'ATTITUDE', '2'),
      mark('ama', '3', 2, 'ORAL', '3'), mark('ama', '3', 2, 'WRITTEN', '4'), mark('ama', '3', 2, 'PRACTICAL', '4'), mark('ama', '3', 2, 'ATTITUDE', '2'),
      // Ben, term 1: 6B only.
      mark('ben', '6B', 2, 'ORAL', '2'), mark('ben', '6B', 2, 'PRACTICAL', '5'),
    ],
  });
  assert.equal(r.grandMax, '40');
  const ama = r.students.find((s) => s.studentId === 'ama')!;
  const t1 = ama.competences['6B']![1]!;
  assert.deepEqual(t1.components, { ORAL: '4.00', WRITTEN: '2.00', PRACTICAL: '6.50', ATTITUDE: '2.00' });
  assert.equal(t1.total, '14.50');
  assert.equal(t1.appreciation, 'SA'); // 72.5 %
  assert.deepEqual(t1.months[3], { ORAL: '4', WRITTEN: '2', PRACTICAL: '7', ATTITUDE: '2' });
  assert.deepEqual(ama.terms[1], { total: '27.50', max: '40', average: '13.75', rank: 1 });
  // Ben has 7 of 20 on 6B, the only competence marked for him: 7/20 → 7.00, second.
  assert.deepEqual(r.students.find((s) => s.studentId === 'ben')!.terms[1], { total: '7.00', max: '20', average: '7.00', rank: 2 });
  // Terms 2 and 3 have no marks yet.
  assert.deepEqual(ama.terms[2], { total: null, max: null, average: null, rank: null });
  assert.deepEqual(ama.annual, { total: '27.50', max: '40.00', average: '13.75', rank: 1 });
  assert.deepEqual(ama.annualCompetences['6B'], { total: '14.50', appreciation: 'SA' });
});

test('the booklet arithmetic: 209 of 280 gives an average of 14.93', () => {
  assert.equal(new Decimal(209).dividedBy(280).times(20).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2), '14.93');
});

test('appreciation thresholds and rules', () => {
  const max = new Decimal(20);
  assert.equal(appreciationOf(new Decimal(9.9), max, DEFAULT_COMPETENCE_RULES), 'SNA');
  assert.equal(appreciationOf(new Decimal(10), max, DEFAULT_COMPETENCE_RULES), 'SPA');
  assert.equal(appreciationOf(new Decimal(14), max, DEFAULT_COMPETENCE_RULES), 'SA');
  assert.equal(appreciationOf(new Decimal(18), max, DEFAULT_COMPETENCE_RULES), 'EXP');
  assert.equal(appreciationOf(null, max, DEFAULT_COMPETENCE_RULES), null);
  assert.equal(competenceRulesSchema.safeParse({ spa: 70, sa: 50, exp: 90, decimals: 2 }).success, false);
});
