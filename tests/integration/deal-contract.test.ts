import { describe, expect, it } from "vitest";
import { cashCompletenessFor, dealSearchFingerprint, DealTermsSpaceSchema, isPackageCurrent } from "@/domain/deal-planning";
import { HouseholdWorkspaceSchema, type HouseholdWorkspace } from "@/domain/household-workspace";
import { dealCashFixture, dealGoalFixture, dealTermsFixture, dealWorkspaceFixture } from "@/fixtures/deal-planning";
import { workspaceFixture } from "@/fixtures/workspace";
import { analyzeWorkspaceFile, exportWorkspaceJson } from "@/lib/client/workspace-migration";

const ok = (mutate: (ws: Record<string, any>) => void) => {
  const ws: Record<string, any> = structuredClone(dealWorkspaceFixture); mutate(ws);
  return HouseholdWorkspaceSchema.safeParse(ws).success;
};

describe("deal planning contract v1.0", () => {
  it("is additive: workspaces without dealPlanning stay valid; the fixture is valid", () => {
    expect(HouseholdWorkspaceSchema.safeParse(workspaceFixture).success).toBe(true);
    expect(ok(() => {})).toBe(true);
  });

  it("rejects inconsistent goals, terms and cash contexts", () => {
    expect(ok(ws => { ws.dealPlanning.goals[0].projectId = "nope"; })).toBe(false);
    expect(ok(ws => { ws.dealPlanning.termSpaces[0].price.minCents = 1_500_000; })).toBe(false); // min > max
    expect(ok(ws => { ws.dealPlanning.termSpaces[0].paymentWindows = [{ id: "w", earliest: "2026-12-01", latest: "2026-12-31", maxShareBps: 5_000 }]; })).toBe(false);
    expect(ok(ws => { ws.dealPlanning.cashContext.completeness = { confirmed: true, from: "2026-11-01", through: "2027-02-01" }; })).toBe(false); // no snapshot
    expect(ok(ws => { ws.dealPlanning.cashContext.includedFactIds = ["unknown-fact"]; })).toBe(false);
    expect(ok(ws => { ws.dealPlanning.cashContext.includedFactIds = ["a-pay-1", "sep-paid-1"]; })).toBe(true);
    expect(DealTermsSpaceSchema.safeParse({ ...dealTermsFixture, price: { ...dealTermsFixture.price, stepCents: 1 } }).success).toBe(false);
  });

  it("fingerprints change with the goal, not with timestamps; packages go stale by fingerprint", async () => {
    const fp = (g = dealGoalFixture) => dealSearchFingerprint("ws-fp", g, dealTermsFixture, dealCashFixture, "e", "r");
    const base = await fp();
    expect(await fp({ ...dealGoalFixture, updatedAt: "2026-12-01T00:00:00.000Z" })).toBe(base);
    expect(await fp({ ...dealGoalFixture, minimumTwoYearCashDeltaCents: 450_000 })).not.toBe(base);
    expect(isPackageCurrent({ searchFingerprint: base, status: "draft" } as never, base)).toBe(true);
    expect(isPackageCurrent({ searchFingerprint: base, status: "draft" } as never, "other")).toBe(false);
  });

  it("never claims a household balance without a complete cash context", () => {
    expect(cashCompletenessFor(dealGoalFixture, null)).toBe("project_only");
    const balanceGoal = { ...dealGoalFixture, dateTargets: [{ id: "b", kind: "household_balance" as const, byDate: "2027-01-10", minimumCents: 500_000 }] };
    expect(cashCompletenessFor(balanceGoal, dealCashFixture)).toBe("household_incomplete");
    expect(cashCompletenessFor(balanceGoal, { ...dealCashFixture, snapshot: { date: "2026-11-15", balanceCents: 900_000, sourceId: "demo-input" },
      completeness: { confirmed: true, from: "2026-11-15", through: "2027-01-31" } })).toBe("household_complete");
  });

  it("JSON export/restore keeps the deal planning state", async () => {
    const restored = analyzeWorkspaceFile(await exportWorkspaceJson(dealWorkspaceFixture as HouseholdWorkspace).text());
    expect(restored.status === "workspace" && restored.workspace.dealPlanning).toEqual(dealWorkspaceFixture.dealPlanning);
  });
});
