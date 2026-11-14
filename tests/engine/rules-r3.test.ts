// Round 2 source checks: one regression per discrepancy found against the primary sources.
import { describe, expect, it } from "vitest";
import taxTable from "../../data/reference/2026-tax-table.json";
import type { CaseInput } from "@/domain/contracts";
import { NO_VARIATION } from "@/lib/engine/model";
import { rate } from "@/lib/engine/money";
import { rulesFor } from "@/lib/engine/rules";
import { evaluateYear, regularTax } from "@/lib/engine/year";
import { fact, family, model, setCoverage, usd, wages } from "./helpers";

/** MFJ couple, optionally with children, spouse wages and a small business. */
function couple(year: 0 | 1, profit: number, spouseWages: number, children = 0): CaseInput {
  const c = family();
  c.people = c.people.filter(p => p.role !== "dependent");
  for (let i = 0; i < children; i++) c.people.push({ id: `kid${i}`, role: "dependent", ageAt2026Start: 4 + i, qualifyingChildForCtc: true });
  for (const y of c.years) {
    y.taxFamilySize = c.people.length;
    y.coveredPersonIds = c.people.map(p => p.id);
    const owner = y.incomes.find(r => r.personId === "primary")!, spouse = y.incomes.find(r => r.personId === "spouse")!;
    owner.scheduleCProfit = fact(profit);
    for (const [k, v] of Object.entries(wages(spouseWages))) (spouse as unknown as Record<string, unknown>)[k] = fact(v);
    y.coverage.forEach(m => { m.sehiEligibilityConfirmed = false; });
  }
  setCoverage(c, year, usd(900), usd(900), 0);
  return c;
}

describe("rules r3 checked against IRS sources", () => {
  it("reproduces every row of the draft 2026 Tax Table with the Tax Table method; the draft rows use 2025 brackets", () => {
    // Finding: all 2,062 rows of the DRAFT table equal the method applied to 2025 brackets (Rev. Proc. 2024-40),
    // not the 2026 brackets (Rev. Proc. 2025-32). The method (bands, midpoint, whole-dollar rounding) is verified;
    // the engine keeps the final 2026 brackets and does not use the stale draft values.
    const r26 = rulesFor(2026);
    const implied = taxTable.impliedBrackets2025 as Record<"single" | "mfj", Array<[number, string]>>;
    const r25 = { ...r26, brackets: {
      single: implied.single.map(([top, x]) => ({ top: usd(top), rate: rate(x) })),
      mfj: implied.mfj.map(([top, x]) => ({ top: usd(top), rate: rate(x) })) } };
    const rows = taxTable.rows as number[][];
    const methodMismatch = rows.filter(([atLeast, lessThan, single, mfj]) =>
      [atLeast, lessThan - 1].some(ti => regularTax(r25, "single", usd(ti)) !== usd(single) || regularTax(r25, "mfj", usd(ti)) !== usd(mfj)));
    expect(rows).toHaveLength(2062);
    expect(methodMismatch).toEqual([]);
    // With the final 2026 brackets: $25,000–25,050 → single 1,240 + 12% × 12,625 = $2,755; MFJ 2,480 + 12% × 225 = $2,507.
    expect([regularTax(r26, "single", usd(25000)), regularTax(r26, "mfj", usd(25000))]).toEqual([usd(2755), usd(2507)]);
  });

  it("applies the QBI minimum after the taxable-income limit (Form 8995 (2026) line 17)", () => {
    // Taxable income before QBI $794 → the limit is $159, but active QBI of $1,394 ≥ $1,000 gives the $400 minimum.
    // The r2 engine capped the minimum at the limit ($159), overstating tax by $25.
    const y = evaluateYear(model(couple(0, usd(1500), usd(31600)), 0), NO_VARIATION);
    expect([y.taxableBeforeQbi, y.qbi, y.qbiBeforeMinimum, y.qbiDeduction, y.taxable, y.regularTax])
      .toEqual([usd(794), usd(1394), usd(159), usd(400), usd(394), usd(39)]);
  });

  it("calculates the 2027 refundable child tax credit ($1,800 per child, Rev. Proc. 2026-35 §3.05(2)) instead of refusing", () => {
    const y = evaluateYear(model(couple(1, usd(2000), usd(67000), 2), 1), NO_VARIATION);
    expect(y.refundableCtc).toBeGreaterThan(0);
    expect(y.refundableCtc).toBe(y.childCredits - y.nonrefundableCredit);   // below the 2 × $1,800 and 15% caps here
    expect(y.childCredits).toBe(usd(4600));
  });
});
