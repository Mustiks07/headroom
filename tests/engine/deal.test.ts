// Round 4: deal-term search on the shared contract. Bounded checks: constraints of every returned option,
// one independent cross-check against the household evaluator, dated cash without double counting,
// infeasible goals with a relaxation that really works, incomplete cash, and sensitivity thresholds.
import { describe, expect, it } from "vitest";
import type { CashContext, DealSearchResult, DealVariant, ReadyDealSearch } from "@/domain/deal-planning";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { dealCashFixture, dealGoalFixture, dealTermsFixture, dealWorkspaceFixture } from "@/fixtures/deal-planning";
import { evaluateDecisionSensitivity, evaluateHouseholdWorkspace, searchDealTerms } from "@/lib/engine";
import { annual, completeCash, deal, dealWorkspace, line, T } from "./deal-fixture";
import { usd } from "./helpers";

type D = ReturnType<typeof deal>;
const search = (ws: HouseholdWorkspace, d: D, cash: CashContext | null = null) => searchDealTerms(ws, d.goal, d.space, cash);
function ready(r: DealSearchResult): ReadyDealSearch {
  if (r.status !== "ready") throw new Error(`expected ready, got ${JSON.stringify(r).slice(0, 600)}`);
  return r;
}
const v = (r: ReadyDealSearch, purpose: DealVariant["purpose"]) => r.variants.find(x => x.purpose === purpose)!;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Contract invariants every returned option must satisfy. */
function checkVariants(r: ReadyDealSearch, d: D, received: number) {
  expect(r.variants.length).toBeGreaterThan(0);
  expect(r.variants.length).toBeLessThanOrEqual(3);
  expect(r.variants.some(x => x.id === r.recommendedVariantId)).toBe(true);
  const best = Math.max(...r.variants.map(x => x.twoYearCashDeltaCents));
  for (const x of r.variants) {
    expect(x.verifiedExact).toBe(true);
    expect(x.constraints.every(c => c.satisfied)).toBe(true);
    expect(x.twoYearCashDeltaCents).toBeGreaterThanOrEqual(d.goal.minimumTwoYearCashDeltaCents);
    expect(x.differenceFromBestCents).toBe(best - x.twoYearCashDeltaCents);
    expect(sum(x.terms.payments.map(p => p.amountCents))).toBe(x.terms.priceCents - received);           // received money is fixed
    expect(x.terms.payments.length).toBeLessThanOrEqual(d.space.maxPayments);
    expect(x.terms.additionalSep?.amountCents ?? 0).toBeLessThanOrEqual(d.goal.maxAdditionalSepCents ?? Infinity);
    if (x.purpose !== "as_offered") {
      expect(x.terms.priceCents).toBeGreaterThanOrEqual(d.space.price.minCents);
      expect(x.terms.priceCents).toBeLessThanOrEqual(d.space.price.maxCents);
      for (const p of x.terms.payments) expect(d.space.paymentWindows.some(w => p.date >= w.earliest && p.date <= w.latest)).toBe(true);
    }
    // Dated layout: every non-fixed project flow, SEP and settlement add up to the two-year cash change.
    expect(sum(x.datedFlows.filter(f => f.basis !== "fixed").map(f => f.amountCents))).toBe(x.twoYearCashDeltaCents);
    for (const t of x.dateTargets) expect(t.met).not.toBe(false);
  }
}

/** The variant written into the workspace as agreed terms (independent path: household evaluator, no search code). */
function agreedWith(ws: HouseholdWorkspace, projectId: string, x: DealVariant): HouseholdWorkspace {
  const out = structuredClone(ws);
  const pr = out.projects.find(p => p.id === projectId)!;
  pr.status = "agreed";
  pr.receipts = [...pr.receipts.filter(l => l.actual), ...x.terms.payments.map(p => line(`n-${p.id}`, p.amountCents / 100, p.date))];
  if (x.terms.additionalSep) {
    const t = out.retirement.targets.find(q => q.year === x.terms.additionalSep!.year);
    if (t) t.targetCents += x.terms.additionalSep.amountCents;
    else out.retirement.targets.push({ id: "extra", personId: "primary", year: x.terms.additionalSep.year, targetCents: x.terms.additionalSep.amountCents, acceptedAt: T, origin: { projectId: null, scenarioKind: null, fingerprint: null } });
  }
  return out;
}
async function householdYears(ws: HouseholdWorkspace) {
  const e = await evaluateHouseholdWorkspace(ws);
  if (e.status !== "ready") throw new Error(JSON.stringify(e));
  return e.fixedPlan.years.map(y => y.result!);
}

describe("deal search: achievable goal with an agreed deposit (A) and an offer (B)", () => {
  it("returns up to three exact options that satisfy every constraint; simpler terms are recommended only within the threshold", async () => {
    const d = deal();
    const r = ready(await search(dealWorkspace(), d));
    checkVariants(r, d, 0);
    expect(r.simplerVariantThresholdCents).toBe(usd(120));                              // max($100, 1% of the $12,000 offer)
    const simplest = v(r, "simplest"), most = v(r, "most_cash");
    expect(most.twoYearCashDeltaCents).toBeGreaterThan(simplest.twoYearCashDeltaCents + r.simplerVariantThresholdCents);
    expect(r.recommendedVariantId).toBe(most.id);
    expect(r.baseline.kind).toBe("decline_unpaid_terms");
    expect(r.cashCompleteness).toBe("project_only");
  });

  it("matches the household evaluator when the chosen terms are written in as agreed (cash, MAGI, credit)", async () => {
    const ws = dealWorkspace(), d = deal();
    const r = ready(await search(ws, d));
    const declined = structuredClone(ws);
    declined.projects = declined.projects.filter(p => p.id !== "B");
    const base = await householdYears(declined);
    for (const x of r.variants) {
      const yrs = await householdYears(agreedWith(ws, "B", x));
      expect(yrs.map(y => [y.magiCents, y.ptcCents])).toEqual(x.aca.map(a => [a.magiCents, a.ptcCents]));
      expect(sum(yrs.map(y => y.spendableAfterSettlementCents)) - sum(base.map(y => y.spendableAfterSettlementCents))).toBe(x.twoYearCashDeltaCents);
    }
  });

  it("different date targets give different terms", async () => {
    const byJan = ready(await search(dealWorkspace(), deal()));
    const decCash = deal({ targets: [{ id: "dec31", kind: "project_available_cash", byDate: "2026-12-31", minimumCents: usd(5000) }] });
    const byDec = ready(await search(dealWorkspace(), decCash));
    checkVariants(byDec, decCash, 0);
    expect(v(byJan, "simplest").terms.payments.every(p => p.date >= "2027-01-01")).toBe(true);    // all in January is simplest
    expect(v(byDec, "simplest").terms.payments.some(p => p.date <= "2026-12-31")).toBe(true);     // cash by Dec 31 needs a December payment
    for (const x of byDec.variants) expect(x.dateTargets[0].achievedCents!).toBeGreaterThanOrEqual(usd(5000));
  });

  it("parameterized: invariants hold at other profits and step sizes", async () => {
    for (const [profit, step] of [[100000, 100], [109000, 500], [118000, 250]] as const) {
      const d = deal({ step, minCash: 2000 });
      const r = await search(dealWorkspace(profit), d);
      if (r.status === "ready") checkVariants(r, d, 0);
      else expect(r.status).toBe("no_feasible_terms");
    }
  });
});

describe("deal search: limits and explanations", () => {
  it("an unreachable goal names the violated constraint; the price relaxation really works and is not an offer", async () => {
    const d = deal({ minCash: 12000, maxPrice: 13000 });
    const r = await search(dealWorkspace(), d);
    expect(r.status).toBe("no_feasible_terms");
    if (r.status !== "no_feasible_terms") return;
    expect(r.violated.map(x => x.id)).toContain("minimum_cash");
    const price = r.relaxations.find(x => x.constraint === "price_max")!;
    expect(price.requiredCents!).toBeGreaterThan(usd(13000));
    expect(price.explanation).toMatch(/not a price the client accepted/);
    const relaxed = deal({ minCash: 12000, maxPrice: price.requiredCents! / 100 });
    expect(ready(await search(dealWorkspace(), relaxed)).variants.length).toBeGreaterThan(0);
    const below = deal({ minCash: 12000, maxPrice: price.requiredCents! / 100 - 250 });
    expect((await search(dealWorkspace(), below)).status).toBe("no_feasible_terms");      // checked at the $250 step
  });

  it("unknown willingness to renegotiate: only the offered terms are evaluated", async () => {
    const d = deal({ newTerms: null, minCash: -5000 });
    const r = ready(await search(dealWorkspace(), d));
    expect(r.search.exhaustiveWithinSpace).toBe(true);
    for (const x of r.variants) expect(x.terms.payments.map(p => [p.date, p.amountCents])).toEqual([["2026-12-20", usd(12000)]]);
    const off = ready(await search(dealWorkspace(), deal({ newTerms: null, minCash: -5000, baseline: "accept_as_offered", allowSep: false })));
    expect(off.variants.map(x => [x.purpose, x.twoYearCashDeltaCents])).toEqual([["as_offered", 0]]);
  });

  it("incomplete cash context: project figures stay, the household balance is not promised", async () => {
    const d = deal({ targets: [{ id: "hb", kind: "household_balance", byDate: "2027-01-10", minimumCents: usd(10000) }] });
    const shortCash = { ...completeCash(), completeness: { confirmed: true, from: "2026-11-20", through: "2026-12-31" } };
    for (const cash of [null, shortCash]) {
      const r = ready(await search(dealWorkspace(), d, cash));
      expect(r.cashCompleteness).toBe("household_incomplete");
      for (const x of r.variants) expect(x.dateTargets[0]).toMatchObject({ achievedCents: null, met: null });
    }
  });

  it("household balance: hand layout, facts in the snapshot counted once, SEP paid after it counted once", async () => {
    const d = deal({ minCash: 0, targets: [{ id: "hb", kind: "household_balance", byDate: "2027-01-10", minimumCents: 0 }] });
    const r = ready(await search(dealWorkspace(), d, completeCash()));
    expect(r.cashCompleteness).toBe("household_complete");
    const s = v(r, "simplest");                                   // $12,000 on 2027-01-04 (+ $33 SEP for 2027, paid in 2028)
    const reserve = -sum(s.datedFlows.filter(f => f.kind === "tax_settlement").map(f => f.amountCents));
    // $20,000 snapshot (a1 already in it) − rent $3,000 × 2 + A's a2 $3,000 + B $12,000 − tax reserve − $5,000 kept untouched
    expect(s.dateTargets[0].achievedCents).toBe(usd(20000 - 6000 + 3000 + 12000 - 5000) - reserve);

    const at = (cash: CashContext, ws = dealWorkspace()) => search(ws, { ...d, goal: { ...d.goal, dateTargets: [{ id: "hb", kind: "household_balance", byDate: "2027-04-30", minimumCents: 0 }] } }, cash)
      .then(x => v(ready(x), "most_cash").dateTargets[0].achievedCents!);
    const early = { ...completeCash(), snapshot: { date: "2026-09-30", balanceCents: usd(20000), sourceId: "demo-input" }, completeness: { confirmed: true, from: "2026-09-30", through: "2027-04-30" } };
    expect(await at({ ...early, includedFactIds: [] }) - await at({ ...early, includedFactIds: ["a1"] })).toBe(usd(3000));  // a1 after the snapshot: added once

    const paid = dealWorkspace();
    paid.retirement.contributions = [{ id: "sep-p", personId: "primary", taxYear: 2026, amountCents: usd(400), paidDate: "2026-11-20", sourceId: "demo-input", recordedAt: T }];
    expect(await at(early, paid)).toBe(await at(early));               // $400 paid + $600 still due = the $1,000 goal, never $1,400
    const ev = await evaluateHouseholdWorkspace(paid);
    expect(ev.status === "ready" && ev.futureContributionBudgetRemainingCents).toBe(usd(1500)); // no free SEP money
    for (const x of ready(await search(paid, deal({ maxSep: null }))).variants) expect(x.terms.additionalSep?.amountCents ?? 0).toBeLessThanOrEqual(usd(1500));
  });

  it("searching an agreed project keeps its received deposit and does not change the workspace", async () => {
    const ws = dealWorkspace(), before = structuredClone(ws);
    const d = deal({ projectId: "A", minPrice: 6000, maxPrice: 7500, minCash: 0, targets: [] });
    const r = ready(await search(ws, d));
    checkVariants(r, d, usd(3000));
    for (const x of r.variants) expect(x.datedFlows.filter(f => f.basis === "fixed")).toEqual([expect.objectContaining({ date: "2026-10-02", amountCents: usd(3000) })]);
    expect(ws).toEqual(before);
  });
});

describe("decision sensitivity", () => {
  it("the exact credit threshold holds on both sides in the household evaluator; stale terms are refused", async () => {
    const ws = dealWorkspace(), d = deal();
    const r = ready(await search(ws, d));
    const most = v(r, "most_cash");
    const s = await evaluateDecisionSensitivity(ws, d.goal, most, r.searchFingerprint);
    if (s.status !== "ready") throw new Error(JSON.stringify(s));
    const item = s.items.find(i => i.id === "credit-2026")!;
    expect(item).toMatchObject({ checked: "exact_threshold", currentCents: usd(112000), direction: "increase" });
    const at = async (profitCents: number) => {
      const w = agreedWith(ws, "B", most);
      w.forecasts[0] = annual("primary", 2026, profitCents / 100);
      return (await householdYears(w))[0].ptcCents;
    };
    expect(await at(item.thresholdCents! - 100)).toBeGreaterThan(0);
    expect(await at(item.thresholdCents!)).toBe(0);
    expect(s.items.some(i => i.id === "december-payment")).toBe(true);

    const stale = await evaluateDecisionSensitivity(ws, d.goal, { ...most, terms: { ...most.terms, priceCents: most.terms.priceCents + usd(1) } }, r.searchFingerprint);
    expect(stale).toMatchObject({ status: "needs_data", code: "STALE_VARIANT" });
  });

  it("runs on the shared contract fixture", async () => {
    const r = await searchDealTerms(dealWorkspaceFixture, dealGoalFixture, dealTermsFixture, dealCashFixture);
    expect(["ready", "no_feasible_terms"]).toContain(r.status);
    if (r.status === "ready") {
      const s = await evaluateDecisionSensitivity(dealWorkspaceFixture, dealGoalFixture, r.variants[0], r.searchFingerprint);
      expect(s.status).toBe("ready");
    }
  });
});
