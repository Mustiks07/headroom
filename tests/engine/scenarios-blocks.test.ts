// Group 6: receipt/expense timing across two years. Group 7: structured blocks; current risk needs no next-year data.
// Group 8: uncertainty crossing an internal boundary; an ordinary positive project needs no intervention.
import { describe, expect, it } from "vitest";
import type { CaseInput, ComparisonResult, ReadyComparison } from "@/domain/contracts";
import { missingDataCase, ordinaryCase } from "@/fixtures/cases";
import { assessCurrentRisk, calculateComparison, calculationFingerprint } from "@/lib/engine";
import { evaluateYear } from "@/lib/engine/year";
import { modelAt } from "@/lib/engine/search";
import { family, model, setCoverage, setIncome, single, usd } from "./helpers";

function ready(r: ComparisonResult): ReadyComparison {
  if (r.status !== "ready") throw new Error(JSON.stringify(r));
  return r;
}
const kind = (r: ReadyComparison, k: string) => r.scenarios.find(s => s.kind === k);

describe("timing across tax years", () => {
  it("keeps expenses in their payment year when receipts are split", async () => {
    const c = family();
    c.opportunity.incrementalExpensesCents = usd(2000);
    const r = ready(await calculateComparison(c));
    const split = kind(r, "split_payment")!;
    expect(split.decisions.expenses).toEqual([{ year: 2026, amountCents: usd(2000) }]);
    const first = split.decisions.receipts.find(x => x.date.startsWith("2026"))!.amountCents;
    const decline = kind(r, "decline")!;
    // 2026 MAGI change reflects receipts minus the full expense, not a pro-rated expense.
    const m = model(c, 0);
    expect(split.years[0].magiCents).toBe(evaluateYear(m, { profitDelta: first - usd(2000), additionalSep: 0 }).credit.magi);
    expect(split.twoYearCashDeltaCents).toBe(split.years[0].spendableAfterSettlementCents + split.years[1].spendableAfterSettlementCents
      - decline.years[0].spendableAfterSettlementCents - decline.years[1].spendableAfterSettlementCents);
  });

  it("does not hide a 2027 credit loss when moving income into 2027", async () => {
    const c = setIncome(family(), 1, "primary", { scheduleCProfit: usd(124000) }); // 2027 already close to its line
    const r = ready(await calculateComparison(c));
    const split = kind(r, "split_payment");
    const naive = [evaluateYear(model(c, 0), { profitDelta: usd(4000), additionalSep: 0 }), evaluateYear(model(c, 1), { profitDelta: usd(8000), additionalSep: 0 })];
    expect(naive[1].credit.ptc.ptc).toBe(0);           // the prototype's 4,000/8,000 split would lose 2027's credit
    if (split) {
      expect(split.years[1].ptcCents).toBeGreaterThan(0);
      expect(split.years[0].spendableAfterSettlementCents + split.years[1].spendableAfterSettlementCents)
        .toBeGreaterThan(naive[0].spendable + naive[1].spendable);
    }
  });
});

describe("structured blocks", () => {
  it("asks for the unknown spouse wages instead of assuming zero, in both entry points", async () => {
    const risk = await assessCurrentRisk(missingDataCase);
    expect(risk.status).toBe("needs_data");
    if (risk.status !== "ready") expect(risk.fields.map(f => f.path)).toContain("years[0].incomes[1].w2Box1");
    const comp = await calculateComparison(missingDataCase);
    expect(comp.status).toBe("needs_data");
  });

  it("treats an omitted spouse income row as missing, not zero", async () => {
    const c = family();
    c.years[0].incomes = c.years[0].incomes.filter(r => r.personId !== "spouse");
    const r = await assessCurrentRisk(c);
    expect(r.status === "needs_data" && r.code).toBe("INCOME_ROW_MISSING");
  });

  it("rejects unsupported coverage, eligibility, state and scope explicitly", async () => {
    const partial = family(); partial.years[0].coverage[6].enrollmentPremium = { valueCents: 0, status: "confirmed", sourceId: "demo-input" };
    const mixed = family(); mixed.years[0].coverage[3].ptcEligibilityConfirmed = false;
    const ca = family(); ca.state = "CA";
    const scope = family(); scope.years[0].scopeConfirmed = null;
    const codes = await Promise.all([partial, mixed, ca, scope].map(async c => {
      const r = await assessCurrentRisk(c);
      return r.status === "ready" ? "ready" : `${r.status}:${r.code}`;
    }));
    expect(codes).toEqual(["unsupported:PARTIAL_YEAR_COVERAGE", "unsupported:PARTIAL_ELIGIBILITY", "unsupported:STATE_NOT_SUPPORTED", "needs_data:SCOPE_UNCONFIRMED"]);
  });

  it("assesses current risk without a project or next-year forecast, while the comparison asks for 2027", async () => {
    const c: CaseInput = family();
    c.opportunity.grossRevenueCents = 0;
    c.opportunity.title = "Current forecast";
    for (const row of c.years[1].incomes) row.scheduleCProfit = { valueCents: null, status: "unknown", sourceId: "demo-input" };
    const risk = await assessCurrentRisk(c);
    expect(risk.status).toBe("ready");
    if (risk.status === "ready") {
      expect(risk.risk.state).toBe("at_risk");
      expect(risk.risk.forecastMagiCents).toBe(9973056);
      expect(risk.risk.thresholdMagiCents).toBe(usd(106600));
      expect(risk.risk.subsidyCents).toBe(usd(13080));
      expect(risk.risk.advanceSettlementCents).toBe(usd(333));
      expect(risk.risk.additionalProfitHeadroomCents).toBe(usd(8127));
    }
    const comp = await calculateComparison(c);
    expect(comp.status === "needs_data" && comp.fields[0].path).toMatch(/^years\[1\]\.incomes/);
  });

  it("keeps subsidy risk available but refuses take-home results where EITC could apply", async () => {
    const c = setCoverage(setIncome(single(), 0, "primary", { scheduleCProfit: usd(20000) }), 0, usd(550), usd(550), usd(400));
    setIncome(c, 1, "primary", { scheduleCProfit: usd(20000) });
    const risk = await assessCurrentRisk(c);
    expect(risk.status).toBe("ready");
    if (risk.status === "ready") expect(risk.warnings.join(" ")).toMatch(/earned income tax credit/);
    const comp = await calculateComparison(c);
    expect(comp.status === "unsupported" && comp.code).toBe("EITC_POSSIBLE");
  });
});

describe("uncertainty and ordinary projects", () => {
  it("flags a declared range that crosses the 400% line and sizes a buffer for it", async () => {
    const c = family();
    c.years[0].incomes[0].scheduleCProfit = { valueCents: usd(115000), status: "estimated", sourceId: "demo-input", range: { lowCents: usd(105000), highCents: usd(128000) } };
    c.constraints.maxAdditionalSepCents = usd(20000);
    const risk = await assessCurrentRisk(c);
    expect(risk.status === "ready" && risk.risk.state).toBe("at_risk");
    if (risk.status === "ready") expect(risk.risk.headroomAssumptions.join(" ")).toMatch(/high end .* credit would be lost/);
    const r = ready(await calculateComparison(c));
    const min = kind(r, "sep_minimum")!, buf = kind(r, "sep_buffer")!;
    expect(min.stress.status).toBe("fails_within_range");      // the minimum keeps the credit only at the entered value
    expect(min.stress.checkedDescription).toMatch(/2026 premium tax credit is lost/);
    expect(buf.grossAdditionalRetirementCents).toBeGreaterThan(min.grossAdditionalRetirementCents);
    expect(buf.feasible).toBe(true);
    expect(buf.stress.status).toBe("within_declared_range");
    const high = modelAt(model(c, 0), 1000);
    const atHigh = (sep: number) => evaluateYear(high, { profitDelta: usd(12000), additionalSep: sep }).credit.ptc.ptc;
    expect(atHigh(buf.grossAdditionalRetirementCents)).toBeGreaterThan(0);
    expect(atHigh(buf.grossAdditionalRetirementCents - 100)).toBe(0);   // smallest such contribution
    expect(atHigh(min.grossAdditionalRetirementCents)).toBe(0);
  });

  it("recommends simply accepting an ordinary profitable project", async () => {
    const r = ready(await calculateComparison(ordinaryCase));
    expect(r.recommendedScenarioId).toBe("accept_now");
    expect(kind(r, "accept_now")!.twoYearCashDeltaCents).toBeGreaterThan(0);
    expect(r.scenarios.map(s => s.kind)).toEqual(["decline", "accept_now"]);
    expect(r.warnings.join(" ")).toMatch(/No special action is needed/);
  });

  it("is reproducible: same input → same fingerprint and numbers; any change → new fingerprint", async () => {
    const a = ready(await calculateComparison(family()));
    const b = ready(await calculateComparison(family()));
    expect(b).toEqual(a);
    expect(a.calculationFingerprint).toBe(await calculationFingerprint(family()));
    const changed = family(); changed.opportunity.grossRevenueCents += 100;
    expect(await calculationFingerprint(changed)).not.toBe(a.calculationFingerprint);
    expect(a.rulesVersion).toBe("us-federal-aca-2026-2027.r2");
  });
});
