// Group 2: SEHI/PTC inequality counterexample and a justified choice across discontinuities.
import { describe, expect, it } from "vitest";
import { TABLE_2026 } from "@/lib/engine/rules";
import { solveCredit } from "@/lib/engine/year";
import { NO_VARIATION } from "@/lib/engine/model";
import { model, setCoverage, setIncome, single, usd } from "./helpers";

/** Independent PTC for a single filer in 2026: own constants, transcribed table data, plain arithmetic. */
function independentPtc(magiCents: number, premium: number, benchmark: number): number {
  const fpl = 15650;
  if (magiCents > 4 * fpl * 100) return 0;
  const pct = Math.floor(magiCents / fpl);
  if (pct < 100) return 0;
  const fig = (TABLE_2026.figures as Record<string, number>)[String(pct)];
  const contribution = Math.round((magiCents * fig) / 10000 / 100) * 100;
  return Math.min(premium, Math.max(0, benchmark - contribution));
}

describe("coupled SEHI deduction and PTC", () => {
  // Profit $23,000, single, premium = benchmark = $7,800/yr. No d satisfies d + PTC = premium exactly
  // (PTC jumps at 133%), so a fixed-point/equality method returns no credit. The inequality has solutions.
  const c = setCoverage(setIncome(single(), 0, "primary", { scheduleCProfit: usd(23000) }), 0, usd(650), usd(650), 0);
  const m = model(c);
  const sol = solveCredit(m, NO_VARIATION);

  it("finds the valid nonzero solution", () => {
    expect(sol.ptc.ptc).toBeGreaterThan(0);
    expect(sol.sehi + sol.ptc.ptc).toBeLessThanOrEqual(usd(7800));
    expect(sol.sehi).toBe(usd(560));
    expect(sol.ptc.ptc).toBe(usd(7146));
    expect(sol.ptc.line5).toBe(133);
  });

  it("matches an exhaustive independent scan of every whole-dollar deduction at or above 100% FPL", () => {
    // Below 100% FPL (d > 5,725 here) the credit would need the unmodeled below-100% exception; the engine stays above it.
    const base = sol.magiBeforeSehi;
    const feasible: number[] = [];
    let equality = false;
    for (let d = 0; d <= 7800 && base - d * 100 >= 15650 * 100; d++) {
      const ptc = independentPtc(base - d * 100, usd(7800), usd(7800));
      if (d * 100 + ptc <= usd(7800)) feasible.push(d);
      if (d * 100 + ptc === usd(7800)) equality = true;
    }
    expect(equality).toBe(false);                       // the equality-only method has no answer here
    expect(Math.max(...feasible)).toBe(560);            // the valid set is [0, 560]
    expect(feasible).toHaveLength(561);
  });
});
