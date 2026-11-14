// Fixed (agreed) decisions after a change, independent ranges, and exact counteroffer minimality.
import { describe, expect, it } from "vitest";
import type { ComparisonResult, ReadyComparison } from "@/domain/contracts";
import { calculateComparison, evaluateAgreedPlan } from "@/lib/engine";
import { evaluateYear } from "@/lib/engine/year";
import { family, model, setIncome, usd } from "./helpers";

function ready(r: ComparisonResult): ReadyComparison {
  if (r.status !== "ready") throw new Error(JSON.stringify(r));
  return r;
}

describe("agreed plan after income changes", async () => {
  const before = ready(await calculateComparison(family()));
  it("rejects damaged agreed years, dates and receipt totals without calculating them", async () => {
    const original = before.scenarios.find(s => s.kind === "split_payment")!;
    const wrongYear = structuredClone(original);
    wrongYear.decisions.expenses = [{ year: 2028 as 2026, amountCents: 100 }];
    const wrongDate = structuredClone(original);
    wrongDate.decisions.receipts[0].date = "2026-02-30";
    const wrongTotal = structuredClone(original);
    wrongTotal.decisions.grossRevenueCents += 100;
    for (const invalid of [wrongYear, wrongDate, wrongTotal])
      expect(await evaluateAgreedPlan(family(), invalid)).toMatchObject({ status: "needs_data", code: "INVALID_AGREED_PLAN" });
  });
  const split = before.scenarios.find(s => s.kind === "split_payment")!;
  const sep = before.scenarios.find(s => s.kind === "sep_minimum")!;

  it("keeps the agreed split exactly, shows what changed, and leaves new options to the comparison", async () => {
    const changed = setIncome(family(), 0, "primary", { scheduleCProfit: usd(121000) });
    const r = await evaluateAgreedPlan(changed, { kind: split.kind, label: split.label, decisions: split.decisions }, split);
    if (r.status !== "ready") throw new Error(JSON.stringify(r));
    expect(r.agreed!.decisions.receipts).toEqual(split.decisions.receipts);       // not re-optimized
    expect(r.agreed!.kind).toBe("split_payment");
    expect(r.creditLostYears).toEqual([2026]);                                  // $3,000 more profit crosses the 400% line
    expect(r.changes.find(c => c.item === "premium_tax_credit" && c.year === 2026)).toMatchObject({ previousCents: split.years[0].ptcCents, currentCents: 0 });
    expect(r.warnings.join(" ")).toMatch(/loses the 2026 premium tax credit/);
    const fresh = ready(await calculateComparison(changed)).scenarios.find(s => s.kind === "split_payment")!;
    expect(fresh.decisions.receipts[0].amountCents).toBeLessThan(split.decisions.receipts[0].amountCents);
    expect(fresh.years[0].ptcCents).toBeGreaterThan(0);
  });

  it("explains when agreed actions are no longer allowed or possible", async () => {
    const strict = family();
    strict.constraints.maxAdditionalSepCents = usd(2000);
    strict.constraints.canSplitPayment = false;
    const a = await evaluateAgreedPlan(strict, { kind: sep.kind, decisions: sep.decisions });
    const b = await evaluateAgreedPlan(strict, { kind: split.kind, decisions: split.decisions });
    if (a.status !== "ready" || b.status !== "ready") throw new Error("blocked");
    expect(a.stillFeasible).toBe(false);
    expect(a.reasons.join(" ")).toMatch(/above your current maximum/);
    expect(b.stillFeasible).toBe(false);
    expect(b.reasons.join(" ")).toMatch(/cannot be split/);

    // Another $21,000 already planned: the agreed extra contribution no longer fits the legal limit.
    const funded = setIncome(family(), 0, "primary", { existingSepContribution: usd(21000) });
    const c = await evaluateAgreedPlan(funded, { kind: sep.kind, decisions: sep.decisions });
    if (c.status !== "ready") throw new Error("blocked");
    expect(c.agreed).toBeNull();
    expect(c.reasons.join(" ")).toMatch(/limit/);
  });
});

describe("independent ranges and counteroffer", () => {
  it("checks every combination of range ends when profit and interest ranges are independent", async () => {
    const c = family();
    c.years[0].incomes[0].scheduleCProfit = { valueCents: usd(115000), status: "estimated", sourceId: "demo-input", range: { lowCents: usd(105000), highCents: usd(128000) } };
    c.years[0].incomes[1].taxableInterest = { valueCents: usd(500), status: "estimated", sourceId: "demo-input", range: { lowCents: 0, highCents: usd(1500) } };
    c.constraints.maxAdditionalSepCents = usd(20000);
    const r = ready(await calculateComparison(c));
    const accept = r.scenarios.find(s => s.kind === "accept_now")!;
    expect(accept.stress.checkedDescription).toMatch(/every combination of range ends \(4\)/);
    expect(accept.stress.checkedDescription).toMatch(/not a proven minimum/);
    const buffer = r.scenarios.find(s => s.kind === "sep_buffer")!;
    expect(buffer.stress.status).toBe("within_declared_range");
  });

  it("returns the exact lowest whole-dollar counteroffer", async () => {
    const r = ready(await calculateComparison(family()));
    const offer = r.scenarios.find(s => s.kind === "renegotiate")!;
    const price = offer.decisions.grossRevenueCents;
    const m0 = model(family(), 0), m1 = model(family(), 1);
    const decline = evaluateYear(m0, { profitDelta: 0, additionalSep: 0 }).spendable;
    const at = (p: number) => evaluateYear(m0, { profitDelta: p, additionalSep: 0 }).spendable - decline;
    expect(at(price)).toBeGreaterThanOrEqual(0);
    expect(at(price - 100)).toBeLessThan(0);
    void m1;
  });
});
