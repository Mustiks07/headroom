import type { PlanRepository } from "@/domain/contracts";
import { createCloudPlanRepository } from "./cloud-repository";
import { forgetCloudSession, getCloudSession, lastCloudFailure } from "./cloud-session";
import { StorageUnavailableError } from "./errors";
import { createLocalPlanRepository, isLocalStorageAvailable, LOCAL_STORAGE_KEY } from "./local-repository";
import { publicSupabaseConfig } from "./public-config";

export type StorageMode = "cloud" | "local" | "unavailable";

export interface StorageModeInfo {
  mode: StorageMode;
  /** Truthful English label for the UI. */
  label: string;
  detail: string;
}

export interface HeadroomPlanRepository extends PlanRepository {
  /** Which storage this repository actually uses in this browser session. */
  storageMode(): Promise<StorageMode>;
  /** Same, with truthful English label/detail for the UI. */
  storageModeInfo(): Promise<StorageModeInfo>;
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

/**
 * The repository the UI uses. It chooses cloud storage only when Supabase is configured and an
 * invisible anonymous session succeeds; otherwise it uses versioned local browser storage.
 * It never pretends a cloud save happened.
 */
export function createPlanRepository(): HeadroomPlanRepository {
  const local = createLocalPlanRepository();
  const cloud = createCloudPlanRepository(async () => {
    const session = await getCloudSession();
    if (!session) throw new StorageUnavailableError("Cloud save is unavailable right now. Your entries are still on this page.", "CLOUD_UNAVAILABLE");
    return session.accessToken;
  });
  const target = async (): Promise<PlanRepository> => {
    const info = await getStorageMode();
    if (info.mode === "cloud") return cloud;
    return local; // in "unavailable" mode the local repository throws a truthful StorageUnavailableError
  };
  return {
    storageMode: async () => (await getStorageMode()).mode,
    storageModeInfo: getStorageMode,
    list: async () => (await target()).list(),
    get: async id => (await target()).get(id),
    save: async (plan, expectedRevision) => (await target()).save(plan, expectedRevision),
    remove: async id => (await target()).remove(id),
    appendEvent: async event => (await target()).appendEvent(event),
    listEvents: async planId => (await target()).listEvents(planId),
    async clear() {
      const info = await getStorageMode();
      if (info.mode === "cloud") await cloud.clear();
      await clearLocalData();
      if (info.mode === "cloud") await forgetCloudSession();
      resolved = null;
    },
  };
}

/** Removes every Headroom key from this browser: plans, demo unlock, unsent drafts, session token. */
export async function clearLocalData(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      // "headroom:" keys are storage/session/unlock; "headroom." keys are UI drafts and handoffs.
      if (key && (key.startsWith("headroom:") || key.startsWith("headroom.") || key === LOCAL_STORAGE_KEY)) keys.push(key);
    }
    keys.forEach(key => window.localStorage.removeItem(key));
    window.sessionStorage?.clear?.();
  } catch { /* storage blocked: nothing stored */ }
}
