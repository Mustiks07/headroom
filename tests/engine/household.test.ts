// Round 3 counterexamples: one check per class of mistake in combining a household's commitments.
import { describe, expect, it } from "vitest";
import type { MoneyFact } from "@/domain/contracts";
import { familyCase } from "@/fixtures/cases";
import { buildHouseholdProjection, calculateComparison, compareWorkspaceOpportunity, evaluateHouseholdWorkspace, householdFingerprint,
  type HouseholdEngineInput, type Project, type ProjectItem } from "@/lib/engine";
import { fact, usd } from "./helpers";

const unknown: MoneyFact = { valueCents: null, status: "unknown", sourceId: "demo-input" };
const annual = (year: 2026 | 2027, dollars: number, projectsExcluded: boolean | null = true) =>
  ({ method: "annual_total" as const, personId: "primary", year, netProfit: fact(usd(dollars)), projectsExcluded });
const receipt = (id: string, dollars: number, date: string, actual: [number, string] | null = null, cancelled = false): ProjectItem =>
  ({ id, kind: "receipt", expected: { amountCents: usd(dollars), date }, cancelled, sourceId: "demo-input",
    actual: actual ? { amountCents: usd(actual[0]), date: actual[1], sourceId: "demo-input" } : null });
const project = (id: string, status: Project["status"], items: ProjectItem[]): Project => ({ id, ownerPersonId: "primary", title: `Project ${id}`, status, items });

/** The synthetic family as a household plan: profit comes only from forecasts and projects. */
function workspace(profit2026 = 118000, profit2027 = 118000): HouseholdEngineInput {
  const household = structuredClone(familyCase);
  for (const y of household.years) {
    const owner = y.incomes.find(r => r.personId === "primary")!;
    owner.scheduleCProfit = unknown;
    owner.existingSepContribution = fact(0);
  }
  household.opportunity.grossRevenueCents = 0;
  return { engineInputVersion: "household-engine-1", household, forecasts: [annual(2026, profit2026), annual(2027, profit2027)],
    projects: [], sepContributions: [], sepTargets: [], futureSepBudgetCents: null };
}
const B = () => project("B", "proposed", [receipt("b1", 12000, "2026-12-20")]);
async function ready<T extends { status: string }>(p: Promise<T>): Promise<Extract<T, { status: "ready" }>> {
  const r = await p;
  if (r.status !== "ready") throw new Error(JSON.stringify(r));
  return r as Extract<T, { status: "ready" }>;
}

describe("household projection", () => {
  it("keeps round 2 results when the same offer is evaluated in a household plan", async () => {
    const ws = workspace();
    ws.projects = [B()];
    const v1 = await ready(calculateComparison(familyCase));
    const v3 = await ready(compareWorkspaceOpportunity(ws, "B"));
    expect(v3.comparison.scenarios.map(s => [s.kind, s.label, s.twoYearCashDeltaCents, s.grossAdditionalRetirementCents]))
      .toEqual(v1.scenarios.map(s => [s.kind, s.label, s.twoYearCashDeltaCents, s.grossAdditionalRetirementCents]));
    expect(v3.comparison.recommendedScenarioId).toBe(v1.recommendedScenarioId);
    expect(v1.scenarios.find(s => s.kind === "split_payment")!.twoYearCashDeltaCents).toBe(usd(8315));
  });

  it("evaluates B on top of agreed A without counting either twice; declining B keeps A", async () => {
    const ws = workspace();
    ws.projects = [project("A", "agreed", [receipt("a1", 6000, "2026-11-20")]), project("B", "proposed", [receipt("b1", 3000, "2026-12-28")])];
    const current = await ready(buildHouseholdProjection(ws));
    expect(current.projection.years[0].profitCents).toBe(usd(124000));                 // forecast + A only
    const r = await ready(compareWorkspaceOpportunity(ws, "B"));
    expect(r.baseline.years[0].profitCents).toBe(usd(124000));
    const accept = r.comparison.scenarios.find(s => s.kind === "accept_now")!;
    expect(accept.decisions.receipts).toEqual([{ date: "2026-12-28", amountCents: usd(3000) }]);   // only B is added
    const decline = r.comparison.scenarios.find(s => s.kind === "decline")!;
    expect(decline.years[0].magiCents).toBe(r.fixedPlan!.years[0].result!.magiCents);             // declining B = plan with A
    expect(decline.years[0].trace.find(t => t.id === "2026.profit_source.total")!.amountCents).toBe(usd(124000));
    // Editing A: the old A leaves the baseline first, then the new terms are evaluated once.
    const editA = await ready(compareWorkspaceOpportunity(ws, "A"));
    expect(editA.baseline.years[0].profitCents).toBe(usd(118000));
  });

  it("uses an actual payment instead of the expected one, and keeps received money after cancellation", async () => {
    const ws = workspace();
    ws.projects = [project("A", "agreed", [receipt("a1", 12000, "2026-12-20", [11500, "2026-12-18"])])];
    const p = await ready(buildHouseholdProjection(ws));
    expect(p.projection.years[0].profitCents).toBe(usd(129500));
    expect(p.projection.years[0].components.filter(c => c.projectId === "A").map(c => [c.basis, c.cents])).toEqual([["actual", usd(11500)]]);

    ws.projects = [project("A", "cancelled", [receipt("a1", 4000, "2026-11-01", [4000, "2026-11-03"]), receipt("a2", 8000, "2026-12-20")])];
    const cancelled = await ready(buildHouseholdProjection(ws));
    expect(cancelled.projection.years[0].profitCents).toBe(usd(122000));
  });

  it("does not move or re-price a payment that was already received", async () => {
    const ws = workspace();
    ws.projects = [project("A", "agreed", [receipt("a1", 4000, "2026-12-01", [4000, "2026-12-01"]), receipt("a2", 8000, "2026-12-20")])];
    const r = await ready(compareWorkspaceOpportunity(ws, "A"));
    expect(r.baseline.years[0].profitCents).toBe(usd(122000));
    for (const s of r.comparison.scenarios.filter(s => s.kind !== "decline" && s.kind !== "renegotiate")) {
      expect(s.decisions.receipts.reduce((a, x) => a + x.amountCents, 0)).toBe(usd(8000));
    }
  });

  it("combines year-to-date and the rest of the year with signed ranges", async () => {
    const ws = workspace();
    const est = (d: number, lo: number, hi: number): MoneyFact => ({ valueCents: usd(d), status: "estimated", sourceId: "demo-input", range: { lowCents: usd(lo), highCents: usd(hi) } });
    ws.forecasts[0] = { method: "year_to_date_plus_remaining", personId: "primary", year: 2026, asOfDate: "2026-10-31", projectsExcluded: true,
      ytdNetProfit: est(80000, 78000, 82000), remainingReceipts: est(30000, 25000, 35000), remainingExpenses: est(5000, 4000, 7000) };
    const y = (await ready(buildHouseholdProjection(ws))).projection.years[0];
    expect([y.profitCents, y.lowCents, y.highCents]).toEqual([usd(105000), usd(96000), usd(113000)]);

    // An agreed payment expected before the as-of date needs its actual status first.
    ws.projects = [project("A", "agreed", [receipt("a1", 5000, "2026-10-15")])];
    const blocked = await buildHouseholdProjection(ws);
    expect(blocked.status === "needs_data" && blocked.code).toBe("PAYMENT_STATUS_UNKNOWN");
  });

  it("refuses ambiguous or duplicated sources instead of guessing", async () => {
    const ws = workspace();
    ws.forecasts[0] = annual(2026, 130000, null);
    ws.projects = [project("A", "agreed", [receipt("a1", 12000, "2026-12-20")])];
    const notConfirmed = await buildHouseholdProjection(ws);
    expect(notConfirmed.status === "needs_data" && notConfirmed.code).toBe("PROJECT_INCLUSION_UNCONFIRMED");
    const two = workspace();
    two.forecasts.push({ ...annual(2026, 90000), netProfit: unknown });
    const conflict = await buildHouseholdProjection(two);
    expect(conflict.status === "needs_data" && conflict.fields.map(f => f.reason).join(" ")).toMatch(/never added together/);
  });
});

describe("shared SEP-IRA target", () => {
  it("tracks paid vs target, never double counts a contribution and never refunds a paid one", async () => {
    const ws = workspace();
    const paid = { id: "sep-1", personId: "primary", taxYear: 2026 as const, amountCents: usd(2000), paidDate: "2026-12-30", sourceId: "demo-input" };
    ws.sepContributions = [paid, { ...paid }];                       // the same record imported twice
    ws.sepTargets = [{ personId: "primary", taxYear: 2026, targetCents: usd(3600) }];
    ws.futureSepBudgetCents = usd(1000);
    const r = await ready(evaluateHouseholdWorkspace(ws));
    expect(r.projection.years[0].sep).toMatchObject({ paidCents: usd(2000), plannedTotalCents: usd(3600), remainingCents: usd(1600) });
    expect(r.fixedPlan.feasible).toBe(false);                         // $1,600 still to pay, only $1,000 set aside
    expect(r.fixedPlan.reasons.join(" ")).toMatch(/exceed the money set aside/);

    ws.sepTargets = [{ personId: "primary", taxYear: 2026, targetCents: usd(1000) }];
    ws.sepContributions = [paid, { ...paid, id: "sep-2", amountCents: usd(500), paidDate: "2027-02-01" }];
    const lowered = await ready(evaluateHouseholdWorkspace(ws));
    expect(lowered.projection.years[0].sep).toMatchObject({ paidCents: usd(2500), plannedTotalCents: usd(2500), remainingCents: 0 });
    expect(lowered.warnings.join(" ")).toMatch(/paid amount stays/);
    expect(lowered.fixedPlan.feasible).toBe(true);
    const y = lowered.fixedPlan.years[0].result!;
    expect(y.trace.find(t => t.id === "2026.sep")!.amountCents).toBe(usd(2500));
  });

  it("reports an agreed target that the current profit no longer allows instead of changing it", async () => {
    const ws = workspace(60000, 118000);
    ws.household.years[0].incomes[1] = { ...ws.household.years[0].incomes[1], ...Object.fromEntries(
      (["w2Box1", "socialSecurityWages", "medicareWages", "grossWages"] as const).map(k => [k, fact(usd(40000))])) };
    ws.sepTargets = [{ personId: "primary", taxYear: 2026, targetCents: usd(15000) }];
    ws.futureSepBudgetCents = usd(20000);
    const r = await ready(evaluateHouseholdWorkspace(ws));
    expect(r.fixedPlan.feasible).toBe(false);
    expect(r.fixedPlan.years[0].result).toBeNull();
    expect(r.fixedPlan.reasons.join(" ")).toMatch(/no longer allowed/);
  });
});

describe("agreed plan after a new income figure", () => {
  it("shows the old split losing the 2026 credit while a new proposal can keep it", async () => {
    const split = project("A", "agreed", [receipt("a1", 8093, "2026-12-20"), receipt("a2", 3907, "2027-01-04")]);
    const before = workspace();
    before.projects = [split];
    const ok = await ready(evaluateHouseholdWorkspace(before));
    expect(ok.fixedPlan.years[0].risk!.ptcCents).toBeGreaterThan(0);
    const after = workspace(121000);
    after.projects = [split];
    const changed = await ready(evaluateHouseholdWorkspace(after));
    expect(changed.fixedPlan.years[0].risk!.state).toBe("over_cliff");               // agreed amounts kept, credit lost
    const fresh = await ready(compareWorkspaceOpportunity(after, "A"));
    expect(fresh.comparison.scenarios.some(s => s.feasible && s.years[0].ptcCents > 0 && s.kind !== "decline")).toBe(true);
  });

  it("fingerprints the meaning, not the order of records", async () => {
    const a = workspace();
    a.projects = [project("A", "agreed", [receipt("a1", 6000, "2026-11-20")]), B()];
    const b = structuredClone(a);
    b.projects.reverse();
    expect(await householdFingerprint(b)).toBe(await householdFingerprint(a));
    b.projects[0].items[0].expected!.amountCents += 100;
    expect(await householdFingerprint(b)).not.toBe(await householdFingerprint(a));
  });
});
