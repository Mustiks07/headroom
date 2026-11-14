"use client";

import type { HouseholdWorkspace, WorkspaceEvent } from "@/domain/household-workspace";
import {
  CloudSaveFailedError, HeadroomError, WorkspaceConflictError, commitWorkspaceChange, createWorkspaceRepository, type HybridWorkspaceRepository,
} from "@/lib/client/api";

/** Claude 3's workspace repository (browser storage, optional guest cloud). One instance per page load. */
let repo: HybridWorkspaceRepository | null = null;
export function workspaceRepo(): HybridWorkspaceRepository {
  if (!repo) repo = createWorkspaceRepository();
  return repo;
}

export function whereText(ws: HouseholdWorkspace): string {
  const loc = workspaceRepo().locationOf(ws.id);
  return loc === "cloud" ? "Saved to a private guest session for this browser. Not synced to other devices."
    : "Saved in this browser. Not synced to other devices.";
}

/** The event this edit added (ops append exactly one, with a stable id). */
export function addedEvent(base: HouseholdWorkspace, next: HouseholdWorkspace): WorkspaceEvent | undefined {
  return next.events.find(e => !base.events.some(x => x.id === e.id));
}

/** Atomic save of the change and its history event; retrying with the same `next` never writes twice. */
export async function commit(base: HouseholdWorkspace, next: HouseholdWorkspace): Promise<HouseholdWorkspace> {
  const event = addedEvent(base, next);
  if (!event) throw new Error("This change has no history entry.");
  return (await commitWorkspaceChange(workspaceRepo(), base, next, event)).saved;
}

export function describeSaveError(e: unknown): string {
  if (e instanceof WorkspaceConflictError) return "This plan was changed somewhere else (maybe another tab). The latest saved version is shown; make your change again.";
  if (e instanceof CloudSaveFailedError) return "The cloud save didn't go through, so this change isn't saved yet. Try again, or keep a copy in this browser.";
  if (e instanceof HeadroomError) return `This change isn't saved yet: ${e.message}`;
  return `This change isn't saved yet: ${e instanceof Error ? e.message : String(e)}`;
}

export { CloudSaveFailedError, WorkspaceConflictError };
