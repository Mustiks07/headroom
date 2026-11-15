// Independent reference for the narrow family scope (TN MFJ, one CTC child, Schedule C only, uniform full-year coverage,
// household income at or above 250% FPL). Own constants and whole-dollar scans; imports no engine arithmetic.
// Shared input with the engine: the transcribed DRAFT 2026 Form 8962 Table 2 (data/reference/2026-8962-table2.json).
// 2027 applicable figures are re-derived here from Rev. Proc. 2026-26 bands, independently of the engine's rule pack.
import table2026 from "../../data/reference/2026-8962-table2.json";

export const rh = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b)); // non-negative round half up
export const Y = {
  2026: { fpl: 26650, std: 32200, b1: 24800, b2: 100800, ctc: 2200, fig: (p: number) => (table2026.figures as Record<string, number>)[String(p)] },
  2027: { fpl: 27320, std: 33200, b1: 25600, b2: 104050, ctc: 2300, fig: (p: number) => {
    // Rev. Proc. 2026-26: 250–300% runs 8.66% → 10.22%, 300–400% flat 10.22% (Table 2 rounding: half up to 4 decimals).
    if (p >= 300) return 1022;
    if (p < 250) throw new Error("oracle scope");
    return rh(866 * 50 + 156 * (p - 250), 50);
  } },
} as const;

/**
 * Best valid (SEHI, PTC) for profit P and SEP s (all cents), by scanning every whole-dollar deduction.
 * Whole-dollar return (Form 1040 "Rounding Off to Whole Dollars"; Form 8962 accepts dollars only).
 */
export function oracle(year: 2026 | 2027, P: number, s: number, prem: number, bench: number) {
  const k = Y[year];
  const net = rh(P * 9235, 1000000) * 100;                       // Schedule SE line 4a, whole dollars
  const se = rh(net * 124, 100000) * 100 + rh(net * 29, 100000) * 100;
  const half = rh(se, 200) * 100;
  const base = P - half - s;
  const premW = rh(prem, 100) * 100, benchW = rh(bench, 100) * 100;  // Form 1095-A annual totals in whole dollars
  let best: { d: number; magi: number; ptc: number; tax: number; cash: number } | null = null;
  for (let d = 0; d <= Math.floor(Math.min(prem, base) / 100); d++) {
    const M = base - d * 100;
    let ptc = 0;
    if (M <= 4 * k.fpl * 100) {
      const pct = Math.floor(M / k.fpl);
      if (pct < 250) throw new Error("oracle scope");
      ptc = Math.min(premW, Math.max(0, benchW - rh(M * k.fig(pct), 1000000) * 100));
    }
    if (d * 100 + ptc > premW) continue;
    const ti0 = Math.max(0, M - k.std * 100);
    const ti = ti0 - Math.min(rh((base - d * 100) * 2, 1000) * 100, rh(ti0 * 2, 1000) * 100);
    if (ti < 300000 || ti >= 10000000) throw new Error("oracle scope");
    const mid = 300000 + Math.floor((ti - 300000) / 5000) * 5000 + 2500;
    if (mid > k.b2 * 100) throw new Error("oracle scope");
    const tax = rh(Math.min(mid, k.b1 * 100) * 10 + Math.max(0, mid - k.b1 * 100) * 12, 10000) * 100;
    const incomeTax = Math.max(0, tax - k.ctc * 100);
    const cash = P - se - incomeTax - (prem - ptc) - s;   // APTC appears nowhere: settlement is inside prem − ptc
    if (!best || cash >= best.cash) best = { d: d * 100, magi: M, ptc, tax: incomeTax, cash }; // ties: larger deduction
  }
  return best!;
}

