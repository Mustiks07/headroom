import type { SavedPlan } from "@/domain/contracts";

/** Base class for Headroom client/server integration errors. `code` is stable; `message` is English UI copy. */
export class HeadroomError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(message);
    this.name = "HeadroomError";
  }
}

/** The stored plan has a newer revision than the caller expected. Nothing was overwritten. */
export class PlanConflictError extends HeadroomError {
  constructor(public readonly current: SavedPlan | null) {
    super("PLAN_REVISION_CONFLICT",
      "This plan was changed somewhere else. Reload the latest version before saving again.", 409);
    this.name = "PlanConflictError";
  }
}

/** The plan cannot be saved/exported as a current result (stale fingerprint, blocked engine result, bad scenario...). */
export class PlanIntegrityError extends HeadroomError {
  constructor(code: string, message: string, public readonly fields: Array<{ path: string; reason: string }> = []) {
    super(code, message, 409);
    this.name = "PlanIntegrityError";
  }
}

/** Storage could not be reached or written. The caller's in-memory form data is untouched. */
export class StorageUnavailableError extends HeadroomError {
  constructor(message: string, code = "STORAGE_UNAVAILABLE", status?: number) {
    super(code, message, status);
    this.name = "StorageUnavailableError";
  }
}
