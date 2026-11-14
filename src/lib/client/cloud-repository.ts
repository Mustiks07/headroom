import type { PlanEvent, PlanRepository, SavedPlan } from "@/domain/contracts";
import { PlanConflictError, StorageUnavailableError } from "./errors";
import { apiFetch, errorFromResponse, readJson } from "./http";

/** PlanRepository backed by /api/plans. The server derives ownership from the bearer token. */
export function createCloudPlanRepository(getToken: () => Promise<string>): PlanRepository {
  const call = async (path: string, init: RequestInit = {}) => {
    const token = await getToken();
    const response = await apiFetch(path, { ...init, token,
      headers: init.body ? { "Content-Type": "application/json" } : undefined });
    if (response.status === 503) {
      throw new StorageUnavailableError("Cloud save is unavailable right now. Your entries are still on this page.",
        "CLOUD_UNAVAILABLE", 503);
    }
    return response;
  };
  const id = (value: string) => encodeURIComponent(value);

  return {
    async list() {
      return (await readJson<{ plans: SavedPlan[] }>(await call("/api/plans"))).plans;
    },
    async get(planId) {
      const response = await call(`/api/plans/${id(planId)}`);
      if (response.status === 404) return null;
      return (await readJson<{ plan: SavedPlan }>(response)).plan;
    },
    async save(plan, expectedRevision) {
      const response = expectedRevision === null
        ? await call("/api/plans", { method: "POST", body: JSON.stringify({ plan, expectedRevision: null }) })
        : await call(`/api/plans/${id(plan.id)}`, { method: "PUT", body: JSON.stringify({ plan, expectedRevision }) });
      if (response.status === 409) {
        const body = await response.clone().json().catch(() => ({}));
        if (body?.error?.code === "PLAN_REVISION_CONFLICT") throw new PlanConflictError(body.current ?? null);
        throw await errorFromResponse(response);
      }
      if (response.status === 404) throw new PlanConflictError(null);
      return (await readJson<{ plan: SavedPlan }>(response)).plan;
    },
    async remove(planId) {
      const response = await call(`/api/plans/${id(planId)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw await errorFromResponse(response);
    },
    async appendEvent(event: PlanEvent) {
      const response = await call(`/api/plans/${id(event.planId)}/events`, { method: "POST", body: JSON.stringify(event) });
      if (!response.ok) throw await errorFromResponse(response);
    },
    async listEvents(planId) {
      return (await readJson<{ events: PlanEvent[] }>(await call(`/api/plans/${id(planId)}/events`))).events;
    },
    async clear() {
      const response = await call("/api/data", { method: "DELETE" });
      if (!response.ok) throw await errorFromResponse(response);
    },
  };
}
