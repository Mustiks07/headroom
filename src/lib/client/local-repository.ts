import type { PlanEvent, PlanRepository, SavedPlan } from "@/domain/contracts";
import { PlanConflictError, PlanIntegrityError, StorageUnavailableError } from "./errors";
import { verifyPlanForSave } from "./plan-integrity";

/** Minimal synchronous key/value store. `window.localStorage` satisfies it. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LOCAL_STORAGE_KEY = "headroom:v1:plans";
const FORMAT_VERSION = 1;

interface LocalState {
  version: typeof FORMAT_VERSION;
  plans: Record<string, SavedPlan>;
  events: Record<string, PlanEvent[]>;
}

export interface LocalRepositoryOptions {
  store?: KeyValueStore;
  /** Recompute/verify before saving. Defaults to the shared engine check. */
  verify?: (plan: SavedPlan) => Promise<SavedPlan>;
  now?: () => Date;
  newId?: () => string;
}

const emptyState = (): LocalState => ({ version: FORMAT_VERSION, plans: {}, events: {} });

function browserStore(): KeyValueStore | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const probe = "headroom:v1:probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isLocalStorageAvailable(): boolean {
  return browserStore() !== null;
}

/**
 * Versioned per-browser plan repository. Data survives reloads because it lives in
 * localStorage; nothing is kept only in process memory. Same semantics as the cloud API:
 * `save(plan, null)` creates revision 1 with a new id, `save(plan, n)` requires the stored
 * revision to be `n`, otherwise `PlanConflictError` and nothing is overwritten.
 */
export function createLocalPlanRepository(options: LocalRepositoryOptions = {}): PlanRepository {
  const verify = options.verify ?? verifyPlanForSave;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());

  const store = (): KeyValueStore => {
    const s = options.store ?? browserStore();
    if (!s) throw new StorageUnavailableError(
      "This browser is blocking local storage, so plans cannot be saved here. Allow site data or export the plan as JSON.",
      "LOCAL_STORAGE_BLOCKED");
    return s;
  };

  const read = (): LocalState => {
    const s = store();
    const raw = s.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return emptyState();
    try {
      const parsed = JSON.parse(raw) as LocalState;
      if (parsed?.version !== FORMAT_VERSION || typeof parsed.plans !== "object" || typeof parsed.events !== "object") {
        throw new Error("unexpected format");
      }
      return parsed;
    } catch {
      // Keep the unreadable data for manual recovery instead of silently discarding it.
      try { s.setItem(`${LOCAL_STORAGE_KEY}:unreadable`, raw); } catch { /* best effort */ }
      s.removeItem(LOCAL_STORAGE_KEY);
      return emptyState();
    }
  };

  const write = (state: LocalState) => {
    try {
      store().setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw error;
      throw new StorageUnavailableError(
        "This browser has no room left to save the plan. Delete an older plan or export it as JSON.",
        "LOCAL_STORAGE_FULL");
    }
  };

  const byUpdatedDesc = (a: SavedPlan, b: SavedPlan) => b.updatedAt.localeCompare(a.updatedAt);

  return {
    async list() {
      return Object.values(read().plans).sort(byUpdatedDesc).map(p => structuredClone(p));
    },
    async get(id) {
      const plan = read().plans[id];
      return plan ? structuredClone(plan) : null;
    },
    async save(plan, expectedRevision) {
      const verified = await verify(plan);
      const state = read();
      const timestamp = now().toISOString();
      let saved: SavedPlan;
      if (expectedRevision === null) {
        saved = { ...verified, id: newId(), revision: 1, createdAt: timestamp, updatedAt: timestamp };
      } else {
        const current = state.plans[plan.id];
        if (!current) throw new PlanConflictError(null);
        if (current.revision !== expectedRevision) throw new PlanConflictError(structuredClone(current));
        saved = { ...verified, id: current.id, revision: current.revision + 1,
          createdAt: current.createdAt, updatedAt: timestamp };
      }
      state.plans[saved.id] = saved;
      write(state);
      return structuredClone(saved);
    },
    async remove(id) {
      const state = read();
      delete state.plans[id];
      delete state.events[id];
      write(state);
    },
    async appendEvent(event) {
      const state = read();
      if (!state.plans[event.planId]) {
        throw new PlanIntegrityError("UNKNOWN_PLAN", "This plan no longer exists in this browser.");
      }
      const events = state.events[event.planId] ?? [];
      const stored: PlanEvent = { ...event, id: event.id || newId(), occurredAt: event.occurredAt || now().toISOString() };
      if (!events.some(e => e.id === stored.id)) events.push(stored);
      state.events[event.planId] = events;
      write(state);
    },
    async listEvents(planId) {
      const events = read().events[planId] ?? [];
      return [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map(e => structuredClone(e));
    },
    async clear() {
      const s = store();
      s.removeItem(LOCAL_STORAGE_KEY);
      s.removeItem(`${LOCAL_STORAGE_KEY}:unreadable`);
    },
  };
}

/** Notify when another tab changes locally stored plans. Returns an unsubscribe function. */
export function subscribeToLocalPlanChanges(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: StorageEvent) => {
    if (event.key === null || event.key === LOCAL_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
