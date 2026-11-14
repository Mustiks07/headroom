import "server-only";
import type { PlanEvent, SavedPlan } from "@/domain/contracts";
import type { z } from "zod";
import { verifyPlanForSave } from "@/lib/client/plan-integrity";
import { PlanIntegrityError } from "@/lib/client/errors";
import { HttpError, UUID_RE } from "./http";
import type { PlanEventBodySchema, SubmittedPlanSchema } from "./schemas";
import { dbFailure, type AuthenticatedOwner } from "./supabase";

type SubmittedPlan = z.infer<typeof SubmittedPlanSchema>;
interface PlanRow { id: string; revision: number; payload: SavedPlan; created_at: string; updated_at: string }

const COLUMNS = "id, revision, payload, created_at, updated_at";
const LIST_LIMIT = 50;

function fromRow(row: PlanRow): SavedPlan {
  return { ...row.payload, id: row.id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

function assertId(id: string) {
  // Unknown ids and other owners' ids look identical: 404 without disclosure.
  if (!UUID_RE.test(id)) throw new HttpError(404, "PLAN_NOT_FOUND", "This plan does not exist or is not available in this session.");
}

/** Recompute with the shared engine; client-submitted numbers are replaced, never trusted. */
async function verified(plan: SubmittedPlan): Promise<SavedPlan> {
  try {
    return await verifyPlanForSave({
      id: plan.id ?? "", revision: plan.revision ?? 0, createdAt: "", updatedAt: "",
      input: plan.input as SavedPlan["input"], comparison: plan.comparison as unknown as SavedPlan["comparison"],
      chosenScenarioId: plan.chosenScenarioId, completedActionIds: plan.completedActionIds,
    });
  } catch (error) {
    if (error instanceof PlanIntegrityError) {
      const status = error.code === "INVALID_INPUT" ? 400 : error.code === "RESULT_UNAVAILABLE" ? 503 : 409;
      throw new HttpError(status, error.code, error.message, error.fields);
    }
    throw error;
  }
}

export async function listPlans({ db }: AuthenticatedOwner): Promise<SavedPlan[]> {
  const { data, error } = await db.from("plans").select(COLUMNS).order("updated_at", { ascending: false }).limit(LIST_LIMIT);
  if (error) dbFailure(error);
  return (data as PlanRow[]).map(fromRow);
}

export async function getPlan({ db }: AuthenticatedOwner, id: string): Promise<SavedPlan> {
  assertId(id);
  const { data, error } = await db.from("plans").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) dbFailure(error);
  if (!data) throw new HttpError(404, "PLAN_NOT_FOUND", "This plan does not exist or is not available in this session.");
  return fromRow(data as PlanRow);
}

export async function createPlan(owner: AuthenticatedOwner, submitted: SubmittedPlan): Promise<SavedPlan> {
  const plan = await verified(submitted);
  const id = crypto.randomUUID();
  const { id: _i, revision: _r, createdAt: _c, updatedAt: _u, ...payload } = plan;
  const { data, error } = await owner.db.from("plans")
    .insert({ id, owner_id: owner.userId, revision: 1, payload: { ...payload, id, revision: 1 } })
    .select(COLUMNS).single();
  if (error) dbFailure(error);
  return fromRow(data as PlanRow);
}

export async function updatePlan(owner: AuthenticatedOwner, id: string, submitted: SubmittedPlan,
  expectedRevision: number): Promise<SavedPlan> {
  assertId(id);
  const plan = await verified(submitted);
  const next = expectedRevision + 1;
  const { id: _i, revision: _r, createdAt: _c, updatedAt: _u, ...payload } = plan;
  const { data, error } = await owner.db.from("plans")
    .update({ revision: next, payload: { ...payload, id, revision: next }, updated_at: new Date().toISOString() })
    .eq("id", id).eq("revision", expectedRevision)
    .select(COLUMNS);
  if (error) dbFailure(error);
  if (data && data.length === 1) return fromRow(data[0] as PlanRow);
  // No row updated: either a newer revision exists (409) or the plan is not visible to this owner (404).
  const current = await getPlan(owner, id);
  throw Object.assign(new HttpError(409, "PLAN_REVISION_CONFLICT",
    "This plan was changed somewhere else. Reload the latest version before saving again."), { current });
}

export async function deletePlan({ db }: AuthenticatedOwner, id: string): Promise<void> {
  assertId(id);
  const { data, error } = await db.from("plans").delete().eq("id", id).select("id");
  if (error) dbFailure(error);
  if (!data || data.length === 0) throw new HttpError(404, "PLAN_NOT_FOUND", "This plan does not exist or is not available in this session.");
}

interface EventRow { id: string; plan_id: string; kind: PlanEvent["kind"]; payload: PlanEvent; occurred_at: string }

export async function listEvents(owner: AuthenticatedOwner, planId: string): Promise<PlanEvent[]> {
  await getPlan(owner, planId); // 404 for invisible plans
  const { data, error } = await owner.db.from("plan_events").select("id, plan_id, kind, payload, occurred_at")
    .eq("plan_id", planId).order("occurred_at", { ascending: true }).limit(500);
  if (error) dbFailure(error);
  return (data as EventRow[]).map(row => ({ ...row.payload, id: row.id, planId: row.plan_id, kind: row.kind, occurredAt: row.occurred_at }));
}

export async function appendEvent(owner: AuthenticatedOwner, planId: string,
  body: z.infer<typeof PlanEventBodySchema>): Promise<PlanEvent> {
  if (body.planId !== planId) throw new HttpError(400, "PLAN_ID_MISMATCH", "The event belongs to a different plan.");
  await getPlan(owner, planId);
  const id = UUID_RE.test(body.id) ? body.id : crypto.randomUUID();
  const occurredAt = body.occurredAt ?? new Date().toISOString();
  const event: PlanEvent = { ...body, id, planId, occurredAt };
  const { error } = await owner.db.from("plan_events")
    .upsert({ id, plan_id: planId, owner_id: owner.userId, kind: event.kind, payload: event, occurred_at: occurredAt },
      { onConflict: "id", ignoreDuplicates: true });
  if (error) dbFailure(error);
  return event;
}
