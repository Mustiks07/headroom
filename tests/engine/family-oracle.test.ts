// Group 5: independent family scenario — both years, explicit baseline, cash vs retirement split,
// no duplicate APTC repayment. The oracle below uses its own constants and exhaustive whole-dollar
// scans; it imports no engine arithmetic. Its scope is deliberately narrow: TN MFJ, one CTC child,
// Schedule C only, uniform full-year coverage, household income in the 250%-and-above region.
import { describe, expect, it } from "vitest";
import audit from "../../data/reference/audit-results.json";
import table2026 from "../../data/reference/2026-8962-table2.json";
import { calculateComparison } from "@/lib/engine";
import { evaluateYear } from "@/lib/engine/year";
import { family, model, usd } from "./helpers";

const rh = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b)); // non-negative round half up
const Y = {
  2026: { fpl: 26650, std: 32200, b1: 24800, b2: 100800, ctc: 2200, fig: (p: number) => (table2026.figures as Record<string, number>)[String(p)] },
  2027: { fpl: 27320, std: 33200, b1: 25600, b2: 104050, ctc: 2300, fig: (p: number) => {
    // Rev. Proc. 2026-26: 250–300% runs 8.66% → 10.22%, 300–400% flat 10.22% (Table 2 rounding: half up to 4 decimals).
    if (p >= 300) return 1022;
    if (p < 250) throw new Error("oracle scope");
    return rh(866 * 50 + 156 * (p - 250), 50);
  } },
} as const;

/** Best valid (SEHI, PTC) for profit P and SEP s (all cents), by scanning every whole-dollar deduction. */
function oracle(year: 2026 | 2027, P: number, s: number, prem: number, bench: number) {
  const k = Y[year];
  const net = rh(P * 9235, 10000);
  const se = rh(net * 124, 1000) + rh(net * 29, 1000);
  const half = rh(se, 2);
  const base = P - half - s;
  let best: { d: number; magi: number; ptc: number; tax: number; cash: number } | null = null;
  for (let d = 0; d <= Math.floor(Math.min(prem, base) / 100); d++) {
    const M = base - d * 100;
    let ptc = 0;
    if (M <= 4 * k.fpl * 100) {
      const pct = Math.floor(M / k.fpl);
      if (pct < 250) throw new Error("oracle scope");
      ptc = Math.min(prem, Math.max(0, bench - rh(M * k.fig(pct), 1000000) * 100));
    }
    if (d * 100 + ptc > prem) continue;
    const ti0 = Math.max(0, M - k.std * 100);
    const ti = ti0 - Math.min(rh((base - d * 100) * 2, 10), rh(ti0 * 2, 10));
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

const PREM = { 2026: usd(23013), 2027: usd(28122.84) };
const BENCH = { 2026: usd(23013), 2027: usd(27789.36) };
const PROFIT = usd(118000);

describe("independent family scenario (synthetic TN household)", async () => {
  const c = family();
  const t0 = performance.now();
  const result = await calculateComparison(c);
  const elapsed = performance.now() - t0;
  if (result.status !== "ready") throw new Error(JSON.stringify(result));
  const byKind = Object.fromEntries(result.scenarios.map(s => [s.kind, s]));
  const oracleYears = (kind: string) => {
    const sc = byKind[kind];
    return ([2026, 2027] as const).map((year, yi) => {
      const receipts = sc.decisions.receipts.filter(r => r.date.startsWith(String(year))).reduce((a, r) => a + r.amountCents, 0);
      const sep = sc.decisions.additionalSep.filter(x => x.year === year).reduce((a, x) => a + x.amountCents, 0);
      return { yi, o: oracle(year, PROFIT + receipts, sep, PREM[year], BENCH[year]) };
    });
  };

  it("matches the oracle in both years for every scenario, with decline as the explicit baseline", () => {
    expect(result.baselineScenarioId).toBe("decline");
    const declineTotal = oracleYears("decline").reduce((a, y) => a + y.o.cash, 0);
    for (const sc of result.scenarios) {
      const ys = oracleYears(sc.kind);
      for (const { yi, o } of ys) {
        const y = sc.years[yi];
        expect([sc.kind, y.year, y.sehiDeductionCents, y.magiCents, y.ptcCents]).toEqual([sc.kind, y.year, o.d, o.magi, o.ptc]);
        expect(y.spendableAfterSettlementCents).toBe(o.cash);
        expect(y.aptcSettlementCents).toBe(y.aptcCents - y.ptcCents);
      }
      expect(sc.twoYearCashDeltaCents).toBe(ys.reduce((a, y) => a + y.o.cash, 0) - declineTotal);
    }
  });

  it("keeps retirement money out of spendable cash", () => {
    const sep = byKind.sep_minimum;
    expect(sep.grossAdditionalRetirementCents).toBe(sep.decisions.additionalSep[0].amountCents);
    expect(sep.years[0].additionalRetirementCents).toBe(sep.grossAdditionalRetirementCents);
    const o = oracle(2026, PROFIT + usd(12000), sep.grossAdditionalRetirementCents, PREM[2026], BENCH[2026]);
    expect(o.cash).toBe(sep.years[0].spendableAfterSettlementCents); // the oracle subtracts the contribution
  });

  it("chooses SEP and split amounts the oracle cannot beat", () => {
    const sepS = byKind.sep_minimum.grossAdditionalRetirementCents;
    const cands = new Set<number>();
    for (let s = 0; s <= 5500; s += 100) cands.add(s);
    for (let s = 3550; s <= 3650; s++) cands.add(s);
    let bestSep = { s: -1, cash: -Infinity };
    for (const s of [...cands].sort((a, b) => a - b)) {
      const cash = oracle(2026, PROFIT + usd(12000), s * 100, PREM[2026], BENCH[2026]).cash;
      if (cash > bestSep.cash) bestSep = { s, cash };
    }
    expect(sepS).toBe(bestSep.s * 100);

    const split = byKind.split_payment;
    const engineTotal = split.years[0].spendableAfterSettlementCents + split.years[1].spendableAfterSettlementCents;
    const xs = new Set<number>();
    for (let x = 0; x <= 12000; x += 250) xs.add(x);
    const first = split.decisions.receipts[0].amountCents / 100;
    for (let x = first - 60; x <= first + 60; x++) xs.add(x);
    for (const x of xs) {
      const total = oracle(2026, PROFIT + x * 100, 0, PREM[2026], BENCH[2026]).cash + oracle(2027, PROFIT + (12000 - x) * 100, 0, PREM[2027], BENCH[2027]).cash;
      expect(total).toBeLessThanOrEqual(engineTotal);
    }
  });

  it("stays within documented rounding of the historical prototype audit at its decisions", () => {
    // Differences come from formal rounding: Tax Table midpoints (< $100k taxable) and cent-rounded Schedule SE lines.
    const cases: Array<[string, number, number, number]> = [
      ["decline", 0, 0, 0], ["accept December", 12000, 0, 0], ["accept SEP 3600", 12000, 3600, 0],
      ["accept SEP 5500", 12000, 5500, 0], ["4000 December / 8000 January", 4000, 0, 8000]];
    const m0 = model(c, 0), m1 = model(c, 1);
    for (const [name, r26, sep, r27] of cases) {
      const row = audit.scenarios.find(s => s.scenario === name)!;
      const ours = [evaluateYear(m0, { profitDelta: usd(r26), additionalSep: usd(sep) }), evaluateYear(m1, { profitDelta: usd(r27), additionalSep: 0 })];
      ours.forEach((y, i) => {
        const ref = row.years[i].reference;
        expect(y.credit.sehi).toBe(usd(ref.sehi));
        expect(y.credit.ptc.ptc).toBe(usd(ref.ptc));
        expect(Math.abs(y.spendable - usd(ref.cash))).toBeLessThanOrEqual(usd(5));
      });
    }
  });

  it("computes the full comparison within the latency target", () => {
    console.info(`family comparison: ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan(2000);
  });
});
