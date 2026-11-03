import Decimal from 'decimal.js';
import { z } from 'zod';
import { rank } from './grading';

/**
 * Competence-based marking (Phase 8), as in the MINEDUB 2018 primary curriculum and its progress report booklet.
 *
 * A competence (e.g. "6B — Practise artistic activities, 20 marks") is a class subject made of evaluation components
 * (oral, written, practical, attitude), each with its maximum. Teachers enter a mark per component each month; the
 * school year has 9 months, three per term.
 *
 * Formulas (pure and deterministic, so a printed booklet can be recomputed by hand):
 *  - component term mark  = average of the months of the term that have a mark (rounded half-up)
 *  - competence term mark = Σ component term marks;            its maximum = Σ component maxima
 *  - term total           = Σ competence term marks over competences marked that term
 *  - term average /20     = term total ÷ maximum of those competences × 20   (209/280 → 14.93)
 *  - annual (competence and total) = average of the term marks present
 *  - appreciation         = share of the maximum: below `spa` % → SNA (skill not acquired), below `sa` → SPA
 *                           (partially acquired), below `exp` → SA (acquired), else EXP (expert)
 *  - positions            = competition ranking of the averages (ties share a place, the next ones skip)
 */
export const COMPETENCE_COMPONENTS = ['ORAL', 'WRITTEN', 'PRACTICAL', 'ATTITUDE'] as const;
export type CompetenceComponent = (typeof COMPETENCE_COMPONENTS)[number];

export const MONTHS = 9;
export const TERMS = 3;
export const termOfMonth = (month: number) => Math.ceil(month / (MONTHS / TERMS));
export const monthsOfTerm = (term: number) => [1, 2, 3].map((i) => (term - 1) * 3 + i);

export const APPRECIATIONS = ['SNA', 'SPA', 'SA', 'EXP'] as const;
export type Appreciation = (typeof APPRECIATIONS)[number];

export const competenceRulesSchema = z
  .object({
    /** Lower bound (in % of the maximum) of SPA, SA and EXP. */
    spa: z.number().min(0).max(100),
    sa: z.number().min(0).max(100),
    exp: z.number().min(0).max(100),
    decimals: z.number().int().min(0).max(2),
  })
  .refine((r) => r.spa < r.sa && r.sa < r.exp, { message: 'thresholds_order' });
export type CompetenceRules = z.infer<typeof competenceRulesSchema>;

/** Defaults to confirm with each school (MINEDUB leaves the cut-offs to the booklet in use). */
export const DEFAULT_COMPETENCE_RULES: CompetenceRules = { spa: 50, sa: 70, exp: 90, decimals: 2 };

/** A competence's evaluation components and their maximum marks, set per class subject. */
export const competenceComponentsSchema = z.object({
  components: z
    .array(z.object({ kind: z.enum(COMPETENCE_COMPONENTS), max: z.number().positive().max(100) }))
    .min(1)
    .refine((list) => new Set(list.map((c) => c.kind)).size === list.length, { message: 'duplicate_component' }),
});
export type CompetenceComponentsInput = z.infer<typeof competenceComponentsSchema>;

/** A month's marks for one competence of a class: one row per pupil, empty cell = no mark. */
export const competenceMarksSchema = z.object({
  classSubjectId: z.uuid(),
  month: z.number().int().min(1).max(MONTHS),
  rows: z
    .array(
      z.object({
        enrollmentId: z.uuid(),
        marks: z.partialRecord(z.enum(COMPETENCE_COMPONENTS), z.string().regex(/^\d{1,3}([.,]\d{1,2})?$/).nullable()),
      }),
    )
    .max(200),
});
export type CompetenceMarksInput = z.infer<typeof competenceMarksSchema>;

export interface CompetenceDef {
  id: string;
  components: { kind: CompetenceComponent; max: string }[];
}

export interface CompetenceEngineInput {
  rules: CompetenceRules;
  competences: CompetenceDef[];
  studentIds: string[];
  marks: { studentId: string; competenceId: string; month: number; kind: CompetenceComponent; score: string }[];
}

export interface CompetenceTermResult {
  /** Component → term mark. */
  components: Partial<Record<CompetenceComponent, string>>;
  /** Month → component → mark, as entered. */
  months: Record<number, Partial<Record<CompetenceComponent, string>>>;
  total: string | null;
  max: string;
  appreciation: Appreciation | null;
}

export interface StudentTermResult {
  total: string | null;
  max: string | null;
  average: string | null;
  rank: number | null;
}

export interface StudentCompetenceResult {
  studentId: string;
  /** competenceId → term (1..3) → result. */
  competences: Record<string, Record<number, CompetenceTermResult>>;
  /** competenceId → annual mark and appreciation. */
  annualCompetences: Record<string, { total: string | null; appreciation: Appreciation | null }>;
  terms: Record<number, StudentTermResult>;
  annual: StudentTermResult;
}

export interface CompetenceEngineResult {
  /** Σ of every competence's maximum (e.g. 280). */
  grandMax: string;
  classSize: number;
  students: StudentCompetenceResult[];
}

export function appreciationOf(score: Decimal | null, max: Decimal, rules: CompetenceRules): Appreciation | null {
  if (score === null || max.isZero()) return null;
  const pct = score.dividedBy(max).times(100);
  if (pct.lessThan(rules.spa)) return 'SNA';
  if (pct.lessThan(rules.sa)) return 'SPA';
  if (pct.lessThan(rules.exp)) return 'SA';
  return 'EXP';
}

export function computeCompetenceResults(input: CompetenceEngineInput): CompetenceEngineResult {
  const { rules } = input;
  const round = (v: Decimal) => v.toDecimalPlaces(rules.decimals, Decimal.ROUND_HALF_UP);
  const str = (v: Decimal | null) => (v === null ? null : round(v).toFixed(rules.decimals));
  const maxOf = (c: CompetenceDef) => c.components.reduce((s, x) => s.plus(x.max), new Decimal(0));
  const grandMax = input.competences.reduce((s, c) => s.plus(maxOf(c)), new Decimal(0));

  // studentId → competenceId → month → kind → score
  const byStudent = new Map<string, Map<string, Map<number, Map<CompetenceComponent, Decimal>>>>();
  for (const m of input.marks) {
    const s = byStudent.get(m.studentId) ?? new Map();
    const c = s.get(m.competenceId) ?? new Map();
    const mo = c.get(m.month) ?? new Map();
    mo.set(m.kind, new Decimal(m.score.replace(',', '.')));
    c.set(m.month, mo);
    s.set(m.competenceId, c);
    byStudent.set(m.studentId, s);
  }

  const termTotals = new Map<number, Map<string, { total: Decimal | null; max: Decimal; average: Decimal | null }>>();
  const results: StudentCompetenceResult[] = input.studentIds.map((sid) => {
    const marks = byStudent.get(sid) ?? new Map();
    const competences: StudentCompetenceResult['competences'] = {};
    const annualCompetences: StudentCompetenceResult['annualCompetences'] = {};
    const terms: StudentCompetenceResult['terms'] = {};
    const perTermTotals: Decimal[] = [];
    const perTermMax: Decimal[] = [];

    for (let term = 1; term <= TERMS; term++) {
      let total = new Decimal(0);
      let max = new Decimal(0);
      let any = false;
      for (const comp of input.competences) {
        const months = marks.get(comp.id) ?? new Map<number, Map<CompetenceComponent, Decimal>>();
        const entry: CompetenceTermResult = { components: {}, months: {}, total: null, max: maxOf(comp).toString(), appreciation: null };
        let compTotal = new Decimal(0);
        let compAny = false;
        for (const { kind } of comp.components) {
          const values = monthsOfTerm(term)
            .map((mo) => months.get(mo)?.get(kind))
            .filter((v): v is Decimal => v !== undefined);
          for (const mo of monthsOfTerm(term)) {
            const v = months.get(mo)?.get(kind);
            if (v !== undefined) (entry.months[mo] ??= {})[kind] = v.toString();
          }
          if (values.length === 0) continue;
          const avg = round(values.reduce((s, v) => s.plus(v), new Decimal(0)).dividedBy(values.length));
          entry.components[kind] = avg.toFixed(rules.decimals);
          compTotal = compTotal.plus(avg);
          compAny = true;
        }
        if (compAny) {
          entry.total = str(compTotal);
          entry.appreciation = appreciationOf(round(compTotal), maxOf(comp), rules);
          total = total.plus(round(compTotal));
          max = max.plus(maxOf(comp));
          any = true;
        }
        (competences[comp.id] ??= {})[term] = entry;
      }
      const average = any && !max.isZero() ? round(total.dividedBy(max).times(20)) : null;
      terms[term] = { total: any ? str(total) : null, max: any ? max.toString() : null, average: str(average), rank: null };
      if (any) {
        perTermTotals.push(total);
        perTermMax.push(max);
      }
      const t = termTotals.get(term) ?? new Map();
      t.set(sid, { total: any ? total : null, max, average });
      termTotals.set(term, t);
    }

    for (const comp of input.competences) {
      const marked = Object.values(competences[comp.id] ?? {}).filter((r) => r.total !== null);
      const annual = marked.length ? round(marked.reduce((s, r) => s.plus(r.total!), new Decimal(0)).dividedBy(marked.length)) : null;
      annualCompetences[comp.id] = { total: str(annual), appreciation: appreciationOf(annual, maxOf(comp), rules) };
    }
    const annualTotal = perTermTotals.length ? round(perTermTotals.reduce((s, v) => s.plus(v), new Decimal(0)).dividedBy(perTermTotals.length)) : null;
    const annualMax = perTermMax.length ? perTermMax.reduce((s, v) => s.plus(v), new Decimal(0)).dividedBy(perTermMax.length) : null;
    const annualAverage = annualTotal !== null && annualMax && !annualMax.isZero() ? round(annualTotal.dividedBy(annualMax).times(20)) : null;
    return {
      studentId: sid,
      competences,
      annualCompetences,
      terms,
      annual: { total: str(annualTotal), max: annualMax ? str(annualMax) : null, average: str(annualAverage), rank: null },
    };
  });

  for (let term = 1; term <= TERMS; term++) {
    const positions = rank(new Map([...termTotals.get(term)!].map(([sid, v]) => [sid, v.average])), 'COMPETITION');
    for (const r of results) r.terms[term]!.rank = positions.get(r.studentId) ?? null;
  }
  const annualPositions = rank(new Map(results.map((r) => [r.studentId, r.annual.average === null ? null : new Decimal(r.annual.average)])), 'COMPETITION');
  for (const r of results) r.annual.rank = annualPositions.get(r.studentId) ?? null;

  return { grandMax: grandMax.toString(), classSize: input.studentIds.length, students: results };
}
