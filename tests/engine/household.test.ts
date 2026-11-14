// Round 3 counterexamples on the shared HouseholdWorkspace contract: one check per class of mistake.
import { describe, expect, it } from "vitest";
import type { MoneyFact } from "@/domain/contracts";
import type { HouseholdWorkspace, Project, ProjectLine } from "@/domain/household-workspace";
import { familyCase } from "@/fixtures/cases";
import { workspaceFixture } from "@/fixtures/workspace";
import { buildHouseholdProjection, calculateComparison, compareWorkspaceOpportunity, evaluateHouseholdWorkspace, engineWorkspaceFingerprint } from "@/lib/engine";
import { fact, usd } from "./helpers";

const T = "2026-11-15T12:00:00.000Z";
const annual = (personId: string, year: 2026 | 2027, dollars: number, excludes: boolean | null = true) =>
  ({ method: "annual_total" as const, personId, year, excludesManagedProjects: excludes, annualNetProfit: fact(usd(dollars)) });
const line = (id: string, dollars: number, date: string, actual: [number, string] | null = null): ProjectLine =>
  ({ id, expected: { amountCents: usd(dollars), date }, cancelledAt: null, sourceId: "demo-input", corrections: [],
    actual: actual ? { amountCents: usd(actual[0]), date: actual[1], recordedAt: T, sourceId: "demo-input" } : null });
const project = (id: string, status: Project["status"], receipts: ProjectLine[]): Project => ({
  id, title: `Project ${id}`, ownerPersonId: "primary", status, createdAt: T, statusChangedAt: T, cashAccountingConfirmed: true, timingArrangementConfirmed: true,
  terms: { canSplitPayment: true, canRenegotiatePrice: true, nextYearPaymentLatestDate: "2027-01-31" }, receipts, expenses: [], agreedDecision: null });

/** The synthetic family as a household workspace: profit only from forecasts and projects; $5,500 set aside for SEP. */
function workspace(p26 = 118000, p27 = 118000): HouseholdWorkspace {
  const ws = structuredClone(workspaceFixture);
  ws.forecasts = [annual("primary", 2026, p26), annual("spouse", 2026, 0), annual("primary", 2027, p27), annual("spouse", 2027, 0)];
  ws.projects = [];
  ws.retirement = { targets: [], contributions: [], futureContributionBudget: { amountCents: usd(5500), asOfDate: "2026-11-15", sourceId: "demo-input" } };
  return ws;
}
async function ready<T extends { status: string }>(p: Promise<T>): Promise<Extract<T, { status: "ready" }>> {
  const r = await p;
  if (r.status !== "ready") throw new Error(JSON.stringify(r));
  return r as Extract<T, { status: "ready" }>;
}
const profit2026 = (r: { profitSources: Array<{ year: number; profitCents: number }> }) => r.profitSources.find(y => y.year === 2026)!.profitCents;

describe("household projection", () => {
  it("keeps round 2 results when the same offer is evaluated in a household plan", async () => {
    const ws = workspace();
    ws.projects = [project("B", "proposed", [line("b1", 12000, "2026-12-20")])];
    const v1 = await ready(calculateComparison(familyCase));
    const v3 = await ready(compareWorkspaceOpportunity(ws, "B"));
    expect(v3.comparison.scenarios.map(s => [s.kind, s.label, s.twoYearCashDeltaCents, s.grossAdditionalRetirementCents]))
      .toEqual(v1.scenarios.map(s => [s.kind, s.label, s.twoYearCashDeltaCents, s.grossAdditionalRetirementCents]));
    expect(v3.comparison.recommendedScenarioId).toBe(v1.recommendedScenarioId);
    expect(v1.scenarios.find(s => s.kind === "split_payment")!.twoYearCashDeltaCents).toBe(usd(8315));
  });

  it("reproduces the contract example and evaluates B on top of A", async () => {
    const p = await ready(buildHouseholdProjection(workspaceFixture));
    const owner = p.years[0].people.find(x => x.personId === "primary")!;
    expect(owner.total).toMatchObject({ valueCents: usd(125000), status: "estimated", range: { lowCents: usd(118000), highCents: usd(131000) } });
    expect(owner.components.filter(c => c.refs?.projectId === "proj-a").map(c => [c.basis, c.amountCents])).toEqual([["actual", usd(4000)], ["expected", usd(3000)]]);
    const b = await ready(compareWorkspaceOpportunity(workspaceFixture, "proj-b"));
    expect(b.baselineProjection[0].profitCents).toBe(usd(125000));                          // A counted once, B excluded
    expect(b.comparison.scenarios.find(s => s.kind === "accept_now")!.decisions.receipts).toEqual([{ date: "2026-12-20", amountCents: usd(12000) }]);
    expect(b.baseline.label).toBe('Your plan without "December design project"');
  });

  it("does not count A twice when B is evaluated, and declining B keeps A", async () => {
    const ws = workspace();
    ws.projects = [project("A", "agreed", [line("a1", 6000, "2026-11-20")]), project("B", "proposed", [line("b1", 3000, "2026-12-28")])];
    expect(profit2026(await ready(buildHouseholdProjection(ws)))).toBe(usd(124000));     // forecast + A only
    const r = await ready(compareWorkspaceOpportunity(ws, "B"));
    expect(r.baselineProjection[0].profitCents).toBe(usd(124000));
    expect(r.comparison.scenarios.find(s => s.kind === "accept_now")!.decisions.receipts).toEqual([{ date: "2026-12-28", amountCents: usd(3000) }]);
    const decline = r.comparison.scenarios.find(s => s.kind === "decline")!;
    expect(decline.years[0].trace.find(t => t.id === "2026.profit_source.total")!.amountCents).toBe(usd(124000));
    const evaluation = await ready(evaluateHouseholdWorkspace(ws));
    expect(decline.years[0].magiCents).toBe(evaluation.fixedPlan.years[0].result!.magiCents);   // declining B = plan with A
    const editA = await ready(compareWorkspaceOpportunity(ws, "A"));                          // editing A: old A leaves the baseline
    expect(editA.baselineProjection[0].profitCents).toBe(usd(118000));
  });

  it("uses an actual payment instead of the expected one, and keeps received money after cancellation", async () => {
    const ws = workspace();
    ws.projects = [project("A", "agreed", [line("a1", 12000, "2026-12-20", [11500, "2026-12-18"])])];
    const p = await ready(buildHouseholdProjection(ws));
    expect(profit2026(p)).toBe(usd(129500));
    expect(p.years[0].people[0].components.filter(c => c.refs?.projectId === "A").map(c => [c.basis, c.amountCents])).toEqual([["actual", usd(11500)]]);
    ws.projects = [project("A", "cancelled", [line("a1", 4000, "2026-11-01", [4000, "2026-11-03"]), line("a2", 8000, "2026-12-20")])];
    expect(profit2026(await ready(buildHouseholdProjection(ws)))).toBe(usd(122000));
  });

  it("does not move or re-price a payment that was already received", async () => {
    const ws = workspace();
    ws.projects = [project("A", "agreed", [line("a1", 4000, "2026-12-01", [4000, "2026-12-01"]), line("a2", 8000, "2026-12-20")])];
    const r = await ready(compareWorkspaceOpportunity(ws, "A"));
    expect(r.baselineProjection[0].profitCents).toBe(usd(122000));
    for (const s of r.comparison.scenarios.filter(s => s.kind !== "decline" && s.kind !== "renegotiate")) {
      expect(s.decisions.receipts.reduce((a, x) => a + x.amountCents, 0)).toBe(usd(8000));
    }
  });

  it("combines year-to-date and the rest of the year with signed ranges, and asks about past-due expected payments", async () => {
    const ws = workspace();
    const est = (d: number, lo: number, hi: number): MoneyFact => ({ valueCents: usd(d), status: "estimated", sourceId: "demo-input", range: { lowCents: usd(lo), highCents: usd(hi) } });
    ws.forecasts[0] = { method: "year_to_date_plus_remaining", personId: "primary", year: 2026, asOfDate: "2026-10-31", asOfConfirmed: true, excludesManagedProjects: true,
      ytdNetProfit: est(80000, 78000, 82000), remainingReceipts: est(30000, 25000, 35000), remainingExpenses: est(5000, 4000, 7000) };
    const y = (await ready(buildHouseholdProjection(ws))).profitSources[0];
    expect([y.profitCents, y.lowCents, y.highCents]).toEqual([usd(105000), usd(96000), usd(113000)]);
    ws.projects = [project("A", "agreed", [line("a1", 5000, "2026-10-15")])];
    const blocked = await buildHouseholdProjection(ws);
    expect(blocked.status === "needs_data" && blocked.code).toBe("PAYMENT_STATUS_UNKNOWN");
    if (blocked.status !== "ready") expect(blocked.fields[0].path).toBe("projects[0].receipts[0].actual");
  });

  it("refuses an unconfirmed project exclusion, also for a proposed project only", async () => {
    const ws = workspace();
    ws.forecasts[0] = annual("primary", 2026, 130000, null);
    ws.projects = [project("B", "proposed", [line("b1", 12000, "2026-12-20")])];
    const r = await compareWorkspaceOpportunity(ws, "B");
    expect(r.status === "needs_data" && r.code).toBe("PROJECT_INCLUSION_UNCONFIRMED");
    if (r.status !== "ready") expect(r.fields[0].path).toBe("forecasts[0].excludesManagedProjects");
  });
});

describe("shared SEP-IRA target", () => {
  it("tracks paid vs target, adds different contributions, never refunds a paid one, checks the set-aside money", async () => {
    const ws = workspace();
    const paid = { id: "sep-1", personId: "primary", taxYear: 2026 as const, amountCents: usd(2000), paidDate: "2026-12-30", sourceId: "demo-input", recordedAt: T };
    ws.retirement.contributions = [paid];
    ws.retirement.targets = [{ id: "t26", personId: "primary", year: 2026, targetCents: usd(3600), acceptedAt: T, origin: { projectId: null, scenarioKind: null, fingerprint: null } }];
    ws.retirement.futureContributionBudget.amountCents = usd(1000);
    ws.retirement.futureContributionBudget.asOfDate = "2026-12-30"; // cash still available AFTER the $2,000 payment
    const r = await ready(evaluateHouseholdWorkspace(ws));
    expect(r.sep[0]).toMatchObject({ targetCents: usd(3600), paidCents: usd(2000), remainingCents: usd(1600) });
    expect(r.futureContributionBudgetRemainingCents).toBe(usd(-600));
    expect(r.agreed.stillFeasible).toBe(false);                                   // $1,600 still to pay, only $1,000 set aside
    expect(r.agreed.reasons.join(" ")).toMatch(/exceed the money set aside/);

    const twice = structuredClone(ws);
    twice.retirement.contributions.push({ ...paid });                            // the same payment recorded twice → rejected, not added
    expect((await evaluateHouseholdWorkspace(twice)).status).toBe("needs_data");

    ws.retirement.targets[0].targetCents = usd(1000);
    ws.retirement.contributions = [paid, { ...paid, id: "sep-2", amountCents: usd(500), paidDate: "2027-02-01" }];
    const lowered = await ready(evaluateHouseholdWorkspace(ws));
    expect(lowered.sep[0]).toMatchObject({ paidCents: usd(2500), remainingCents: 0 });
    expect(lowered.warnings.join(" ")).toMatch(/paid amount stays/);
    expect(lowered.agreed.stillFeasible).toBe(true);
    expect(lowered.fixedPlan.years[0].result!.trace.find(t => t.id === "2026.sep")!.amountCents).toBe(usd(2500));
  });

  it("limits new contributions to the set-aside money minus agreed unpaid contributions (contract example)", async () => {
    const r = await ready(compareWorkspaceOpportunity(workspaceFixture, "proj-b"));
    // Budget $3,500, goal $5,000 with $2,000 paid → $3,000 reserved → $500 left for new contributions.
    expect(r.warnings.join(" ")).toMatch(/limited to \$500/);
    for (const s of r.comparison.scenarios) expect(s.grossAdditionalRetirementCents <= usd(500) || !s.feasible).toBe(true);
  });

  it("reports an agreed target that the current profit no longer allows instead of changing it", async () => {
    const ws = workspace(60000);
    for (const k of ["w2Box1", "socialSecurityWages", "medicareWages", "grossWages"] as const) ws.household.years[0].otherIncomes[1][k] = fact(usd(40000));
    ws.retirement.targets = [{ id: "t26", personId: "primary", year: 2026, targetCents: usd(15000), acceptedAt: T, origin: { projectId: null, scenarioKind: null, fingerprint: null } }];
    ws.retirement.futureContributionBudget.amountCents = usd(20000);
    const r = await ready(evaluateHouseholdWorkspace(ws));
    expect(r.agreed.stillFeasible).toBe(false);
    expect(r.fixedPlan.years[0].result).toBeNull();
    expect(r.agreed.reasons.join(" ")).toMatch(/no longer allowed/);
    expect(r.sep[0].legalLimitCents).toBeLessThan(usd(15000));
  });
});

describe("agreed plan after a new income figure", () => {
  it("shows the old split losing the 2026 credit while a new proposal can keep it", async () => {
    const split = project("A", "agreed", [line("a1", 8093, "2026-12-20"), line("a2", 3907, "2027-01-04")]);
    const before = workspace();
    before.projects = [split];
    const ok = await ready(evaluateHouseholdWorkspace(before));
    expect(ok.fixedPlan.years[0].risk!.ptcCents).toBeGreaterThan(0);
    expect(ok.agreed.creditLostYears).toEqual([]);
    const after = workspace(121000);
    after.projects = [split];
    const changed = await ready(evaluateHouseholdWorkspace(after));
    expect(changed.fixedPlan.years[0].risk!.state).toBe("over_cliff");          // agreed amounts kept, credit lost
    expect(changed.agreed.creditLostYears).toEqual([2026]);
    expect(changed.agreed.result!.decisions.receipts.map(r => r.amountCents)).toEqual([usd(8093), usd(3907)]);
    const fresh = await ready(compareWorkspaceOpportunity(after, "A"));
    expect(fresh.comparison.scenarios.some(s => s.feasible && s.years[0].ptcCents > 0 && s.kind !== "decline")).toBe(true);
  });

  it("fingerprints the meaning, not the order of records", async () => {
    const a = workspace();
    a.projects = [project("A", "agreed", [line("a1", 6000, "2026-11-20")]), project("B", "proposed", [line("b1", 3000, "2026-12-28")])];
    const b = structuredClone(a);
    b.projects.reverse();
    expect(await engineWorkspaceFingerprint(b)).toBe(await engineWorkspaceFingerprint(a));
    b.projects[0].receipts[0].expected!.amountCents += 100;
    expect(await engineWorkspaceFingerprint(b)).not.toBe(await engineWorkspaceFingerprint(a));
  });
});
