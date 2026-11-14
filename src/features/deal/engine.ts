"use client";

import * as engine from "@/lib/engine";
import type { CashContext, DealGoal, DealPlanningEngine, DealSearchResult, DealTermsSpace, DealVariant, DecisionSensitivityResult } from "@/domain/deal-planning";
import type { HouseholdWorkspace } from "@/domain/household-workspace";

/**
 * Deal-term search and decision sensitivity come only from Claude 2's engine exports
 * (`searchDealTerms`, `evaluateDecisionSensitivity`). When a build doesn't export them yet, the UI
 * receives an explicit `unavailable` state — never a sample or invented result.
 */
const deal = engine as unknown as Partial<DealPlanningEngine>;
export const dealSearchAvailable = typeof deal.searchDealTerms === "function";

export async function searchTerms(ws: HouseholdWorkspace, goal: DealGoal, space: DealTermsSpace, cash: CashContext | null): Promise<DealSearchResult> {
  if (!deal.searchDealTerms) return { status: "unavailable", code: "DEAL_SEARCH_NOT_AVAILABLE",
    message: "Searching deal terms for a goal isn't available in this build yet. Your goal is saved; the standard comparison below still works.", fields: [] };
  return deal.searchDealTerms(ws, goal, space, cash);
}

export async function sensitivity(ws: HouseholdWorkspace, goal: DealGoal, variant: DealVariant, searchFingerprint: string): Promise<DecisionSensitivityResult> {
  if (!deal.evaluateDecisionSensitivity) return { status: "unavailable", code: "SENSITIVITY_NOT_AVAILABLE",
    message: "Checking what could change this answer isn't available in this build yet.", fields: [] };
  return deal.evaluateDecisionSensitivity(ws, goal, variant, searchFingerprint);
}
