// Group 3: each spouse's Social Security cap, cash inclusion and SEP limit.
// Group 4: negative / excess / existing SEP, and legal-but-over-budget contributions.
import { describe, expect, it } from "vitest";
import { calculateComparison } from "@/lib/engine";
import { EngineStop } from "@/lib/engine/model";
import { rulesFor } from "@/lib/engine/rules";
import { evaluateYear, scheduleSe } from "@/lib/engine/year";
import { NO_VARIATION } from "@/lib/engine/model";
import { family, single, model, setIncome, usd, wages } from "./helpers";

describe("Social Security wage base per individual", () => {
  it("does not let a spouse's wages reduce the owner's cap (prototype error)", () => {
    const r = rulesFor(2026);
    const own = scheduleSe(r, "primary", usd(150000), 0);
    expect(own.total).toBe(2119400);                   // $21,194 on a whole-dollar return (spec: 21,194.325 unrounded)
    const withOwnWages = scheduleSe(r, "primary", usd(150000), usd(100000));
    expect(withOwnWages.ssPart).toBe(usd(10478));       // (184,500 − 100,000) × 12.4%: own room only
  });

  it("includes spouse wages in cash, FICA and MAGI but not in the owner's SE cap or SEP base", () => {
    const c = setIncome(family(), 0, "primary", { scheduleCProfit: usd(150000) });
    setIncome(c, 0, "spouse", wages(usd(80000)));
    const m = model(c);
    const y = evaluateYear(m, NO_VARIATION);
    expect(y.credit.seTotal).toBe(2119400);
    expect(y.employeeFica).toBe(usd(6120));            // 80,000 × 7.65%
    expect(y.credit.sepMax).toBe(Math.floor((usd(150000) - y.credit.ownerHalfSe) * 0.2 / 100) * 100);
    expect(y.credit.magi).toBe(usd(150000) + usd(80000) - y.credit.ownerHalfSe - y.credit.sehi);
    expect(y.credit.ptc.ptc).toBe(0);                  // far above 400%
    // Cash identity: wages and profit counted once; premiums net of the final credit (no second APTC deduction).
    expect(y.spendable).toBe(usd(150000) + usd(80000) - y.employeeFica - y.credit.seTotal - y.federalIncomeTax - (usd(23013) - y.credit.ptc.ptc));
  });
});

describe("SEP contribution limits", () => {
  const m = model(family());
  it("rejects negative and excess contributions", () => {
    expect(() => evaluateYear(m, { profitDelta: 0, additionalSep: -1 })).toThrow(EngineStop);
    const max = evaluateYear(m, NO_VARIATION).credit.sepMax;
    expect(() => evaluateYear(m, { profitDelta: 0, additionalSep: max })).not.toThrow();
    expect(() => evaluateYear(m, { profitDelta: 0, additionalSep: max + 1 })).toThrow(/exceed/);
  });

  it("counts an existing contribution against the limit and blocks a baseline already over it", async () => {
    const c = setIncome(family(), 0, "primary", { existingSepContribution: usd(30000) });
    const r = await calculateComparison(c);
    expect(r.status).toBe("needs_data");
    if (r.status !== "ready") expect(r.code).toBe("SEP_OVER_LIMIT");
  });

  it("marks a legal but over-budget SEP as infeasible instead of recommending it", async () => {
    const c = family();
    c.constraints.maxAdditionalSepCents = usd(2000);
    const r = await calculateComparison(c);
    expect(r.status).toBe("ready");
    if (r.status !== "ready") return;
    const sep = r.scenarios.find(s => s.kind === "sep_minimum")!;
    expect(sep.feasible).toBe(false);
    expect(sep.infeasibilityReasons.join(" ")).toMatch(/above your maximum/);
    expect(r.recommendedScenarioId).not.toBe("sep_minimum");
  });
});

it("uses the 2027 indexed QBI minimum only above the 2027 qualifying amount", () => {
  // IRS Rev. Proc. 2026-35 section 3.28(2): $1,030 qualifying QBI, $415 minimum deduction.
  // Wages keep the full return above the EITC support guard; no SEHI deduction in this case.
  const c = setIncome(single(), 1, "primary", { ...wages(usd(80000)), scheduleCProfit: usd(1100) });
  c.years[1].coverage.forEach(month => { month.sehiEligibilityConfirmed = false; });
  const below = evaluateYear(model(c, 1), NO_VARIATION);
  expect(below.qbi).toBeLessThan(usd(1030));
  expect(below.qbiDeduction).toBe(usd(204));          // 20% of $1,022 QBI on a whole-dollar return
  setIncome(c, 1, "primary", { scheduleCProfit: usd(2000) });
  const above = evaluateYear(model(c, 1), NO_VARIATION);
  expect(above.qbiDeduction).toBe(usd(415));
});

it("does not certify ignored insurance ranges or mixed-direction retirement ranges", async () => {
  for (const field of ["existingSepContribution", "coverage"] as const) {
    const c = family();
    const fact = field === "coverage" ? c.years[0].coverage[0].enrollmentPremium : c.years[0].incomes[0][field];
    fact.range = { lowCents: fact.valueCents!, highCents: fact.valueCents! + usd(2000) };
    const result = await calculateComparison(c);
    expect(result.status).toBe("needs_data");
    if (result.status !== "ready") expect(result.code).toBe("RANGE_NOT_SUPPORTED");
  }
});
