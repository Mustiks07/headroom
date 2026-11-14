/**
 * Bounded searches over one whole-dollar decision (SEP amount, receipt split,
 * counteroffer price, uncertainty position).
 *
 * Method (documented in the handoff):
 *  1. Every decision moves each year's solved household income (MAGI after the
 *     coupled SEHI/PTC solution) monotonically. The objective's upward jumps can
 *     only come from crossing a structural PTC threshold: the 400% line, an
 *     integer line-5 step where the applicable figure changes, or 100% FPL.
 *     For each such threshold inside the decision range, the exact crossing
 *     decision is found by bisection and evaluated together with its neighbours.
 *  2. Between thresholds the objective is piecewise linear (tax brackets,
 *     phase-ins) with |slope| ≤ 2 per dollar; a uniform grid (≤ 4,000 points)
 *     plus a dollar-exact scan around the best point bounds the residual error
 *     by 2 × grid step, plus ≤ $30 of form rounding noise (Tax Table $50
 *     bands, whole-dollar Form 8962 contribution).
 * Ranges ≤ $8,000 are therefore scanned exhaustively at $1.
 */
import { EngineStop, type Variation, type YearModel } from "./model";
import { solveCredit } from "./year";

export const GRID_POINTS = 8000;
export const ROUNDING_NOISE_CENTS = 3000;

/** Structural thresholds on MAGI (cents): solution is "favourable" when MAGI ≤ threshold. */
export function magiThresholds(model: YearModel): number[] {
  if (!model.ptcEligible) return [];
  const fpl = model.rules.fplDollars(model.familySize);
  const out = [400 * fpl];
  for (let k = 101; k <= 400; k++) {
    if (model.rules.applicableFigure(k) !== model.rules.applicableFigure(k - 1)) out.push(k * fpl - 1);
  }
  out.push(100 * fpl - 1);
  return out;
}

export interface MonotoneMagi { magi: (v: number) => number; thresholds: number[] }

/** Solved MAGI only (no tax guards; SEP limit not enforced, so it is total over the whole range). */
export function magiOf(model: YearModel, v: Variation): number {
  return solveCredit(model, v, false).magi;
}

/** Decisions at which a monotone MAGI function crosses each threshold (both sides). */
function crossings(lo: number, hi: number, m: MonotoneMagi): number[] {
  const a = m.magi(lo), b = m.magi(hi);
  const increasing = b >= a;
  const min = Math.min(a, b), max = Math.max(a, b);
  const out: number[] = [];
  for (const t of m.thresholds) {
    if (t < min || t >= max) continue;
    // increasing: last v with magi ≤ t; decreasing: first v with magi ≤ t.
    let l = lo, h = hi;
    if (increasing) {
      while (l < h) { const mid = Math.ceil((l + h) / 2); if (m.magi(mid) <= t) l = mid; else h = mid - 1; }
    } else {
      while (l < h) { const mid = Math.floor((l + h) / 2); if (m.magi(mid) <= t) h = mid; else l = mid + 1; }
    }
    out.push(l - 1, l, l + 1);
  }
  return out;
}

export function candidateSet(lo: number, hi: number, magis: MonotoneMagi[]): { points: number[]; step: number } {
  const step = Math.max(1, Math.ceil((hi - lo) / GRID_POINTS));
  const set = new Set<number>([lo, hi]);
  for (let v = lo; v <= hi; v += step) set.add(v);
  for (const m of magis) for (const v of crossings(lo, hi, m)) set.add(v);
  return { points: [...set].filter(v => v >= lo && v <= hi).sort((x, y) => x - y), step };
}

const tryValue = <T>(f: () => T): T | null => {
  try { return f(); } catch (e) { if (e instanceof EngineStop) return null; throw e; }
};

export interface OptimizeResult { v: number; value: number; evaluated: number; step: number }

/** Maximise objective(v) over whole dollars in [lo, hi]; ties go to the preferred end. */
export function optimize(lo: number, hi: number, objective: (v: number) => number, magis: MonotoneMagi[],
  prefer: "low" | "high"): OptimizeResult | null {
  if (hi < lo) return null;
  const { points, step } = candidateSet(lo, hi, magis);
  let best: { v: number; value: number } | null = null;
  let evaluated = 0;
  const consider = (v: number) => {
    const value = tryValue(() => objective(v));
    evaluated++;
    if (value === null) return;
    if (!best || value > best.value || (value === best.value && (prefer === "low" ? v < best.v : v > best.v))) best = { v, value };
  };
  for (const v of points) consider(v);
  if (!best) return null;
  if (step > 1) {
    const centre: number = (best as { v: number }).v;
    for (let v = Math.max(lo, centre - step); v <= Math.min(hi, centre + step); v++) consider(v);
  }
  const b = best as { v: number; value: number };
  return { v: b.v, value: b.value, evaluated, step };
}

/**
 * Smallest whole-dollar v in [lo, hi] with pred(v) true. Candidates (grid + threshold
 * crossings) locate the first qualifying region; then every dollar from lo up to it is
 * checked when that span is ≤ exhaustiveLimit, so the answer is the exact minimum.
 * Otherwise only the dollars after the previous candidate are checked (exact = false).
 */
export function firstMeeting(lo: number, hi: number, pred: (v: number) => boolean, magis: MonotoneMagi[],
  exhaustiveLimit = 20000): { v: number | null; step: number; exact: boolean } {
  const { points, step } = candidateSet(lo, hi, magis);
  let prev = lo - 1;
  for (const c of points) {
    if (tryValue(() => pred(c))) {
      const exact = c - lo <= exhaustiveLimit;
      for (let v = exact ? lo : prev + 1; v < c; v++) if (tryValue(() => pred(v))) return { v, step, exact };
      return { v: c, step, exact };
    }
    prev = c;
  }
  return { v: null, step, exact: hi - lo <= exhaustiveLimit && step === 1 };
}

/**
 * Additional owner profit (whole dollars) that can be added before the credit
 * is lost, re-solving SEHI/PTC each time. null when no credit now.
 */
export function profitHeadroomDollars(model: YearModel, v: Variation): number | null {
  const ptcAt = (d: number) => solveCredit(model, { ...v, profitDelta: v.profitDelta + d * 100 }).ptc.ptc;
  if (ptcAt(0) <= 0) return null;
  let lo = 0, hi = 1000;
  while (ptcAt(hi) > 0) { lo = hi; hi *= 2; if (hi > 10_000_000) return null; }
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (ptcAt(mid) > 0) lo = mid; else hi = mid - 1; }
  return lo;
}
