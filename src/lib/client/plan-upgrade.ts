import type { BlockedComparison, PlanEvent, PlanRepository, ReadyComparison, SavedPlan, ScenarioResult } from "@/domain/contracts";
import { calculateComparison, calculationFingerprint, evaluateAgreedPlan, ENGINE_VERSION, RULES_VERSION, type AgreedPlanEvaluation } from "@/lib/engine";
import { PlanIntegrityError } from "./errors";
import { retainedCompletedActions } from "./completed-actions";

export interface VersionPair { engineVersion: string; rulesVersion: string }

export type PlanCurrency =
  | { status: "current" }
  /** Saved with an older engine or rule pack: needs an explicit review before save/export. */
  | { status: "outdated_rules"; saved: VersionPair; current: VersionPair }
  /** Same versions, but the stored result does not belong to the stored input (edited or damaged). */
  | { status: "fingerprint_mismatch"; saved: VersionPair; current: VersionPair };

export const CURRENT_VERSIONS: VersionPair = { engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION };

/** Is this saved plan still the current engine's answer for its own inputs? */
export async function checkPlanCurrency(plan: SavedPlan): Promise<PlanCurrency> {
  const saved = { engineVersion: plan.comparison.engineVersion, rulesVersion: plan.comparison.rulesVersion };
  if (saved.engineVersion !== ENGINE_VERSION || saved.rulesVersion !== RULES_VERSION) {
    return { status: "outdated_rules", saved, current: CURRENT_VERSIONS };
  }
  const fingerprint = await calculationFingerprint(plan.input);
  return fingerprint === plan.comparison.calculationFingerprint ? { status: "current" }
    : { status: "fingerprint_mismatch", saved, current: CURRENT_VERSIONS };
}

export interface FigureChange { label: string; beforeCents: number | null; afterCents: number | null }

export type PlanUpgradePreview =
  | { status: "blocked"; currency: PlanCurrency; result: BlockedComparison }
  | {
    status: "ready";
    currency: PlanCurrency;
    comparison: ReadyComparison;
    agreedEvaluation: AgreedPlanEvaluation | null;
    previousChoice: { id: string; label: string };
    /** The same option in the new calculation, when it still exists. */
    sameOption: { id: string; label: string; feasible: boolean; reasons: string[] } | null;
    /** Pre-selected only when the previous option is still available. Never silently replaced. */
    suggestedScenarioId: string | null;
    figures: FigureChange[];
    completedKept: string[];
    completedDropped: Array<{ id: string; title: string }>;
    newActions: Array<{ id: string; title: string; dueDate: string | null }>;
    feasibleOptions: Array<{ id: string; label: string; recommended: boolean }>;
  };

function figures(before: ScenarioResult | undefined, after: ScenarioResult | undefined): FigureChange[] {
  const pick = (s: ScenarioResult | undefined, f: (s: ScenarioResult) => number) => s ? f(s) : null;
  const rows: FigureChange[] = [
    { label: "Change in spendable cash, 2026 and 2027 combined, vs. declining", beforeCents: pick(before, s => s.twoYearCashDeltaCents), afterCents: pick(after, s => s.twoYearCashDeltaCents) },
    { label: "Added to retirement (not spendable cash)", beforeCents: pick(before, s => s.grossAdditionalRetirementCents), afterCents: pick(after, s => s.grossAdditionalRetirementCents) },
  ];
  for (const i of [0, 1] as const) {
    const year = before?.years[i].year ?? after?.years[i].year ?? (i === 0 ? 2026 : 2027);
    rows.push(
      { label: `${year} premium tax credit`, beforeCents: pick(before, s => s.years[i].ptcCents), afterCents: pick(after, s => s.years[i].ptcCents) },
      { label: `${year} settlement when filing (positive = repay)`, beforeCents: pick(before, s => s.years[i].aptcSettlementCents), afterCents: pick(after, s => s.years[i].aptcSettlementCents) },
      { label: `${year} federal income tax`, beforeCents: pick(before, s => s.years[i].federalIncomeTaxCents), afterCents: pick(after, s => s.years[i].federalIncomeTaxCents) },
      { label: `${year} spendable cash after settlement`, beforeCents: pick(before, s => s.years[i].spendableAfterSettlementCents), afterCents: pick(after, s => s.years[i].spendableAfterSettlementCents) },
    );
  }
  return rows;
}

/**
 * Recalculate a saved plan with the current engine and describe what would change. Nothing is
 * saved here. The previous choice is kept only if that option still exists and is feasible.
 */
export async function previewPlanUpgrade(plan: SavedPlan): Promise<PlanUpgradePreview> {
  const currency = await checkPlanCurrency(plan);
  const result = await calculateComparison(plan.input);
  if (result.status !== "ready") return { status: "blocked", currency, result };
  const previous = plan.comparison.scenarios.find(s => s.id === plan.chosenScenarioId);
  const agreedEvaluation = previous ? await evaluateAgreedPlan(plan.input, previous, previous) : null;
  const same = result.scenarios.find(s => s.id === plan.chosenScenarioId)
    ?? (previous ? result.scenarios.find(s => s.kind === previous.kind) : undefined);
  const suggested = same?.feasible ? same.id : null;
  const nextActions = same?.actions ?? [];
  const previousActions = new Map((previous?.actions ?? []).map(a => [a.id, a.title]));
  const completedKept = retainedCompletedActions(plan.completedActionIds, previous, same);
  return {
    status: "ready", currency, comparison: result, agreedEvaluation,
    previousChoice: { id: plan.chosenScenarioId, label: previous?.label ?? plan.chosenScenarioId },
    sameOption: same ? { id: same.id, label: same.label, feasible: same.feasible, reasons: same.infeasibilityReasons } : null,
    suggestedScenarioId: suggested,
    figures: figures(previous, same),
    completedKept,
    completedDropped: plan.completedActionIds.filter(id => !completedKept.includes(id))
      .map(id => ({ id, title: previousActions.get(id) ?? id })),
    newActions: nextActions.filter(a => !retainedCompletedActions([a.id], previous, same).length).map(a => ({ id: a.id, title: a.title, dueDate: a.dueDate })),
    feasibleOptions: result.scenarios.filter(s => s.feasible)
      .map(s => ({ id: s.id, label: s.label, recommended: s.id === result.recommendedScenarioId })),
  };
}

/**
 * Save the recalculated plan as the next revision after the user confirmed an option. The previous
 * revision stays in the repository's revision history and a "rules_updated" event is recorded.
 */
export async function confirmPlanUpgrade(repo: PlanRepository, plan: SavedPlan,
  preview: Extract<PlanUpgradePreview, { status: "ready" }>, chosenScenarioId: string): Promise<SavedPlan & { historyWarning?: string }> {
  const chosen = preview.comparison.scenarios.find(s => s.id === chosenScenarioId);
  if (!chosen?.feasible) throw new PlanIntegrityError("INFEASIBLE_SCENARIO", "Choose an option that is available in the updated calculation.");
  const previous = plan.comparison.scenarios.find(s => s.id === plan.chosenScenarioId);
  const completed = retainedCompletedActions(plan.completedActionIds, previous, chosen);
  const saved = await repo.save({ ...plan, comparison: preview.comparison, chosenScenarioId, completedActionIds: completed }, plan.revision);
  const from = `${plan.comparison.engineVersion} / ${plan.comparison.rulesVersion}`;
  const to = `${preview.comparison.engineVersion} / ${preview.comparison.rulesVersion}`;
  const event: PlanEvent = {
    id: crypto.randomUUID(), planId: saved.id, occurredAt: new Date().toISOString(), kind: "rules_updated",
    description: `Recalculated with ${to} (was ${from}). Option: ${chosen.label}${chosenScenarioId !== plan.chosenScenarioId ? ` (was ${preview.previousChoice.label})` : ""}.`,
    previousFingerprint: plan.comparison.calculationFingerprint, nextFingerprint: preview.comparison.calculationFingerprint,
  };
  try { await repo.appendEvent(event); }
  catch {
    // The revision was already committed. Do not invite a retry using the old revision.
    return { ...saved, historyWarning: "Plan saved with the current rules, but its history event could not be recorded. The previous revision is preserved." };
  }
  return saved;
}
