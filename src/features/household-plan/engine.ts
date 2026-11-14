"use client";

import { buildHouseholdProjection, compareWorkspaceOpportunity, evaluateHouseholdWorkspace } from "@/lib/engine";
import type { TaxYear } from "@/domain/contracts";
import {
  sepPosition, type HouseholdProjectionResult, type HouseholdWorkspace, type SepYearStatus, type WorkspaceComparisonResult, type WorkspaceEvaluationResult,
} from "@/domain/household-workspace";

/**
 * Household calculations come from Claude 2's workspace engine (`@/lib/engine`). The UI performs
 * no tax or aggregation arithmetic; it only displays these results.
 */
export const projectHousehold = (w: HouseholdWorkspace): Promise<HouseholdProjectionResult> => buildHouseholdProjection(w);
export const evaluatePlan = (w: HouseholdWorkspace): Promise<WorkspaceEvaluationResult> => evaluateHouseholdWorkspace(w);
export const compareProject = (w: HouseholdWorkspace, projectId: string): Promise<WorkspaceComparisonResult> => compareWorkspaceOpportunity(w, projectId);

/** Engine evaluation details beyond the contract type (structural subtype, see Claude 2 handoff). */
export interface FixedPlanYear {
  year: TaxYear;
  risk: { magiCents: number; thresholdMagiCents: number; ptcCents: number; settlementCents: number; state: "below_cliff" | "at_risk" | "over_cliff" | "no_credit"; additionalProfitHeadroomCents: number | null } | null;
  legalSepLimitCents: number | null;
  problems: string[];
}
export interface FixedPlanDetails { notChecked: string[]; years: FixedPlanYear[]; pendingYears: Array<{ year: TaxYear; fields: Array<{ path: string; reason: string }> }> }
export function fixedPlanOf(e: WorkspaceEvaluationResult | undefined): FixedPlanDetails | null {
  return e && e.status === "ready" ? (e as unknown as { fixedPlan?: FixedPlanDetails }).fixedPlan ?? null : null;
}

/** SEP rows: the engine's when available (with legal limits), else goal / paid / left from the contract helper. */
export function sepRows(w: HouseholdWorkspace, e?: WorkspaceEvaluationResult): SepYearStatus[] {
  const relevant = (r: SepYearStatus) => r.targetCents !== null || r.paidCents > 0;
  if (e?.status === "ready") return e.sep.filter(relevant);
  const keys = new Set<string>();
  for (const t of w.retirement.targets) keys.add(`${t.personId}|${t.year}`);
  for (const c of w.retirement.contributions) keys.add(`${c.personId}|${c.taxYear}`);
  return [...keys].sort().map(k => {
    const [personId, y] = k.split("|"); const year = Number(y) as TaxYear;
    return { personId, year, ...sepPosition(w, personId, year), legalLimitCents: null };
  });
}
