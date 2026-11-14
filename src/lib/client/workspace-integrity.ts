import { canonicalWorkspaceContent, HouseholdWorkspaceSchema, type HouseholdWorkspace } from "@/domain/household-workspace";
import { PlanIntegrityError } from "./errors";

/** Validate a workspace with the shared contract; schema errors become PlanIntegrityError with paths. */
export function validateWorkspace(raw: unknown): HouseholdWorkspace {
  const parsed = HouseholdWorkspaceSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PlanIntegrityError("INVALID_WORKSPACE", "This household plan has invalid or inconsistent data.",
      parsed.error.issues.slice(0, 20).map(i => ({ path: i.path.join("."), reason: i.message })));
  }
  return parsed.data;
}

/**
 * True when `stored` is exactly the result of saving `attempt` at `expectedRevision` — i.e. a
 * retry after a lost acknowledgement. Same content, same event ids, revision expected + 1.
 */
export function isSameSave(stored: HouseholdWorkspace, attempt: HouseholdWorkspace, expectedRevision: number | null): boolean {
  if (expectedRevision === null || stored.revision !== expectedRevision + 1) return false;
  return stored.events.length === attempt.events.length && attempt.events.every(e => stored.events.some(s => s.id === e.id)) &&
    JSON.stringify(canonicalWorkspaceContent(stored)) === JSON.stringify(canonicalWorkspaceContent(attempt));
}
