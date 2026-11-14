/**
 * Declared uncertainty ranges, checked as INDEPENDENT ranges.
 *
 * Allowed ranges (guard.ts): the business owner's Schedule C profit and adults'
 * taxable / tax-exempt interest. Each of them can only raise household income
 * (ACA MAGI after the coupled SEHI/PTC solution) when it rises, so over the whole
 * box of combinations:
 *  - the highest household income — and therefore any loss of the premium tax
 *    credit — occurs at the combination with every range at its high end;
 *  - the lowest income, AGI and earned income — and therefore any fall below
 *    100% FPL, possible EITC, or a SEP above the profit-based legal limit — occur
 *    at the combination with every range at its low end.
 * Credit loss and validity are therefore decided exactly for every combination.
 * The two-year cash change is not monotone; it is evaluated on a finite, listed
 * set of combinations (every combination of range ends, each range swept with the
 * others at both ends, all ranges moved together, and every subsidy-threshold
 * crossing on those paths). The worst value reported is the worst checked value.
 * Tax years are independent dimensions; cash is additive across years, so the
 * worst two-year value is the sum of each year's worst checked value.
 */
import { mulRatio } from "./money";
import { FIELD_LABELS, type IncomeField, type Variation, type YearModel } from "./model";
import { magiOf, magiThresholds } from "./search";

export const UNCERTAINTY_SCALE = 1000;
const N = UNCERTAINTY_SCALE;
export const MAX_CORNER_DIMENSIONS = 6;

export interface RangeDim { key: string; personId: string; field: IncomeField; label: string }
export type Position = (key: string) => number;

export function rangeDims(model: YearModel): RangeDim[] {
  return model.persons.flatMap(p => (Object.keys(p.ranges) as IncomeField[]).map(field =>
    ({ key: `${p.id}.${field}`, personId: p.id, field, label: `${p.possessive} ${FIELD_LABELS[field]}` })));
}
export const hasRanges = (model: YearModel) => rangeDims(model).length > 0;

/** Household with each ranged amount at position k ∈ [−1000, 1000] (−1000 low end, 0 entered value, +1000 high end). */
export function modelAtPositions(model: YearModel, pos: Position): YearModel {
  if (!hasRanges(model)) return model;
  return {
    ...model,
    persons: model.persons.map(p => {
      const amounts = { ...p.amounts };
      for (const [f, r] of Object.entries(p.ranges) as Array<[IncomeField, { low: number; high: number }]>) {
        const k = pos(`${p.id}.${f}`), v = p.amounts[f];
        amounts[f] = k < 0 ? v + mulRatio(v - r.low, k, N) : v + mulRatio(r.high - v, k, N);
      }
      return { ...p, amounts };
    }),
  };
}
export const modelAt = (model: YearModel, k: number) => (k === 0 ? model : modelAtPositions(model, () => k));

export interface CheckedPosition { pos: Position; description: string }

/** Finite, documented set of combinations to evaluate for one year. */
export function checkedPositions(model: YearModel, variations: Variation[]): { positions: CheckedPosition[]; summary: string } {
  const dims = rangeDims(model);
  if (!dims.length) return { positions: [{ pos: () => 0, description: "your entered values" }], summary: "" };
  const out: CheckedPosition[] = [{ pos: () => 0, description: "your entered values" }];
  const thresholds = magiThresholds(model);
  // Positions along a monotone path where solved household income crosses a subsidy threshold.
  const crossings = (path: (k: number) => Position): number[] => {
    const ks: number[] = [];
    for (const v of variations) {
      const m = (k: number) => magiOf(modelAtPositions(model, path(k)), v);
      const a = m(-N), b = m(N);
      for (const t of thresholds) {
        if (t < a || t >= b) continue;
        let l = -N, h = N;
        while (l < h) { const mid = Math.ceil((l + h) / 2); if (m(mid) <= t) l = mid; else h = mid - 1; }
        ks.push(l, Math.min(N, l + 1));
      }
    }
    return ks;
  };
  const sweep = (path: (k: number) => Position, name: (k: number) => string, gridSteps: number) => {
    const ks = new Set<number>();
    for (let i = 0; i <= gridSteps; i++) ks.add(-N + Math.round((2 * N * i) / gridSteps));
    crossings(path).forEach(k => ks.add(k));
    for (const k of [...ks].sort((x, y) => x - y)) out.push({ pos: path(k), description: name(k) });
  };
  sweep(k => () => k, k => `all ranges ${describeK(k)}`, 40);
  let corners = 0;
  if (dims.length <= MAX_CORNER_DIMENSIONS) {
    for (let mask = 0; mask < 1 << dims.length; mask++) {
      const ends = new Map(dims.map((d, i) => [d.key, (mask >> i) & 1 ? N : -N]));
      out.push({ pos: key => ends.get(key) ?? 0,
        description: dims.map(d => `${d.label} at its ${ends.get(d.key)! > 0 ? "high" : "low"} end`).join(", ") });
      corners++;
    }
  }
  if (dims.length > 1) {
    for (const d of dims) for (const other of [-N, N]) {
      sweep(k => key => (key === d.key ? k : other),
        k => `${d.label} ${describeK(k)}, other ranges at their ${other > 0 ? "high" : "low"} ends`, 20);
    }
  }
  const summary = `${out.length} combinations for ${model.year}: ` +
    (corners ? `every combination of range ends (${corners}), ` : `range ends moved together (more than ${MAX_CORNER_DIMENSIONS} ranges, so not every corner), `) +
    (dims.length > 1 ? "each range swept with the others at their low and at their high ends, " : "") +
    "all ranges moved together, and each point on those paths where this option or declining crosses a subsidy threshold";
  return { positions: out, summary };
}

export function describeK(k: number): string {
  if (k === 0) return "at your entered value";
  if (k === N) return "at the high end";
  if (k === -N) return "at the low end";
  const pct = Math.round(Math.abs(k) / 10);
  if (pct === 0) return k < 0 ? "just below your entered value" : "just above your entered value";
  return k < 0 ? `${pct}% of the way to the low end` : `${pct}% of the way to the high end`;
}
