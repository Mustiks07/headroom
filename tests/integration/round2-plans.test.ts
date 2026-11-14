import { describe, expect, it, vi } from "vitest";
import type { PlanEvent, SavedPlan } from "@/domain/contracts";
import { familyCase } from "@/fixtures/cases";
import { calculateComparison } from "@/lib/engine";
import { createLocalPlanRepository, LOCAL_STORAGE_KEY, type RevisionedPlanRepository } from "@/lib/client/local-repository";
import { checkPlanCurrency, confirmPlanUpgrade, previewPlanUpgrade } from "@/lib/client/plan-upgrade";
import { analyzePlanFile, planFromAnalysis } from "@/lib/client/plan-restore";
import { CloudSaveFailedError, createPlanRepository, PartialClearError, type StorageModeInfo } from "@/lib/client/repository";
import { StorageUnavailableError } from "@/lib/client/errors";

class MemoryStore { data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; } setItem(k: string, v: string) { this.data.set(k, v); } removeItem(k: string) { this.data.delete(k); } }

async function freshPlan(): Promise<SavedPlan> {
  const comparison = await calculateComparison(familyCase);
  if (comparison.status !== "ready") throw new Error(comparison.message);
  return { id: "", revision: 0, createdAt: "", updatedAt: "", input: structuredClone(familyCase), comparison,
    chosenScenarioId: comparison.recommendedScenarioId!, completedActionIds: [] };
}

/** Rewrite a stored plan as if an older engine/rule pack had produced it. */
function ageStoredPlan(store: MemoryStore, id: string, patch: (p: SavedPlan) => void) {
  const state = JSON.parse(store.getItem(LOCAL_STORAGE_KEY)!);
  patch(state.plans[id]);
  store.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
}

describe("saved plan after an engine/rules update (real engine)", () => {
  it("detects the old version, previews, keeps history and records the upgrade", async () => {
    const store = new MemoryStore();
    const repo = createLocalPlanRepository({ store });
    const saved = await repo.save(await freshPlan(), null);
    const actionId = saved.comparison.scenarios.find(s => s.id === saved.chosenScenarioId)!.actions[0].id;
    ageStoredPlan(store, saved.id, p => {
      p.comparison.engineVersion = "headroom-engine-1.0.0"; p.comparison.rulesVersion = "us-federal-aca-2026-2027.r1";
      p.comparison.calculationFingerprint = "old-fingerprint"; p.completedActionIds = [actionId, "gone-action"];
    });
    const old = (await repo.get(saved.id))!;
    expect(await checkPlanCurrency(old)).toMatchObject({ status: "outdated_rules", saved: { engineVersion: "headroom-engine-1.0.0" } });
    await expect(repo.save(old, old.revision)).rejects.toMatchObject({ code: "STALE_RESULT" }); // no silent overwrite

    const preview = await previewPlanUpgrade(old);
    if (preview.status !== "ready") throw new Error("expected ready");
    expect(preview.suggestedScenarioId).toBe(old.chosenScenarioId);
    expect(preview.completedKept).toEqual([actionId]);
    expect(preview.completedDropped.map(a => a.id)).toEqual(["gone-action"]);
    const upgraded = await confirmPlanUpgrade(repo, old, preview, preview.suggestedScenarioId!);
    expect(upgraded.revision).toBe(2);
    expect(await checkPlanCurrency(upgraded)).toEqual({ status: "current" });
    expect(upgraded.completedActionIds).toEqual([actionId]);
    const history = await repo.listRevisions(saved.id);
    expect(history.map(h => [h.revision, h.comparison.engineVersion])).toEqual([[1, "headroom-engine-1.0.0"]]);
    const events = await repo.listEvents(saved.id);
    expect(events.map(e => e.kind)).toEqual(["rules_updated"]);
    expect(events[0].previousFingerprint).toBe("old-fingerprint");
  });

  it("does not pre-select an option the new calculation no longer offers", async () => {
    const store = new MemoryStore();
    const repo = createLocalPlanRepository({ store });
    const saved = await repo.save(await freshPlan(), null);
    ageStoredPlan(store, saved.id, p => { p.comparison.engineVersion = "old"; p.chosenScenarioId = "retired_kind"; });
    const preview = await previewPlanUpgrade((await repo.get(saved.id))!);
    if (preview.status !== "ready") throw new Error("expected ready");
    expect(preview.sameOption).toBeNull();
    expect(preview.suggestedScenarioId).toBeNull();
    await expect(confirmPlanUpgrade(repo, (await repo.get(saved.id))!, preview, "retired_kind")).rejects.toMatchObject({ code: "INFEASIBLE_SCENARIO" });
  });
});

describe("cloud failure after a guest session exists", () => {
  const cloudMode = async (): Promise<StorageModeInfo> => ({ mode: "cloud", label: "cloud", detail: "" });
  const down = () => { throw new StorageUnavailableError("Cloud save is unavailable right now.", "CLOUD_UNAVAILABLE", 503); };
  const brokenCloud: RevisionedPlanRepository = {
    list: async () => down(), get: async () => down(), save: async () => down(), remove: async () => down(),
    appendEvent: async () => down(), listEvents: async () => down(), listRevisions: async () => down(), clear: async () => down(),
  };

  it("never reports a cloud save, offers an explicit local save, and keeps ownership separate", async () => {
    const store = new MemoryStore();
    const local = createLocalPlanRepository({ store });
    const cleared: Array<{ keepSession: boolean }> = [];
    const repo = createPlanRepository({ local, cloud: brokenCloud, mode: cloudMode, forgetSession: vi.fn(),
      clearBrowser: async o => { cleared.push(o); await local.clear(); } });
    const plan = await freshPlan();
    const error = await repo.save(plan, null).catch(e => e);
    expect(error).toBeInstanceOf(CloudSaveFailedError);
    expect(error.operation).toBe("create");
    expect(await local.list()).toEqual([]); // nothing written silently

    const kept = await repo.saveLocally(plan);
    expect(repo.locationOf(kept.id)).toBe("local");
    const listed = await repo.list();
    expect(listed.map(p => p.id)).toEqual([kept.id]);
    expect(repo.cloudProblem()).toMatch(/isn't reachable/);
    const updated = await repo.save({ ...kept }, kept.revision); // local plan stays local
    expect(updated.revision).toBe(2);
    await repo.appendEvent({ id: "e", planId: kept.id, occurredAt: new Date().toISOString(), kind: "income_changed",
      description: "x", previousFingerprint: "a", nextFingerprint: "b" } satisfies PlanEvent);

    const clearError = await repo.clear().catch(e => e);
    expect(clearError).toBeInstanceOf(PartialClearError);
    expect(clearError.message).toMatch(/could not be deleted/);
    expect(cleared).toEqual([{ keepSession: true }]); // session kept so the cloud copy can still be deleted
    expect(await local.list()).toEqual([]);
  });
});

describe("JSON restore (real engine)", () => {
  const file = (plan: SavedPlan) => JSON.stringify({ kind: "headroom.saved-plan", contractVersion: "1.0", exportedAt: "2026-11-14T00:00:00Z", plan });

  it("restores a current file with its option and completed actions", async () => {
    const plan = await freshPlan();
    const actionId = plan.comparison.scenarios.find(s => s.id === plan.chosenScenarioId)!.actions[0].id;
    const analysis = await analyzePlanFile(file({ ...plan, completedActionIds: [actionId, "stale-action"] }));
    if (analysis.status !== "ready") throw new Error("expected ready");
    expect(analysis.fingerprintMatches).toBe(true);
    expect(analysis.choice.state).toBe("kept");
    expect(analysis.completedKept).toEqual([actionId]);
    expect(analysis.completedDropped).toEqual(["stale-action"]);
    expect(planFromAnalysis(analysis, analysis.suggestedScenarioId!).completedActionIds).toEqual([actionId]);
  });

  it("flags old versions, tampered numbers, missing/infeasible options and bad files", async () => {
    const plan = await freshPlan();
    const old = await analyzePlanFile(file({ ...plan, comparison: { ...plan.comparison, engineVersion: "headroom-engine-0.9", calculationFingerprint: "x" } }));
    expect(old.status === "ready" && old.notes.join(" ")).toMatch(/recalculated with headroom-engine/);
    const tampered = structuredClone(plan);
    tampered.comparison.scenarios[0].twoYearCashDeltaCents = 1;
    tampered.comparison.calculationFingerprint = "y";
    const t = await analyzePlanFile(file(tampered));
    expect(t.status === "ready" && t.notes.join(" ")).toMatch(/don't match its inputs/);
    expect(t.status === "ready" && t.comparison.scenarios[0].twoYearCashDeltaCents).not.toBe(1);
    const missing = await analyzePlanFile(file({ ...plan, chosenScenarioId: "nope" }));
    expect(missing.status === "ready" && [missing.choice.state, missing.suggestedScenarioId]).toEqual(["missing", null]);
    const constrained = structuredClone(plan);
    constrained.input.constraints.maxAdditionalSepCents = 0;
    const infeasibleId = (await calculateComparison(constrained.input) as { scenarios: Array<{ id: string; feasible: boolean }> })
      .scenarios.find(s => !s.feasible)?.id;
    expect(infeasibleId).toBe("sep_minimum");
    {
      const inf = await analyzePlanFile(file({ ...constrained, chosenScenarioId: infeasibleId! }));
      expect(inf.status === "ready" && inf.choice.state).toBe("infeasible");
    }
    expect(await analyzePlanFile("{not json")).toMatchObject({ status: "invalid" });
    expect(await analyzePlanFile(JSON.stringify({ kind: "headroom.saved-plan", contractVersion: "2.0", plan }))).toMatchObject({ status: "invalid", message: expect.stringMatching(/format 2.0/) });
    const broken = structuredClone(plan) as unknown as { input: { state: string } };
    broken.input.state = "Tennessee";
    expect(await analyzePlanFile(file(broken as unknown as SavedPlan))).toMatchObject({ status: "invalid", message: expect.stringMatching(/state/) });
    const caseOnly = await analyzePlanFile(JSON.stringify({ kind: "headroom.case-input", contractVersion: "1.0", input: familyCase }));
    expect(caseOnly.status === "ready" && [caseOnly.fileKind, caseOnly.choice.state]).toEqual(["case-input", "none"]);
  });
});
