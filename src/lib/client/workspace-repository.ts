import { withEvent, type HouseholdWorkspace, type WorkspaceEvent } from "@/domain/household-workspace";
import { getCloudSession } from "./cloud-session";
import { HeadroomError, StorageUnavailableError } from "./errors";
import { apiFetch, errorFromResponse, readJson } from "./http";
import type { KeyValueStore } from "./local-repository";
import { isSameSave, validateWorkspace } from "./workspace-integrity";
import { CloudSaveFailedError, getStorageMode, type PlanLocation, type StorageModeInfo } from "./repository";

export const WORKSPACE_STORAGE_KEY = "headroom:v2:workspaces";
const MAX_REVISIONS = 20;

/** A newer revision exists; nothing was overwritten. `current` is the stored workspace. */
export class WorkspaceConflictError extends HeadroomError {
  constructor(public readonly current: HouseholdWorkspace | null) {
    super("WORKSPACE_REVISION_CONFLICT", "This plan was changed somewhere else. Reload the latest version before saving again.", 409);
    this.name = "WorkspaceConflictError";
  }
}

export interface WorkspaceRepository {
  list(): Promise<HouseholdWorkspace[]>;
  get(id: string): Promise<HouseholdWorkspace | null>;
  /**
   * Atomic save of the whole document, including any new events inside it. `expectedRevision`
   * null creates revision 1 (with a new id). A retry of a save that already reached storage
   * (same content and same event ids at revision expected+1) returns the stored revision.
   */
  save(ws: HouseholdWorkspace, expectedRevision: number | null, options?: { legacySnapshot?: unknown }): Promise<HouseholdWorkspace>;
  listRevisions(id: string): Promise<HouseholdWorkspace[]>;
  /** The original v1 plan/JSON kept when a workspace was migrated (null if none). */
  getLegacySnapshot(id: string): Promise<unknown | null>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export { isSameSave, validateWorkspace };

interface LocalState {
  version: 2;
  workspaces: Record<string, HouseholdWorkspace>;
  revisions: Record<string, HouseholdWorkspace[]>;
  legacy: Record<string, unknown>;
}

function browserStore(): KeyValueStore | null {
  try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch { return null; }
}

/** Versioned per-browser workspace storage (survives reloads; no in-memory substitute). */
export function createLocalWorkspaceRepository(options: { store?: KeyValueStore; now?: () => Date; newId?: () => string } = {}): WorkspaceRepository {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const store = () => {
    const s = options.store ?? browserStore();
    if (!s) throw new StorageUnavailableError("This browser is blocking local storage, so the plan cannot be saved here. Export it as JSON instead.", "LOCAL_STORAGE_BLOCKED");
    return s;
  };
  const read = (): LocalState => {
    const raw = store().getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return { version: 2, workspaces: {}, revisions: {}, legacy: {} };
    try {
      const s = JSON.parse(raw) as LocalState;
      if (s.version !== 2 || typeof s.workspaces !== "object") throw new Error("format");
      return { ...s, revisions: s.revisions ?? {}, legacy: s.legacy ?? {} };
    } catch {
      // Keep unreadable data for recovery; never silently discard it.
      try { store().setItem(`${WORKSPACE_STORAGE_KEY}:unreadable`, raw); } catch { /* best effort */ }
      store().removeItem(WORKSPACE_STORAGE_KEY);
      return { version: 2, workspaces: {}, revisions: {}, legacy: {} };
    }
  };
  const write = (s: LocalState) => {
    try { store().setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(s)); }
    catch (e) {
      if (e instanceof StorageUnavailableError) throw e;
      throw new StorageUnavailableError("This browser has no room left to save the plan. Delete an older plan or export it as JSON.", "LOCAL_STORAGE_FULL");
    }
  };

  return {
    async list() {
      return Object.values(read().workspaces).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(w => structuredClone(w));
    },
    async get(id) {
      const w = read().workspaces[id];
      return w ? structuredClone(w) : null;
    },
    async save(attempt, expectedRevision, opts = {}) {
      const ws = validateWorkspace(attempt);
      const state = read();
      const t = now().toISOString();
      let saved: HouseholdWorkspace;
      if (expectedRevision === null) {
        saved = { ...ws, id: newId(), revision: 1, createdAt: t, updatedAt: t };
        if (opts.legacySnapshot !== undefined) state.legacy[saved.id] = opts.legacySnapshot;
      } else {
        const current = state.workspaces[ws.id];
        if (!current) throw new WorkspaceConflictError(null);
        if (current.revision !== expectedRevision) {
          if (isSameSave(current, ws, expectedRevision)) return structuredClone(current);
          throw new WorkspaceConflictError(structuredClone(current));
        }
        saved = { ...ws, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: t };
        state.revisions[ws.id] = [...(state.revisions[ws.id] ?? []), current].slice(-MAX_REVISIONS);
      }
      state.workspaces[saved.id] = saved;
      write(state);
      return structuredClone(saved);
    },
    async listRevisions(id) {
      return [...(read().revisions[id] ?? [])].sort((a, b) => b.revision - a.revision).map(w => structuredClone(w));
    },
    async getLegacySnapshot(id) {
      const s = read().legacy[id];
      return s === undefined ? null : structuredClone(s);
    },
    async remove(id) {
      const s = read();
      delete s.workspaces[id]; delete s.revisions[id]; delete s.legacy[id];
      write(s);
    },
    async clear() {
      store().removeItem(WORKSPACE_STORAGE_KEY);
      store().removeItem(`${WORKSPACE_STORAGE_KEY}:unreadable`);
    },
  };
}

/** Cloud workspace repository over /api/workspaces (owner from the verified guest token). */
export function createCloudWorkspaceRepository(getToken: () => Promise<string>): WorkspaceRepository {
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await apiFetch(path, { ...init, token: await getToken(), headers: init.body ? { "Content-Type": "application/json" } : undefined });
    if (response.status >= 500 || response.status === 401) {
      const error = await errorFromResponse(response);
      throw new StorageUnavailableError(response.status === 401 ? "The cloud guest session has expired or is invalid." : "Cloud save is unavailable right now.", error.code, response.status);
    }
    return response;
  };
  const enc = encodeURIComponent;
  return {
    async list() { return (await readJson<{ workspaces: HouseholdWorkspace[] }>(await call("/api/workspaces"))).workspaces; },
    async get(id) {
      const r = await call(`/api/workspaces/${enc(id)}`);
      if (r.status === 404) return null;
      return (await readJson<{ workspace: HouseholdWorkspace }>(r)).workspace;
    },
    async save(ws, expectedRevision, opts = {}) {
      const r = expectedRevision === null
        ? await call("/api/workspaces", { method: "POST", body: JSON.stringify({ workspace: ws, expectedRevision: null, legacySnapshot: opts.legacySnapshot ?? null }) })
        : await call(`/api/workspaces/${enc(ws.id)}`, { method: "PUT", body: JSON.stringify({ workspace: ws, expectedRevision }) });
      if (r.status === 409) {
        const body = await r.clone().json().catch(() => ({}));
        if (body?.error?.code === "WORKSPACE_REVISION_CONFLICT") throw new WorkspaceConflictError(body.current ?? null);
        throw await errorFromResponse(r);
      }
      if (r.status === 404) throw new WorkspaceConflictError(null);
      return (await readJson<{ workspace: HouseholdWorkspace }>(r)).workspace;
    },
    async listRevisions(id) { return (await readJson<{ revisions: HouseholdWorkspace[] }>(await call(`/api/workspaces/${enc(id)}/revisions`))).revisions; },
    async getLegacySnapshot(id) {
      const r = await call(`/api/workspaces/${enc(id)}/revisions?legacy=1`);
      return (await readJson<{ legacySnapshot: unknown | null }>(r)).legacySnapshot;
    },
    async remove(id) {
      const r = await call(`/api/workspaces/${enc(id)}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) throw await errorFromResponse(r);
    },
    async clear() {
      const r = await call("/api/data", { method: "DELETE" });
      if (!r.ok) throw await errorFromResponse(r);
    },
  };
}

const isCloudFailure = (e: unknown): e is HeadroomError =>
  e instanceof StorageUnavailableError || (e instanceof HeadroomError && (e.status === 401 || (e.status ?? 0) >= 500));

export interface HybridWorkspaceRepository extends WorkspaceRepository {
  storageModeInfo(): Promise<StorageModeInfo>;
  locationOf(id: string): PlanLocation | null;
  /** Explicit local copy after a cloud failure (new id; the cloud version is untouched). */
  saveLocally(ws: HouseholdWorkspace, options?: { legacySnapshot?: unknown }): Promise<HouseholdWorkspace>;
  cloudProblem(): string | null;
}

/**
 * Same location rules as plans: new workspaces go to the cloud only with a working guest session;
 * a workspace stays where it lives; a cloud failure is never reported as a save
 * (`CloudSaveFailedError`) and the UI may offer `saveLocally` or JSON export.
 */
export function createWorkspaceRepository(deps: { local?: WorkspaceRepository; cloud?: WorkspaceRepository; mode?: () => Promise<StorageModeInfo> } = {}): HybridWorkspaceRepository {
  const local = deps.local ?? createLocalWorkspaceRepository();
  const cloud = deps.cloud ?? createCloudWorkspaceRepository(async () => {
    const s = await getCloudSession();
    if (!s) throw new StorageUnavailableError("Cloud save is unavailable right now.", "CLOUD_UNAVAILABLE");
    return s.accessToken;
  });
  const mode = deps.mode ?? getStorageMode;
  const located = new Map<string, PlanLocation>();
  let problem: string | null = null;
  const note = (e: HeadroomError) => { problem = `Cloud save isn't reachable right now (${e.message.replace(/\.$/, "")}). Plans saved in this browser are still available.`; };
  const cloudMode = async () => (await mode()).mode === "cloud";

  async function where(id: string): Promise<PlanLocation> {
    const known = located.get(id);
    if (known) return known;
    if (!(await cloudMode()) || await local.get(id)) { located.set(id, "local"); return "local"; }
    located.set(id, "cloud");
    return "cloud";
  }
  const repoFor = async (id: string) => (await where(id)) === "cloud" ? cloud : local;

  async function cloudCall<T>(fn: () => Promise<T>, operation?: "create" | "update"): Promise<T> {
    try { const r = await fn(); problem = null; return r; }
    catch (e) {
      if (!isCloudFailure(e)) throw e;
      note(e);
      if (operation) throw new CloudSaveFailedError(operation, e);
      throw e;
    }
  }

  return {
    storageModeInfo: mode,
    locationOf: id => located.get(id) ?? null,
    cloudProblem: () => problem,
    async list() {
      const mine = await local.list();
      mine.forEach(w => located.set(w.id, "local"));
      if (!(await cloudMode())) return mine;
      try {
        const remote = await cloudCall(() => cloud.list());
        remote.forEach(w => located.set(w.id, "cloud"));
        return [...remote, ...mine].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      } catch (e) { if (isCloudFailure(e)) return mine; throw e; }
    },
    async get(id) {
      if ((await where(id)) === "local") return local.get(id);
      try { return await cloudCall(() => cloud.get(id)); }
      catch (e) {
        if (!isCloudFailure(e)) throw e;
        const fallback = await local.get(id);
        if (fallback) { located.set(id, "local"); return fallback; }
        throw e;
      }
    },
    async save(ws, expectedRevision, opts) {
      if (expectedRevision === null) {
        if (!(await cloudMode())) { const s = await local.save(ws, null, opts); located.set(s.id, "local"); return s; }
        const s = await cloudCall(() => cloud.save(ws, null, opts), "create");
        located.set(s.id, "cloud");
        return s;
      }
      const repo = await repoFor(ws.id);
      return repo === local ? local.save(ws, expectedRevision, opts) : cloudCall(() => cloud.save(ws, expectedRevision, opts), "update");
    },
    async saveLocally(ws, opts) {
      const s = await local.save({ ...ws, revision: 0 }, null, opts);
      located.set(s.id, "local");
      return s;
    },
    async listRevisions(id) { return (await repoFor(id)).listRevisions(id); },
    async getLegacySnapshot(id) { return (await repoFor(id)).getLegacySnapshot(id); },
    async remove(id) { await (await repoFor(id)).remove(id); located.delete(id); },
    async clear() {
      // Plans and workspaces are cleared together by the plan repository's clear(); this only removes local workspaces.
      await local.clear();
      located.clear();
    },
  };
}

export type WorkspaceSaveOutcome = { saved: HouseholdWorkspace; event: WorkspaceEvent };

/**
 * Apply one user change and its history event in a single atomic save. Pass the SAME `event.id`
 * when retrying after an unknown outcome (e.g. a timeout): a save that already landed is
 * recognised and returned instead of being written twice.
 */
export async function commitWorkspaceChange(repo: WorkspaceRepository, base: HouseholdWorkspace,
  next: HouseholdWorkspace, event: WorkspaceEvent): Promise<WorkspaceSaveOutcome> {
  const draft = withEvent({ ...next, id: base.id, revision: base.revision }, event);
  const saved = await repo.save(draft, base.revision === 0 ? null : base.revision);
  return { saved, event };
}

/** New stable event (id generated once by the caller, reused on retries). */
export function newWorkspaceEvent(kind: WorkspaceEvent["kind"], description: string, refs: WorkspaceEvent["refs"] = {},
  fingerprints: { previous?: string | null; next?: string | null } = {}): WorkspaceEvent {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), kind, description, refs,
    previousFingerprint: fingerprints.previous ?? null, nextFingerprint: fingerprints.next ?? null };
}
