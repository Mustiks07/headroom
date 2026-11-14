import "server-only";
import { z } from "zod";
import type { HouseholdWorkspace } from "@/domain/household-workspace";
import { isSameSave, validateWorkspace } from "@/lib/client/workspace-integrity";
import { PlanIntegrityError } from "@/lib/client/errors";
import { HttpError, UUID_RE } from "./http";
import { dbFailure, type AuthenticatedOwner } from "./supabase";

export const CreateWorkspaceBodySchema = z.object({ workspace: z.unknown(), expectedRevision: z.null(), legacySnapshot: z.unknown().optional() });
export const UpdateWorkspaceBodySchema = z.object({ workspace: z.unknown(), expectedRevision: z.number().int().positive() });

interface Row { id: string; revision: number; payload: HouseholdWorkspace; created_at: string; updated_at: string }
const COLUMNS = "id, revision, payload, created_at, updated_at";
const NOT_FOUND = () => new HttpError(404, "WORKSPACE_NOT_FOUND", "This plan does not exist or is not available in this session.");

const fromRow = (r: Row): HouseholdWorkspace => ({ ...r.payload, id: r.id, revision: r.revision, createdAt: r.created_at, updatedAt: r.updated_at });

function checked(raw: unknown): HouseholdWorkspace {
  try { return validateWorkspace(raw); } catch (e) {
    if (e instanceof PlanIntegrityError) throw new HttpError(400, e.code, e.message, e.fields);
    throw e;
  }
}

export async function listWorkspaces({ db }: AuthenticatedOwner): Promise<HouseholdWorkspace[]> {
  const { data, error } = await db.from("workspaces").select(COLUMNS).order("updated_at", { ascending: false }).limit(50);
  if (error) dbFailure(error);
  return (data as Row[]).map(fromRow);
}

export async function getWorkspace({ db }: AuthenticatedOwner, id: string): Promise<HouseholdWorkspace> {
  if (!UUID_RE.test(id)) throw NOT_FOUND();
  const { data, error } = await db.from("workspaces").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) dbFailure(error);
  if (!data) throw NOT_FOUND();
  return fromRow(data as Row);
}

export async function createWorkspace(owner: AuthenticatedOwner, raw: unknown, legacySnapshot: unknown): Promise<HouseholdWorkspace> {
  const ws = checked(raw);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { data, error } = await owner.db.from("workspaces")
    .insert({ id, owner_id: owner.userId, revision: 1, payload: { ...ws, id, revision: 1, createdAt: now, updatedAt: now } })
    .select(COLUMNS).single();
  if (error) dbFailure(error);
  if (legacySnapshot !== undefined && legacySnapshot !== null) {
    const legacy = await owner.db.from("workspace_snapshots").insert({ workspace_id: id, owner_id: owner.userId, kind: "legacy_v1", revision: 0, payload: legacySnapshot });
    if (legacy.error) {
      // Never keep a migrated workspace without its original: undo the insert and report failure.
      await owner.db.from("workspaces").delete().eq("id", id);
      dbFailure(legacy.error);
    }
  }
  return fromRow(data as Row);
}

export async function updateWorkspace(owner: AuthenticatedOwner, id: string, raw: unknown, expectedRevision: number): Promise<HouseholdWorkspace> {
  const ws = checked(raw);
  const current = await getWorkspace(owner, id);
  if (current.revision !== expectedRevision) {
    if (isSameSave(current, { ...ws, id }, expectedRevision)) return current; // retried request that already landed
    throw Object.assign(new HttpError(409, "WORKSPACE_REVISION_CONFLICT", "This plan was changed somewhere else. Reload the latest version before saving again."), { current });
  }
  const archived = await owner.db.from("workspace_snapshots").upsert(
    { workspace_id: id, owner_id: owner.userId, kind: "revision", revision: current.revision, payload: current },
    { onConflict: "workspace_id,kind,revision", ignoreDuplicates: true });
  if (archived.error) dbFailure(archived.error);
  const next = expectedRevision + 1;
  const now = new Date().toISOString();
  const { data, error } = await owner.db.from("workspaces")
    .update({ revision: next, payload: { ...ws, id, revision: next, createdAt: current.createdAt, updatedAt: now }, updated_at: now })
    .eq("id", id).eq("revision", expectedRevision).select(COLUMNS);
  if (error) dbFailure(error);
  if (data && data.length === 1) return fromRow(data[0] as Row);
  const latest = await getWorkspace(owner, id);
  if (isSameSave(latest, { ...ws, id }, expectedRevision)) return latest;
  throw Object.assign(new HttpError(409, "WORKSPACE_REVISION_CONFLICT", "This plan was changed somewhere else. Reload the latest version before saving again."), { current: latest });
}

export async function deleteWorkspace({ db }: AuthenticatedOwner, id: string): Promise<void> {
  if (!UUID_RE.test(id)) throw NOT_FOUND();
  const { data, error } = await db.from("workspaces").delete().eq("id", id).select("id");
  if (error) dbFailure(error);
  if (!data?.length) throw NOT_FOUND();
}

export async function listWorkspaceSnapshots(owner: AuthenticatedOwner, id: string, kind: "revision" | "legacy_v1"): Promise<unknown[]> {
  await getWorkspace(owner, id);
  const { data, error } = await owner.db.from("workspace_snapshots").select("revision, payload")
    .eq("workspace_id", id).eq("kind", kind).order("revision", { ascending: false }).limit(20);
  if (error) dbFailure(error);
  return (data as Array<{ revision: number; payload: unknown }>).map(r => r.payload);
}
