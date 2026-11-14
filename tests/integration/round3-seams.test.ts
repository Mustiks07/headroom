import { describe, expect, it } from "vitest";
import { workspaceFixture } from "@/fixtures/workspace";
import { remainingSepCash, workspaceToCaseInput } from "@/domain/household-workspace";
import { buildHouseholdProjection, compareWorkspaceOpportunity, evaluateHouseholdWorkspace } from "@/lib/engine";
import { agreeToOption, recordContribution, setFutureBudget } from "@/features/household-plan/ops";
import { buildForecastModel } from "@/lib/server/pdf/forecast-model";

describe("round 3 integration", () => {
  it("uses the same remaining offer and reserved SEP budget in the display adapter and engine", async () => {
    const ws = structuredClone(workspaceFixture);
    const adapted = workspaceToCaseInput(ws, { candidateProjectId: "proj-a" });
    expect(adapted.input.opportunity.grossRevenueCents).toBe(300_000);
    expect(adapted.input.years[0].incomes[0].scheduleCProfit.valueCents).toBe(12_200_000);
    expect(adapted.input.constraints.maxAdditionalSepCents).toBe(50_000);
    ws.projects[0].status = "proposed";
    const projection = await buildHouseholdProjection(ws);
    expect(projection.status).toBe("ready");
    if (projection.status !== "ready") return;
    expect(projection.years[0].people[0].total.valueCents).toBe(12_200_000);
    expect(workspaceToCaseInput(ws).input.years[0].incomes[0].scheduleCProfit.valueCents).toBe(12_200_000);
    const model = buildForecastModel({ ws, year: 2026, risk: null, fingerprint: "review", engineVersion: "test", rulesVersion: "test", generatedAt: new Date() });
    expect(JSON.stringify(model)).toContain("$122,000.00");
  });

  it("a new contribution consumes cash and satisfies the target without creating new spending capacity", async () => {
    const original = structuredClone(workspaceFixture);
    const ws = recordContribution(original, { personId: "primary", taxYear: 2026, amountCents: 150_000, paidDate: "2026-10-20", sourceLabel: "New payment after the snapshot" });
    expect(remainingSepCash(ws)).toBe(200_000);
    const result = await evaluateHouseholdWorkspace(ws);
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.sep.find(s => s.year === 2026)?.remainingCents).toBe(150_000);
    expect(result.futureContributionBudgetRemainingCents).toBe(50_000);
    const refreshed = setFutureBudget(ws, 200_000, "2026-10-20");
    expect(remainingSepCash(refreshed)).toBe(200_000); // no second deduction after confirming a fresh balance
    const oldReceipt = recordContribution(original, { personId: "primary", taxYear: 2026, amountCents: 100_000, paidDate: "2026-10-19", sourceLabel: "Earlier payment found in records" });
    expect(remainingSepCash(oldReceipt)).toBe(350_000);
    ws.retirement.futureContributionBudget.amountCents = 100_000;
    expect(await compareWorkspaceOpportunity(ws, "proj-b")).toMatchObject({ status: "needs_data", code: "AGREED_SEP_BUDGET_SHORTFALL" });
  });

  it("can accept revised unpaid terms without changing the deposit, and does not repeat the same acceptance", async () => {
    const ws = structuredClone(workspaceFixture);
    const comparison = await compareWorkspaceOpportunity(ws, "proj-a");
    if (comparison.status !== "ready") throw new Error(comparison.message);
    const choice = comparison.comparison.scenarios.find(s => s.kind === "accept_now")!;
    const updated = agreeToOption(ws, "proj-a", choice, comparison.fingerprint);
    expect(updated.projects[0].receipts[0]).toEqual(ws.projects[0].receipts[0]);
    expect(updated.projects[0].receipts.filter(l => !l.actual).reduce((s, l) => s + l.expected!.amountCents, 0)).toBe(300_000);
    expect(agreeToOption(updated, "proj-a", choice, comparison.fingerprint)).toBe(updated);
  });
});
