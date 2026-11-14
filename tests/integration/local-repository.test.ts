import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanEvent, SavedPlan } from "@/domain/contracts";
import { familyCase } from "@/fixtures/cases";
import { fakeCalculateComparison } from "../support/fake-engine";

vi.mock("@/lib/engine", () => ({ calculateComparison: fakeCalculateComparison }));

const { createLocalPlanRepository, LOCAL_STORAGE_KEY } = await import("@/lib/client/local-repository");
const { PlanConflictError, PlanIntegrityError } = await import("@/lib/client/errors");

class MemoryStore { data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; } setItem(k: string, v: string) { this.data.set(k, v); } removeItem(k: string) { this.data.delete(k); } }

async function draft(): Promise<SavedPlan> {
  const comparison = await fakeCalculateComparison(familyCase);
  if (comparison.status !== "ready") throw new Error("unexpected");
  return { id: "", revision: 0, createdAt: "", updatedAt: "", input: structuredClone(familyCase), comparison, chosenScenarioId: "sep", completedActionIds: [] };
}

describe("local plan repository", () => {
  let store: MemoryStore;
  beforeEach(() => { store = new MemoryStore(); });

  it("round trip: save, reload, update revision, conflict, events, remove, clear", async () => {
    const repo = createLocalPlanRepository({ store });
    const created = await repo.save(await draft(), null);
    expect(created.revision).toBe(1);
    expect(created.id).toMatch(/[0-9a-f-]{36}/);

    // "Reload": a brand-new repository instance over the same persisted browser storage.
    const reloaded = createLocalPlanRepository({ store });
    const reopened = await reloaded.get(created.id);
    expect(reopened?.comparison.calculationFingerprint).toBe(created.comparison.calculationFingerprint);
    expect(JSON.parse(store.getItem(LOCAL_STORAGE_KEY)!).version).toBe(1);

    const actionId = reopened!.comparison.scenarios.find(s => s.id === "sep")!.actions[0].id;
    const updated = await reloaded.save({ ...reopened!, completedActionIds: [actionId] }, 1);
    expect(updated.revision).toBe(2);
    expect(updated.createdAt).toBe(created.createdAt);
    await expect(reloaded.save({ ...reopened! }, 1)).rejects.toBeInstanceOf(PlanConflictError);
    expect((await reloaded.get(created.id))?.completedActionIds).toEqual([actionId]);

    const event: PlanEvent = { id: "e1", planId: created.id, occurredAt: "2026-12-01T00:00:00.000Z", kind: "action_confirmed",
      description: "SEP contribution made", previousFingerprint: created.comparison.calculationFingerprint, nextFingerprint: null };
    await reloaded.appendEvent(event);
    await reloaded.appendEvent(event); // idempotent by id
    expect(await createLocalPlanRepository({ store }).listEvents(created.id)).toHaveLength(1);

    const second = await reloaded.save(await draft(), null);
    expect((await reloaded.list()).map(p => p.id)).toContain(second.id);
    await reloaded.remove(created.id);
    expect(await reloaded.get(created.id)).toBeNull();
    expect(await reloaded.listEvents(created.id)).toEqual([]);
    await reloaded.clear();
    expect(await reloaded.list()).toEqual([]);
    expect(store.getItem(LOCAL_STORAGE_KEY)).toBeNull();
  });

  it("refuses stale results, unknown/infeasible options and client-altered numbers", async () => {
    const repo = createLocalPlanRepository({ store });
    const plan = await draft();
    const edited = structuredClone(plan);
    edited.input.opportunity.grossRevenueCents += 100_000; // input changed, comparison not recalculated
    await expect(repo.save(edited, null)).rejects.toMatchObject({ code: "STALE_RESULT" });
    await expect(repo.save({ ...plan, chosenScenarioId: "nope" }, null)).rejects.toMatchObject({ code: "UNKNOWN_SCENARIO" });
    await expect(repo.save({ ...plan, chosenScenarioId: "split" }, null)).rejects.toMatchObject({ code: "INFEASIBLE_SCENARIO" });

    const tampered = structuredClone(plan);
    tampered.comparison.scenarios[2].twoYearCashDeltaCents = 99_999_999;
    const saved = await repo.save(tampered, null);
    expect(saved.comparison.scenarios[2].twoYearCashDeltaCents).toBe(410_000); // recomputed, not trusted
    expect(PlanIntegrityError).toBeDefined();
  });
});
