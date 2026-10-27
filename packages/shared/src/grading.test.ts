import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeResults, DEFAULT_RULES_CM, type EngineInput } from './grading';

/**
 * Hand-verified cases (spec Module 7 AC: "calculations match independently verified test cases").
 * Each expected value is worked out in the comment next to it.
 */
const P = (score: number) => ({ score, status: 'PRESENT' as const });

function twoSubjectClass(): EngineInput {
  return {
    rules: DEFAULT_RULES_CM,
    studentIds: ['ana', 'ben', 'cyr'],
    subjects: [
      {
        // Maths, coefficient 4: a test /20 (weight 1) and an exam /40 (weight 2).
        id: 'math',
        coefficient: 4,
        assessments: [
          { id: 'm1', maxScore: 20, weight: 1, marks: { ana: P(12), ben: P(15), cyr: P(8) } },
          { id: 'm2', maxScore: 40, weight: 2, marks: { ana: P(30), ben: P(20), cyr: { score: null, status: 'ABSENT' } } },
        ],
      },
      {
        // French, coefficient 3: one test /20.
        id: 'fr',
        coefficient: 3,
        assessments: [{ id: 'f1', maxScore: 20, weight: 1, marks: { ana: P(14), ben: P(15.5), cyr: P(11) } }],
      },
    ],
  };
}

test('subject averages apply assessment weights, scaled to /20', () => {
  const r = computeResults(twoSubjectClass());
  const ana = r.students.find((s) => s.studentId === 'ana')!;
  // Maths: (12×1 + 30/40×20×2) / 3 = (12 + 30) / 3 = 14.00
  assert.equal(ana.subjects[0]!.average, '14.00');
  // Ben maths: (15 + 10×2) / 3 = 35/3 = 11.666… → 11.67
  assert.equal(r.students[1]!.subjects[0]!.average, '11.67');
});

test('absent marks are excluded by default, never silently zero', () => {
  const r = computeResults(twoSubjectClass());
  // Cyr maths: exam absent → excluded → 8×1 / 1 = 8.00
  assert.equal(r.students[2]!.subjects[0]!.average, '8.00');
});

test('the ZERO policy counts an absence as 0', () => {
  const input = twoSubjectClass();
  input.rules = { ...input.rules, missingPolicy: 'ZERO' };
  const r = computeResults(input);
  // Cyr maths: (8×1 + 0×2) / 3 = 2.666… → 2.67
  assert.equal(r.students[2]!.subjects[0]!.average, '2.67');
});

test('the general average applies each coefficient exactly once, on displayed subject averages', () => {
  const r = computeResults(twoSubjectClass());
  // Ana: (14.00×4 + 14.00×3) / 7 = 98 / 7 = 14.00
  assert.equal(r.students[0]!.average, '14.00');
  assert.equal(r.students[0]!.totalPoints, '98.00');
  // Ben: (11.67×4 + 15.50×3) / 7 = (46.68 + 46.50) / 7 = 93.18 / 7 = 13.3114… → 13.31
  assert.equal(r.students[1]!.average, '13.31');
  // Cyr: (8.00×4 + 11.00×3) / 7 = 65 / 7 = 9.2857… → 9.29
  assert.equal(r.students[2]!.average, '9.29');
});

test('ranks, mentions and pass decisions', () => {
  const r = computeResults(twoSubjectClass());
  assert.deepEqual(r.students.map((s) => s.rank), [1, 2, 3]);
  assert.equal(r.students[0]!.mention!.labelFr, 'Bien'); // 14.00 ≥ 14
  assert.equal(r.students[1]!.mention!.labelFr, 'Assez bien'); // 13.31 ≥ 12
  assert.deepEqual(r.students.map((s) => s.passed), [true, true, false]);
  // Class: mean of 14.00, 13.31, 9.29 = 36.60 / 3 = 12.20; pass rate 2/3 = 66.7 %
  assert.deepEqual(r.class, { average: '12.20', min: '9.29', max: '14.00', passRate: 66.7, ranked: 3 });
});

test('ties share a rank: competition 1,1,3 vs dense 1,1,2', () => {
  const input: EngineInput = {
    rules: DEFAULT_RULES_CM,
    studentIds: ['a', 'b', 'c'],
    subjects: [{ id: 's', coefficient: 1, assessments: [{ id: 'x', maxScore: 20, weight: 1, marks: { a: P(15), b: P(15), c: P(12) } }] }],
  };
  assert.deepEqual(computeResults(input).students.map((s) => s.rank), [1, 1, 3]);
  input.rules = { ...DEFAULT_RULES_CM, ranking: 'DENSE' };
  assert.deepEqual(computeResults(input).students.map((s) => s.rank), [1, 1, 2]);
});

test('exempt subjects drop out of the coefficient total; a student with no marks is unranked', () => {
  const input: EngineInput = {
    rules: DEFAULT_RULES_CM,
    studentIds: ['a', 'b'],
    subjects: [
      { id: 's1', coefficient: 2, assessments: [{ id: 'x', maxScore: 20, weight: 1, marks: { a: P(10) } }] },
      { id: 's2', coefficient: 5, assessments: [{ id: 'y', maxScore: 20, weight: 1, marks: { a: { score: null, status: 'EXEMPT' } } }] },
    ],
  };
  const r = computeResults(input);
  assert.equal(r.students[0]!.totalCoefficients, '2');
  assert.equal(r.students[0]!.average, '10.00');
  assert.equal(r.students[1]!.average, null);
  assert.equal(r.students[1]!.rank, null);
  assert.equal(r.students[1]!.passed, null);
});

test('rounding is half-up at the configured decimals', () => {
  const input: EngineInput = {
    rules: { ...DEFAULT_RULES_CM, decimals: 1 },
    studentIds: ['a'],
    subjects: [{ id: 's', coefficient: 1, assessments: [{ id: 'x', maxScore: 40, weight: 1, marks: { a: P(25.5) } }] }],
  };
  // 25.5 / 40 × 20 = 12.75 → 12.8 (half-up), not 12.7
  assert.equal(computeResults(input).students[0]!.average, '12.8');
});

test('the same input always produces the same output (reproducibility)', () => {
  assert.deepEqual(computeResults(twoSubjectClass()), computeResults(twoSubjectClass()));
});
