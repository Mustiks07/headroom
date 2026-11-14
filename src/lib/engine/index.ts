import { CONTRACT_VERSION, type CaseInput, type ComparisonResult, type RiskAssessment, type ScenarioResult, type BlockedComparison } from "@/domain/contracts";
import { AgreedPlanSchema, evaluateAgreed, type AgreedPlan, type AgreedPlanOutcome } from "./agreed";
import { calculationFingerprint, modelWarnings, stopToBlocked } from "./common";
import { compare } from "./comparison";
import { buildYearModel, checkOpportunity, Issues, parseCase } from "./guard";
import { EngineStop } from "./model";
import { ENGINE_VERSION, RULES_VERSION } from "./rules";
import { assessRisk } from "./risk";

export { ENGINE_VERSION, RULES_VERSION } from "./rules";
export { calculationFingerprint } from "./common";
export * from "./household";
export * from "./deal";
export * from "./assist";
export type { AgreedPlan, AgreedPlanChange, AgreedPlanOutcome } from "./agreed";

export { AT_RISK_SHARE } from "./risk";

/** Current-year check: needs no new project and no next-year forecast. */
export async function assessCurrentRisk(raw: CaseInput): Promise<RiskAssessment> {
  return assessRisk(raw);
}

/** Two-year comparison of feasible actions. Pure: no network, AI, clock or storage. */
export async function calculateComparison(raw: CaseInput): Promise<ComparisonResult> {
  const issues = new Issues();
  const input = parseCase(raw, issues);
  const m0 = input ? buildYearModel(input, 0, issues) : null;
  const m1 = input ? buildYearModel(input, 1, issues) : null;
  if (input) checkOpportunity(input, issues);
  const blocked = issues.toBlocked();
  if (blocked || !input || !m0 || !m1) return blocked!;
  try {
    const out = compare(input, [m0, m1]);
    return {
      status: "ready", contractVersion: CONTRACT_VERSION, engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION,
      calculationFingerprint: await calculationFingerprint(input), caseId: input.id,
      baselineScenarioId: out.baselineScenarioId, recommendedScenarioId: out.recommendedScenarioId,
      scenarios: out.scenarios, warnings: [...modelWarnings([m0, m1], input), ...out.warnings],
    };
  } catch (e) {
    if (e instanceof EngineStop) return stopToBlocked(e, "years");
    throw e;
  }
}

export interface ReadyAgreedPlanEvaluation extends AgreedPlanOutcome {
  status: "ready";
  engineVersion: string;
  rulesVersion: string;
  calculationFingerprint: string;
  caseId: string;
}
export type AgreedPlanEvaluation = ReadyAgreedPlanEvaluation | BlockedComparison;

/**
 * Re-evaluate an agreed plan's fixed decisions (receipts, expenses, SEP) on the current
 * facts, without re-optimizing. Pass the previously saved scenario to get the changes.
 * Call calculateComparison separately to see new options.
 */
export async function evaluateAgreedPlan(raw: CaseInput, plan: AgreedPlan, previous: ScenarioResult | null = null): Promise<AgreedPlanEvaluation> {
  const checked = AgreedPlanSchema.safeParse(plan);
  if (!checked.success) return {
    status: "needs_data", code: "INVALID_AGREED_PLAN", message: "The saved payment arrangements need review before they can be calculated.",
    fields: checked.error.issues.map(i => ({ path: `agreedPlan.${i.path.join(".")}`, reason: i.message })),
  };
  plan = checked.data;
  const issues = new Issues();
  const input = parseCase(raw, issues);
  const m0 = input ? buildYearModel(input, 0, issues) : null;
  const m1 = input ? buildYearModel(input, 1, issues) : null;
  if (input && plan.decisions.receipts.some(r => r.amountCents > 0)) checkOpportunity(input, issues);
  const blocked = issues.toBlocked();
  if (blocked || !input || !m0 || !m1) return blocked!;
  try {
    const out = evaluateAgreed(input, [m0, m1], plan, previous);
    return { status: "ready", engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION,
      calculationFingerprint: await calculationFingerprint(input), caseId: input.id, ...out,
      warnings: [...modelWarnings([m0, m1], input), ...out.warnings] };
  } catch (e) {
    if (e instanceof EngineStop) return stopToBlocked(e, "years");
    throw e;
  }
}
