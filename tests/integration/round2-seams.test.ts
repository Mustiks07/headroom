import { describe, expect, it } from "vitest";
import type { SavedPlan } from "@/domain/contracts";
import { familyCase } from "@/fixtures/cases";
import { calculateComparison } from "@/lib/engine";
import { previewPlanUpgrade } from "@/lib/client/plan-upgrade";
import { analyzePlanFile } from "@/lib/client/plan-restore";

async function saved(kind: "split_payment" | "sep_minimum"): Promise<SavedPlan> {
  const input = structuredClone(familyCase);
  const comparison = await calculateComparison(input);
  if (comparison.status !== "ready") throw new Error(comparison.message);
  const chosen = comparison.scenarios.find(s => s.kind === kind)!;
  return { id: "seam-plan", revision: 1, createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z",
    input, comparison, chosenScenarioId: chosen.id, completedActionIds: [] };
}

describe("round 2 integration seams", () => {
  it("shows the lost credit on the agreed split before presenting a newly optimized split", async () => {
    const plan = await saved("split_payment");
    const old = plan.comparison.scenarios.find(s => s.id === plan.chosenScenarioId)!;
    plan.input.years[0].incomes[0].scheduleCProfit.valueCents! += 300_000;
    const preview = await previewPlanUpgrade(plan);
    if (preview.status !== "ready" || preview.agreedEvaluation?.status !== "ready") throw new Error("Expected review");
    expect(preview.agreedEvaluation.agreed?.decisions.receipts).toEqual(old.decisions.receipts);
    expect(preview.agreedEvaluation.creditLostYears).toEqual([2026]);
    const proposal = preview.comparison.scenarios.find(s => s.id === preview.sameOption?.id)!;
    expect(proposal.years[0].ptcCents).toBeGreaterThan(0);
    expect(proposal.decisions.receipts).not.toEqual(old.decisions.receipts);
  });

  it("does not carry a completed contribution into a larger amount, including JSON restore", async () => {
    const plan = await saved("sep_minimum");
    const old = plan.comparison.scenarios.find(s => s.id === plan.chosenScenarioId)!;
    const id = old.actions.find(a => a.id.includes("-sep-"))!.id;
    plan.completedActionIds = [id];
    plan.input.years[0].incomes[0].scheduleCProfit.valueCents! += 50_000;
    const preview = await previewPlanUpgrade(plan);
    if (preview.status !== "ready") throw new Error("Expected review");
    expect(preview.completedKept).not.toContain(id);
    expect(preview.completedDropped.map(a => a.id)).toContain(id);
    const restored = await analyzePlanFile(JSON.stringify({ kind: "headroom.saved-plan", plan }));
    expect(restored.status === "ready" && restored.completedKept).toEqual([]);
    const damaged = { ...plan, comparison: { ...plan.comparison, scenarios: {} } };
    await expect(analyzePlanFile(JSON.stringify({ kind: "headroom.saved-plan", plan: damaged }))).resolves.toMatchObject({ status: "ready", completedKept: [] });
  });
});
