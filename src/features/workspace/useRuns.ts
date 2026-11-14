"use client";

import type { CaseInput } from "@/domain/contracts";
import type { Problem } from "@/features/household/draft";

export type Outcome<T> =
  | { kind: "invalid"; problems: Problem[] }
  | { kind: "error"; message: string }
  | { kind: "done"; input: CaseInput; result: T };

export interface Run<T> {
  /** The person asked for this calculation at least once; edits re-run it. */
  requested: boolean;
  pending: boolean;
  /** Draft version the outcome belongs to. */
  version: number;
  outcome: Outcome<T> | null;
}

export const IDLE_RUN = { requested: false, pending: false, version: -1, outcome: null } as const;

export function isStale<T>(run: Run<T>, currentVersion: number) {
  return run.outcome !== null && run.version !== currentVersion;
}
