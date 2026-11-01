import Decimal from 'decimal.js';
import { z } from 'zod';

/**
 * Grading engine (Module 7). Pure and deterministic: the same rules and marks always give the
 * same report card, which is what makes a published card reproducible from its saved rule version.
 *
 * Formulas (GRD-005/006, spec "Grading formula"):
 *  - mark on the scheme's scale:  x̂ = score / assessment max × scale max
 *  - subject average:             Σ wᵢ·x̂ᵢ / Σ wᵢ   over eligible assessments (wᵢ = assessment weight)
 *  - general average:             Σ cⱼ·Aⱼ / Σ cⱼ    over subjects with an average (cⱼ = subject coefficient,
 *                                                     Aⱼ = subject average as displayed, i.e. rounded)
 * Assessment weights and subject coefficients are distinct and each is applied exactly once.
 * General averages use the rounded subject averages so anyone can recompute a card by hand from
 * what it shows (points = coefficient × displayed average). Ranks use the rounded averages too.
 */

export const MARK_STATUSES = ['PRESENT', 'ABSENT', 'EXCUSED', 'EXEMPT', 'NOT_ASSESSED'] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];

export const gradingRulesSchema = z.object({
  /** Scale of all averages (20 in the Cameroonian francophone system, 100 for percentages). */
  maxScore: z.number().positive().max(1000),
  passMark: z.number().min(0),
  /** Decimals shown and used for ranking. */
  decimals: z.number().int().min(0).max(4),
  /** How ABSENT and NOT_ASSESSED marks count. EXCUSED and EXEMPT never count. */
  missingPolicy: z.enum(['EXCLUDE', 'ZERO']),
  /** COMPETITION: 1, 2, 2, 4 — DENSE: 1, 2, 2, 3. */
  ranking: z.enum(['COMPETITION', 'DENSE']),
  /** Descriptors by minimum average, e.g. Très bien ≥ 16. */
  mentions: z
    .array(z.object({ min: z.number().min(0), labelFr: z.string().min(1).max(40), labelEn: z.string().min(1).max(40) }))
    .max(10),
});
export type GradingRules = z.infer<typeof gradingRulesSchema>;

/** Default rules for Cameroonian francophone secondary schools — to validate with each school (spec §7 note). */
export const DEFAULT_RULES_CM: GradingRules = {
  maxScore: 20,
  passMark: 10,
  decimals: 2,
  missingPolicy: 'EXCLUDE',
  ranking: 'COMPETITION',
  mentions: [
    { min: 18, labelFr: 'Excellent', labelEn: 'Excellent' },
    { min: 16, labelFr: 'Très bien', labelEn: 'Very good' },
    { min: 14, labelFr: 'Bien', labelEn: 'Good' },
    { min: 12, labelFr: 'Assez bien', labelEn: 'Fairly good' },
    { min: 10, labelFr: 'Passable', labelEn: 'Pass' },
    { min: 0, labelFr: 'Insuffisant', labelEn: 'Insufficient' },
  ],
};

// ---------------------------------------------------------------- API contracts

/** Marks travel as decimal strings ("14.5"), at most 2 decimals. */
const markValue = z.string().trim().regex(/^\d{1,4}(\.\d{1,2})?$/, 'invalid_mark');

export const ASSESSMENT_KINDS = ['TEST', 'EXAM', 'ASSIGNMENT', 'PRACTICAL', 'ORAL'] as const;

export const assessmentSchema = z.object({
  classSubjectId: z.uuid(),
  periodId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(ASSESSMENT_KINDS),
  maxScore: markValue.refine((v) => Number(v) > 0, 'max_not_positive'),
  weight: markValue.refine((v) => Number(v) > 0, 'weight_not_positive'),
  heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type AssessmentInput = z.infer<typeof assessmentSchema>;

export const sheetRefSchema = z.object({ classSubjectId: z.uuid(), periodId: z.uuid() });
export type SheetRef = z.infer<typeof sheetRefSchema>;

export const marksSchema = sheetRefSchema.extend({
  marks: z
    .array(
      z
        .object({ assessmentId: z.uuid(), studentId: z.uuid(), score: markValue.nullable().optional(), status: z.enum(MARK_STATUSES) })
        .refine((m) => (m.status === 'PRESENT') === (m.score !== null && m.score !== undefined), { message: 'score_status_mismatch' }),
    )
    .min(1)
    .max(2000),
  /** Required when the marks were approved before (reopened sheet) — GRD-012. */
  reason: z.string().trim().min(3).max(500).optional(),
});
export type MarksInput = z.infer<typeof marksSchema>;

export const marksImportSchema = z.object({
  assessmentId: z.uuid(),
  /** Parsed CSV rows: `matricule;note` or `matricule;ABS`. */
  rows: z.array(z.object({ matricule: z.string().trim().min(1).max(30), value: z.string().trim().max(20) })).min(1).max(500),
  reason: z.string().trim().min(3).max(500).optional(),
});
export type MarksImportInput = z.infer<typeof marksImportSchema>;

export const commentsSchema = sheetRefSchema.extend({
  comments: z.array(z.object({ studentId: z.uuid(), comment: z.string().trim().max(300) })).min(1).max(200),
});
export type CommentsInput = z.infer<typeof commentsSchema>;

export const sheetDecisionSchema = sheetRefSchema.extend({ reason: z.string().trim().min(3).max(500).optional() });
export type SheetDecisionInput = z.infer<typeof sheetDecisionSchema>;

export const schemeRulesSchema = z.object({ name: z.string().trim().min(2).max(60), rules: gradingRulesSchema });
export type SchemeRulesInput = z.infer<typeof schemeRulesSchema>;

/** Scope of a report card: a period id, or "ANNUAL" for the year-end card. */
export const reportScopeSchema = z.object({ classId: z.uuid(), scope: z.union([z.uuid(), z.literal('ANNUAL')]) });
export type ReportScope = z.infer<typeof reportScopeSchema>;

export const PROMOTION_OUTCOMES = ['PROMOTED', 'REPEAT', 'GRADUATED', 'EXCLUDED'] as const;
export const promotionSchema = z.object({
  classId: z.uuid(),
  decisions: z
    .array(z.object({ enrollmentId: z.uuid(), decision: z.enum(PROMOTION_OUTCOMES), note: z.string().trim().max(300).optional() }))
    .min(1)
    .max(200),
});
export type PromotionInput = z.infer<typeof promotionSchema>;

/**
 * Reads what a teacher types in a mark cell or CSV: "14,5" / "14.5" → PRESENT; ABS → ABSENT;
 * EXC → EXCUSED; DISP → EXEMPT; NC → NOT_ASSESSED. Returns null for anything else.
 */
export function parseMarkCell(raw: string): { score: string | null; status: MarkStatus } | null {
  const v = raw.trim().toUpperCase().replace(',', '.');
  if (/^\d{1,4}(\.\d{1,2})?$/.test(v)) return { score: v, status: 'PRESENT' };
  if (['ABS', 'ABSENT', 'A'].includes(v)) return { score: null, status: 'ABSENT' };
  if (['EXC', 'EXCUSE', 'EXCUSÉ', 'EXCUSED', 'E'].includes(v)) return { score: null, status: 'EXCUSED' };
  if (['DISP', 'DISPENSE', 'DISPENSÉ', 'EXEMPT'].includes(v)) return { score: null, status: 'EXEMPT' };
  if (['NC', 'NA', 'NE', 'NOT_ASSESSED'].includes(v)) return { score: null, status: 'NOT_ASSESSED' };
  return null;
}

/** Inverse of parseMarkCell, for displaying a stored mark in an editable cell. */
export function formatMarkCell(mark: { score: string | null; status: MarkStatus } | null | undefined): string {
  if (!mark) return '';
  if (mark.status === 'PRESENT') return mark.score ?? '';
  return { ABSENT: 'ABS', EXCUSED: 'EXC', EXEMPT: 'DISP', NOT_ASSESSED: 'NC' }[mark.status];
}

type Num = string | number;

export interface EngineMark {
  score: Num | null;
  status: MarkStatus;
}

export interface EngineInput {
  rules: GradingRules;
  studentIds: string[];
  subjects: {
    id: string;
    coefficient: Num;
    assessments: { id: string; maxScore: Num; weight: Num; marks: Record<string, EngineMark | undefined> }[];
  }[];
}

export interface StudentResult {
  studentId: string;
  subjects: { subjectId: string; average: string | null; points: string | null; rank: number | null }[];
  totalCoefficients: string;
  totalPoints: string;
  average: string | null;
  rank: number | null;
  mention: { labelFr: string; labelEn: string } | null;
  passed: boolean | null;
}

export interface EngineResult {
  students: StudentResult[];
  subjects: { subjectId: string; average: string | null; min: string | null; max: string | null; passRate: number | null; assessed: number }[];
  class: { average: string | null; min: string | null; max: string | null; passRate: number | null; ranked: number };
}

const D = (v: Num) => new Decimal(v);

export function computeResults(input: EngineInput): EngineResult {
  const { rules } = input;
  const scale = D(rules.maxScore);
  const round = (v: Decimal) => v.toDecimalPlaces(rules.decimals, Decimal.ROUND_HALF_UP);
  const fmt = (v: Decimal | null) => (v === null ? null : round(v).toFixed(rules.decimals));

  // Subject averages per student (rounded), keyed subject → student.
  const subjectAvgs = new Map<string, Map<string, Decimal | null>>();
  for (const subject of input.subjects) {
    const perStudent = new Map<string, Decimal | null>();
    for (const sid of input.studentIds) {
      let weighted = new Decimal(0);
      let weights = new Decimal(0);
      for (const a of subject.assessments) {
        const m = a.marks[sid];
        const status: MarkStatus = m ? (m.status === 'PRESENT' && (m.score === null || m.score === '') ? 'NOT_ASSESSED' : m.status) : 'NOT_ASSESSED';
        let value: Decimal | null = null;
        if (status === 'PRESENT') value = D(m!.score as Num).dividedBy(D(a.maxScore)).times(scale);
        else if ((status === 'ABSENT' || status === 'NOT_ASSESSED') && rules.missingPolicy === 'ZERO') value = new Decimal(0);
        if (value === null) continue;
        weighted = weighted.plus(value.times(D(a.weight)));
        weights = weights.plus(D(a.weight));
      }
      perStudent.set(sid, weights.isZero() ? null : round(weighted.dividedBy(weights)));
    }
    subjectAvgs.set(subject.id, perStudent);
  }

  // General averages.
  const general = new Map<string, { avg: Decimal | null; coef: Decimal; points: Decimal }>();
  for (const sid of input.studentIds) {
    let points = new Decimal(0);
    let coef = new Decimal(0);
    for (const subject of input.subjects) {
      const avg = subjectAvgs.get(subject.id)!.get(sid);
      if (avg === null || avg === undefined) continue;
      points = points.plus(avg.times(D(subject.coefficient)));
      coef = coef.plus(D(subject.coefficient));
    }
    general.set(sid, { avg: coef.isZero() ? null : round(points.dividedBy(coef)), coef, points });
  }

  const rankOf = (values: Map<string, Decimal | null>) => rank(values, rules.ranking);
  const generalRanks = rankOf(new Map([...general].map(([k, v]) => [k, v.avg])));
  const subjectRanks = new Map([...subjectAvgs].map(([k, v]) => [k, rankOf(v)]));

  const mentionFor = (avg: Decimal | null) => {
    if (avg === null) return null;
    const m = [...rules.mentions].sort((a, b) => b.min - a.min).find((x) => avg.greaterThanOrEqualTo(x.min));
    return m ? { labelFr: m.labelFr, labelEn: m.labelEn } : null;
  };

  const students: StudentResult[] = input.studentIds.map((sid) => {
    const g = general.get(sid)!;
    return {
      studentId: sid,
      subjects: input.subjects.map((s) => {
        const avg = subjectAvgs.get(s.id)!.get(sid) ?? null;
        return {
          subjectId: s.id,
          average: fmt(avg),
          points: avg === null ? null : avg.times(D(s.coefficient)).toFixed(rules.decimals),
          rank: subjectRanks.get(s.id)!.get(sid) ?? null,
        };
      }),
      totalCoefficients: g.coef.toString(),
      totalPoints: g.points.toFixed(rules.decimals),
      average: fmt(g.avg),
      rank: generalRanks.get(sid) ?? null,
      mention: mentionFor(g.avg),
      passed: g.avg === null ? null : g.avg.greaterThanOrEqualTo(rules.passMark),
    };
  });

  const stats = (values: (Decimal | null | undefined)[]) => {
    const v = values.filter((x): x is Decimal => x !== null && x !== undefined);
    if (v.length === 0) return { average: null, min: null, max: null, passRate: null, n: 0 };
    const total = v.reduce((a, b) => a.plus(b), new Decimal(0));
    return {
      average: fmt(total.dividedBy(v.length)),
      min: fmt(Decimal.min(...v)),
      max: fmt(Decimal.max(...v)),
      passRate: Number(new Decimal(v.filter((x) => x.greaterThanOrEqualTo(rules.passMark)).length).dividedBy(v.length).times(100).toFixed(1)),
      n: v.length,
    };
  };

  const classStats = stats([...general.values()].map((g) => g.avg));
  return {
    students,
    subjects: input.subjects.map((s) => {
      const st = stats([...subjectAvgs.get(s.id)!.values()]);
      return { subjectId: s.id, average: st.average, min: st.min, max: st.max, passRate: st.passRate, assessed: st.n };
    }),
    class: { average: classStats.average, min: classStats.min, max: classStats.max, passRate: classStats.passRate, ranked: classStats.n },
  };
}

/** Ranks descending; students without an average are unranked (null). */
function rank(values: Map<string, Decimal | null | undefined>, mode: GradingRules['ranking']): Map<string, number | null> {
  const ranked = [...values]
    .filter((e): e is [string, Decimal] => e[1] !== null && e[1] !== undefined)
    .sort((a, b) => b[1].comparedTo(a[1]));
  const out = new Map<string, number | null>([...values.keys()].map((k) => [k, null]));
  let position = 0;
  let dense = 0;
  let previous: Decimal | null = null;
  let previousRank = 0;
  for (const [id, v] of ranked) {
    position++;
    if (previous === null || !v.equals(previous)) {
      dense++;
      previousRank = mode === 'COMPETITION' ? position : dense;
      previous = v;
    }
    out.set(id, previousRank);
  }
  return out;
}
