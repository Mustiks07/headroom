import {
  dealSearchFingerprint, emptyDealPlanning, isPackageCurrent, type ActionPackage, type CashContext, type DealGoal, type DealPlanningState, type DealTermsSpace, type Reminder,
} from "@/domain/deal-planning";
import type { HouseholdWorkspace, WorkspaceEvent } from "@/domain/household-workspace";
import { engineWorkspaceFingerprint, ENGINE_VERSION, RULES_VERSION } from "@/lib/engine";
import { commitWorkspaceChange, newWorkspaceEvent, type WorkspaceRepository, type WorkspaceSaveOutcome } from "./workspace-repository";
import { ensureOriginalOffer } from "./workspace-commands";

/**
 * Persistence operations for round 4 deal planning. Every change is one atomic workspace save
 * with its history event inside. Pass the same `event` again to retry after an unknown outcome:
 * a save that already landed is returned, not repeated.
 */

function withDeal(ws: HouseholdWorkspace, mutate: (dp: DealPlanningState) => void): HouseholdWorkspace {
  const next = structuredClone(ws);
  next.dealPlanning ??= emptyDealPlanning();
  mutate(next.dealPlanning);
  return next;
}

const upsert = <T>(xs: T[], item: T, same: (a: T) => boolean) => { const i = xs.findIndex(same); if (i >= 0) xs[i] = item; else xs.push(item); };

/** Save (create or replace) a goal and optionally the project's allowed terms. */
export async function saveDealGoal(repo: WorkspaceRepository, ws: HouseholdWorkspace, goal: DealGoal, space?: DealTermsSpace,
  event: WorkspaceEvent = newWorkspaceEvent("deal_planning_updated", "Updated the goal and allowed terms for a project.", { projectId: goal.projectId })): Promise<WorkspaceSaveOutcome> {
  return commitWorkspaceChange(repo, ws, withDeal(ws, dp => {
    upsert(dp.goals, goal, g => g.id === goal.id);
    if (space) upsert(dp.termSpaces, space, t => t.projectId === space.projectId);
  }), event);
}

/** Save or clear the household cash context. */
export async function saveCashContext(repo: WorkspaceRepository, ws: HouseholdWorkspace, cash: CashContext | null,
  event: WorkspaceEvent = newWorkspaceEvent("deal_planning_updated", cash ? "Updated the dated cash picture." : "Removed the dated cash picture.")): Promise<WorkspaceSaveOutcome> {
  return commitWorkspaceChange(repo, ws, withDeal(ws, dp => { dp.cashContext = cash; }), event);
}

/**
 * Save an action package (from `buildActionPackage` on a FRESH result). Older packages for the
 * same project become `superseded`; saving the same package again is idempotent.
 */
export async function saveActionPackage(repo: WorkspaceRepository, ws: HouseholdWorkspace, pkg: ActionPackage,
  event: WorkspaceEvent = newWorkspaceEvent("deal_package_saved", `Saved chosen terms: ${pkg.variant.label}.`, { projectId: pkg.projectId })): Promise<WorkspaceSaveOutcome> {
  return commitWorkspaceChange(repo, ws, withDeal(ws, dp => {
    for (const other of dp.packages) if (other.projectId === pkg.projectId && other.id !== pkg.id && other.status !== "superseded") other.status = "superseded";
    upsert(dp.packages, pkg, p => p.id === pkg.id);
    dp.packages = dp.packages.slice(-30);
  }), event);
}

/**
 * Status changes are made only by the user ("I sent the terms", "the client agreed"). Headroom
 * never marks a package as agreed by itself.
 */
export async function setPackageStatus(repo: WorkspaceRepository, ws: HouseholdWorkspace, packageId: string, status: "terms_shared_by_user" | "client_agreed",
  event?: WorkspaceEvent): Promise<WorkspaceSaveOutcome> {
  const pkg = ws.dealPlanning?.packages.find(p => p.id === packageId);
  if (!pkg) throw new Error("This package is not in the plan.");
  if (pkg.status === "superseded") throw new Error("These terms were replaced by a newer choice.");
  const next = withDeal(ws, dp => { dp.packages.find(p => p.id === packageId)!.status = status; });
  appendDecisionRecord(next, ws, pkg, status); // historical record with the decision-time snapshot
  return commitWorkspaceChange(repo, ws, next,
    event ?? newWorkspaceEvent("deal_status_changed", status === "client_agreed" ? `You recorded that the client agreed to: ${pkg.variant.label}.` : `You recorded that you shared the terms: ${pkg.variant.label}.`, { projectId: pkg.projectId }));
}

/** Mark one reminder done/open/cancelled (by the user). */
export async function setReminderStatus(repo: WorkspaceRepository, ws: HouseholdWorkspace, packageId: string, uid: string, status: Reminder["status"],
  event: WorkspaceEvent = newWorkspaceEvent("deal_status_changed", `Marked a plan action as ${status}.`)): Promise<WorkspaceSaveOutcome> {
  return commitWorkspaceChange(repo, ws, withDeal(ws, dp => {
    const r = dp.packages.find(p => p.id === packageId)?.reminders.find(x => x.uid === uid);
    if (!r) throw new Error("This action is not in the package.");
    r.status = status;
  }), event);
}

/** Fresh search fingerprint for a goal (null when the goal or its terms space is missing). */
export async function currentSearchFingerprint(ws: HouseholdWorkspace, goalId: string): Promise<string | null> {
  const dp = ws.dealPlanning;
  const goal = dp?.goals.find(g => g.id === goalId);
  const space = goal && dp?.termSpaces.find(t => t.projectId === goal.projectId);
  if (!goal || !space) return null;
  return dealSearchFingerprint(await engineWorkspaceFingerprint(ws), goal, space, dp!.cashContext, ENGINE_VERSION, RULES_VERSION);
}

/** Is a saved package still the current answer for the plan's facts, goal, terms and cash context? */
export async function packageCurrency(ws: HouseholdWorkspace, pkg: ActionPackage): Promise<{ current: boolean; reason: string | null }> {
  if (pkg.status === "superseded") return { current: false, reason: "These terms were replaced by a newer choice." };
  const fresh = await currentSearchFingerprint(ws, pkg.goalId);
  if (!fresh) return { current: false, reason: "The goal or allowed terms for this project were removed." };
  if (!isPackageCurrent(pkg, fresh)) return { current: false, reason: "Facts, the goal, the allowed terms or the cash picture changed since these terms were calculated. Search again before using or exporting them." };
  return { current: true, reason: null };
}

/* ------------------------------------------------------------------ decision records and current calendar (round 5) */

/**
 * Add the historical record of a decision to `next` (the workspace AFTER the status edit), using
 * `before` (the decision-time workspace) as its own snapshot. Idempotent per package + status.
 * The record keeps its original fingerprint and figures; later facts never rewrite it.
 */
export function appendDecisionRecord(next: HouseholdWorkspace, before: HouseholdWorkspace, pkg: ActionPackage,
  status: "terms_shared_by_user" | "client_agreed", at = new Date().toISOString()): void {
  next.dealPlanning ??= emptyDealPlanning();
  const id = `rec-${pkg.id}-${status === "client_agreed" ? "agreed" : "shared"}`.slice(0, 120);
  const records = next.dealPlanning.decisionRecords ??= [];
  if (records.some(r => r.id === id)) return;
  const dp = before.dealPlanning;
  const goal = dp?.goals.find(g => g.id === pkg.goalId);
  const space = dp?.termSpaces.find(t => t.projectId === pkg.projectId);
  if (!goal || !space) return;
  // Keep the client's first offer: captured from the decision-time lines if it was never recorded.
  ensureOriginalOffer(next, pkg.projectId, at, { kind: "existing_project", sourceId: null }, "captured", before.projects.find(p => p.id === pkg.projectId));
  const originalOffer = next.projects.find(p => p.id === pkg.projectId)?.originalOffer ?? null;
  const snapshot = structuredClone(before) as Record<string, unknown>;
  delete snapshot.dealPlanning;
  records.push({ id, packageId: pkg.id, projectId: pkg.projectId, status, recordedAt: at, workspaceRevision: before.revision,
    searchFingerprint: pkg.searchFingerprint, engineVersion: pkg.engineVersion, rulesVersion: pkg.rulesVersion,
    workspaceSnapshot: snapshot, goal: structuredClone(goal), termSpace: structuredClone(space),
    cashContext: dp?.cashContext ? structuredClone(dp.cashContext) : null, variant: structuredClone(pkg.variant),
    ...(pkg.decisionContext ? { decisionContext: { ...structuredClone(pkg.decisionContext), originalOffer: pkg.decisionContext.originalOffer ?? originalOffer } } : {}) });
  next.dealPlanning.decisionRecords = records.slice(-30);
}

/**
 * Download the CURRENT plan calendar and remember what was issued (one atomic save), so the next
 * download updates moved events and cancels ones that no longer apply. Returns the .ics Blob.
 */
export async function exportCurrentCalendar(repo: WorkspaceRepository, ws: HouseholdWorkspace, now = new Date()): Promise<{ blob: Blob; saved: HouseholdWorkspace; active: number; cancelled: number }> {
  const { buildCurrentCalendar } = await import("./deal-exports");
  const { ics, issued, active, cancelled } = buildCurrentCalendar(ws, now);
  const next = withDeal(ws, dp => { dp.calendar = { issued }; });
  const { saved } = await commitWorkspaceChange(repo, ws, next, newWorkspaceEvent("deal_planning_updated", `Downloaded the plan calendar (${active} current, ${cancelled} cancelled).`));
  return { blob: new Blob([ics], { type: "text/calendar;charset=utf-8" }), saved, active, cancelled };
}
