import { CaseInputSchema, type CaseInput, type ReadyComparison, type SavedPlan } from "@/domain/contracts";
import { calculateComparison } from "@/lib/engine";
import { PlanIntegrityError } from "./errors";

/**
 * Recompute a plan from its input with the shared engine and check it is still current.
 * Used by the local repository, the cloud API and the export route so that every mode has
 * the same rule: a stored or exported result always comes from a fresh engine run, never
 * from client-submitted numbers.
 */
export async function recomputeForPlan(input: unknown, chosenScenarioId: string, expectedFingerprint: string | null):
Promise<{ input: CaseInput; comparison: ReadyComparison }> {
  const parsed = CaseInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PlanIntegrityError("INVALID_INPUT", "The plan input is not valid.",
      parsed.error.issues.map(issue => ({ path: issue.path.join("."), reason: issue.message })));
  }
  const result = await calculateComparison(parsed.data);
  if (result.status !== "ready") {
    throw new PlanIntegrityError(`RESULT_${result.status.toUpperCase()}`, result.message, result.fields);
  }
  if (expectedFingerprint !== null && result.calculationFingerprint !== expectedFingerprint) {
    throw new PlanIntegrityError("STALE_RESULT",
      "These results are out of date for the current inputs. Recalculate before saving or exporting.");
  }
  const chosen = result.scenarios.find(s => s.id === chosenScenarioId);
  if (!chosen) {
    throw new PlanIntegrityError("UNKNOWN_SCENARIO", "The chosen option is not part of the current calculation.");
  }
  if (!chosen.feasible) {
    throw new PlanIntegrityError("INFEASIBLE_SCENARIO",
      "The chosen option is not available under your constraints. Choose another option.");
  }
  return { input: parsed.data, comparison: result };
}

/** Validate a plan before storage and return it with the authoritative, freshly computed comparison. */
export async function verifyPlanForSave(plan: SavedPlan): Promise<SavedPlan> {
  if (!plan || typeof plan !== "object" || !plan.comparison || typeof plan.comparison.calculationFingerprint !== "string") {
    throw new PlanIntegrityError("INVALID_PLAN", "The plan is missing its calculation result.");
  }
  const { input, comparison } = await recomputeForPlan(plan.input, plan.chosenScenarioId,
    plan.comparison.calculationFingerprint);
  const chosen = comparison.scenarios.find(s => s.id === plan.chosenScenarioId)!;
  const actionIds = new Set(chosen.actions.map(a => a.id));
  const completed = Array.isArray(plan.completedActionIds) ? plan.completedActionIds : [];
  if (completed.some(id => typeof id !== "string" || !actionIds.has(id))) {
    throw new PlanIntegrityError("UNKNOWN_ACTION", "A completed action does not belong to the chosen option.");
  }
  return { ...plan, input, comparison, completedActionIds: [...new Set(completed)] };
}
