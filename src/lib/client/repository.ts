import type { PlanEvent, SavedPlan } from "@/domain/contracts";
import { createCloudPlanRepository } from "./cloud-repository";
import { forgetCloudSession, getCloudSession, lastCloudFailure } from "./cloud-session";
import { HeadroomError, StorageUnavailableError } from "./errors";
import { createLocalPlanRepository, isLocalStorageAvailable, LOCAL_STORAGE_KEY, type RevisionedPlanRepository } from "./local-repository";
import { publicSupabaseConfig } from "./public-config";

export type StorageMode = "cloud" | "local" | "unavailable";
export type PlanLocation = "cloud" | "local";

export interface StorageModeInfo {
  mode: StorageMode;
  /** Truthful English label for the UI. */
  label: string;
  detail: string;
}

/**
 * A cloud request failed after the guest session was established (network, timeout, 5xx,
 * expired session, missing tables). Nothing was saved in the cloud. The caller still has the
 * plan in memory and may offer `saveLocally(plan)` or a JSON download.
 */
export class CloudSaveFailedError extends StorageUnavailableError {
  readonly canSaveLocally = true;
  constructor(public readonly operation: "create" | "update", cause?: HeadroomError) {
    super(operation === "create"
      ? "Cloud save isn't working right now, so this plan was not saved. You can save it in this browser instead or download it as JSON."
      : "Cloud save isn't working right now, so this change was not saved. You can save a separate copy in this browser or download it as JSON.",
    cause?.code ?? "CLOUD_SAVE_FAILED", cause?.status);
    this.name = "CloudSaveFailedError";
  }
}

/** "Clear my data" finished locally but the cloud copy could not be deleted. */
export class PartialClearError extends StorageUnavailableError {
  constructor() {
    super("Plans and figures saved in this browser were deleted. The cloud copy could not be deleted right now, so it still exists. Try again to delete it.",
      "CLOUD_DELETE_FAILED");
    this.name = "PartialClearError";
  }
}

export interface HeadroomPlanRepository extends RevisionedPlanRepository {
  /** Which storage new plans go to in this browser session. */
  storageMode(): Promise<StorageMode>;
  /** Same, with truthful English label/detail for the UI. */
  storageModeInfo(): Promise<StorageModeInfo>;
  /** Where an already loaded/saved plan lives (null if unknown in this page view). */
  locationOf(planId: string): PlanLocation | null;
  /** Save as a NEW plan in this browser only (after a cloud failure). Never touches the cloud copy. */
  saveLocally(plan: SavedPlan): Promise<SavedPlan>;
  /** Last cloud problem seen in this page view, for a truthful notice (null when none). */
  cloudProblem(): string | null;
}

const LOCAL_INFO: StorageModeInfo = {
  mode: "local",
  label: "Saved in this browser",
  detail: "Plans stay on this device only. Clearing site data removes them; export JSON to keep a copy.",
};

let resolved: Promise<StorageModeInfo> | null = null;

async function resolveMode(): Promise<StorageModeInfo> {
  if (publicSupabaseConfig()) {
    const session = await getCloudSession();
    if (session) {
      return { mode: "cloud", label: "Saved to a private guest space",
        detail: "Saved in the cloud under an anonymous guest session in this browser. There is no account, so it does not sync to other devices." };
    }
    if (isLocalStorageAvailable()) {
      return { ...LOCAL_INFO, detail: `${lastCloudFailure() ?? "Cloud save is unavailable."} ${LOCAL_INFO.detail}` };
    }
  } else if (isLocalStorageAvailable()) {
    return LOCAL_INFO;
  }
  return { mode: "unavailable", label: "Saving is unavailable",
    detail: "This browser blocks local storage and cloud save is not available. Export the plan as JSON or PDF instead." };
}

/** Resolve once per page load; reset after clearing data. */
export function getStorageMode(): Promise<StorageModeInfo> {
  resolved ??= resolveMode();
  return resolved;
}

/** A cloud failure that should fall back to local options, not a validation/conflict answer. */
function isCloudFailure(error: unknown): error is HeadroomError {
  return error instanceof StorageUnavailableError ||
    (error instanceof HeadroomError && (error.status === 401 || (error.status ?? 0) >= 500));
}

export interface RepositoryDeps {
  local?: RevisionedPlanRepository;
  cloud?: RevisionedPlanRepository;
  mode?: () => Promise<StorageModeInfo>;
  forgetSession?: () => Promise<void>;
  clearBrowser?: (options: { keepSession: boolean }) => Promise<void>;
}

/**
 * The repository the UI uses. New plans go to the cloud only when Supabase is configured and an
 * invisible anonymous session succeeded; otherwise to versioned local browser storage. Plans keep
 * their location: a cloud plan is never silently written locally (or vice versa). When the cloud
 * fails later, reads fall back to plans saved in this browser and writes throw
 * `CloudSaveFailedError`, so the UI can offer an explicit local save or JSON download.
 */
export function createPlanRepository(deps: RepositoryDeps = {}): HeadroomPlanRepository {
  const local = deps.local ?? createLocalPlanRepository();
  const cloud = deps.cloud ?? createCloudPlanRepository(async () => {
    const session = await getCloudSession();
    if (!session) throw new StorageUnavailableError("Cloud save is unavailable right now. Your entries are still on this page.", "CLOUD_UNAVAILABLE");
    return session.accessToken;
  });
  const mode = deps.mode ?? getStorageMode;
  const located = new Map<string, PlanLocation>();
  let problem: string | null = null;

  const note = (error: HeadroomError) => { problem = `Cloud save isn't reachable right now (${error.message.replace(/\.$/, "")}). Plans saved in this browser are still available.`; };
  const isCloudMode = async () => (await mode()).mode === "cloud";

  /** Where to find an existing plan: remembered location, else cloud (in cloud mode) then local. */
  async function find(planId: string): Promise<{ plan: SavedPlan | null; where: PlanLocation }> {
    const known = located.get(planId);
    if (known === "local" || !(await isCloudMode())) {
      const plan = await local.get(planId);
      if (plan) located.set(planId, "local");
      return { plan, where: "local" };
    }
    try {
      const plan = await cloud.get(planId);
      if (plan) { located.set(planId, "cloud"); problem = null; return { plan, where: "cloud" }; }
    } catch (error) {
      if (!isCloudFailure(error)) throw error;
      note(error);
      const fallback = await local.get(planId);
      if (fallback) { located.set(planId, "local"); return { plan: fallback, where: "local" }; }
      throw error;
    }
    const fallback = await local.get(planId);
    if (fallback) located.set(planId, "local");
    return { plan: fallback, where: fallback ? "local" : "cloud" };
  }

  const target = async (planId: string): Promise<RevisionedPlanRepository> => {
    const known = located.get(planId) ?? (await find(planId)).where;
    return known === "cloud" ? cloud : local;
  };

  async function clearBrowser(keepSession: boolean) {
    if (deps.clearBrowser) return deps.clearBrowser({ keepSession });
    await local.clear();
    await clearLocalData({ keepSession });
  }

  return {
    storageMode: async () => (await mode()).mode,
    storageModeInfo: mode,
    locationOf: planId => located.get(planId) ?? null,
    cloudProblem: () => problem,

    async list() {
      const localPlans = await local.list().catch(error => {
        if (error instanceof StorageUnavailableError && error.code === "LOCAL_STORAGE_BLOCKED") return [];
        throw error;
      });
      localPlans.forEach(p => located.set(p.id, "local"));
      if (!(await isCloudMode())) return localPlans;
      try {
        const cloudPlans = await cloud.list();
        cloudPlans.forEach(p => located.set(p.id, "cloud"));
        problem = null;
        return [...cloudPlans, ...localPlans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      } catch (error) {
        if (!isCloudFailure(error)) throw error;
        note(error);
        return localPlans; // honest partial view; cloudProblem() explains what is missing
      }
    },
    async get(planId) {
      return (await find(planId)).plan;
    },
    async save(plan, expectedRevision) {
      if (expectedRevision === null) {
        if (!(await isCloudMode())) {
          const saved = await local.save(plan, null);
          located.set(saved.id, "local");
          return saved;
        }
        try {
          const saved = await cloud.save(plan, null);
          located.set(saved.id, "cloud");
          problem = null;
          return saved;
        } catch (error) {
          if (!isCloudFailure(error)) throw error;
          note(error);
          throw new CloudSaveFailedError("create", error);
        }
      }
      const repo = await target(plan.id);
      if (repo === local) return local.save(plan, expectedRevision);
      try {
        const saved = await cloud.save(plan, expectedRevision);
        problem = null;
        return saved;
      } catch (error) {
        if (!isCloudFailure(error)) throw error;
        note(error);
        throw new CloudSaveFailedError("update", error);
      }
    },
    async saveLocally(plan) {
      const saved = await local.save(plan, null);
      located.set(saved.id, "local");
      return saved;
    },
    async remove(planId) {
      await (await target(planId)).remove(planId);
      located.delete(planId);
    },
    async appendEvent(event: PlanEvent) {
      await (await target(event.planId)).appendEvent(event);
    },
    async listEvents(planId) {
      return (await target(planId)).listEvents(planId);
    },
    async listRevisions(planId) {
      return (await target(planId)).listRevisions(planId);
    },
    async clear() {
      const cloudMode = await isCloudMode();
      let cloudFailed = false;
      if (cloudMode) {
        try { await cloud.clear(); } catch (error) {
          if (!isCloudFailure(error)) throw error;
          cloudFailed = true;
        }
      }
      // Keep the guest session if the cloud copy still exists, so a retry can delete it.
      await clearBrowser(cloudFailed);
      located.clear();
      if (cloudFailed) throw new PartialClearError();
      if (cloudMode) await (deps.forgetSession ?? forgetCloudSession)();
      resolved = null;
      problem = null;
    },
  };
}

/** Removes Headroom keys from this browser: plans, demo unlock, UI drafts and (unless kept) the guest session token. */
export async function clearLocalData(options: { keepSession?: boolean } = {}): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (options.keepSession && key === "headroom:v1:auth") continue;
      // "headroom:" keys are storage/session/unlock; "headroom." keys are UI drafts and handoffs.
      if (key.startsWith("headroom:") || key.startsWith("headroom.") || key === LOCAL_STORAGE_KEY) keys.push(key);
    }
    keys.forEach(key => window.localStorage.removeItem(key));
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key && (key.startsWith("headroom:") || key.startsWith("headroom."))) window.sessionStorage.removeItem(key);
    }
  } catch { /* storage blocked: nothing stored */ }
}
