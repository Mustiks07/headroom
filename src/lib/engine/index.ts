import { CONTRACT_VERSION, type BlockedComparison, type CaseInput, type ComparisonResult, type CurrentRisk,
  type RiskAssessment, type ScenarioResult } from "@/domain/contracts";
import { evaluateAgreed, type AgreedPlan, type AgreedPlanOutcome } from "./agreed";
import { compare } from "./comparison";
import { buildYearModel, checkOpportunity, Issues, parseCase } from "./guard";
import { formatUsd } from "./money";
import { EngineStop, NO_VARIATION, type YearModel } from "./model";
import { ENGINE_VERSION, RULES_VERSION } from "./rules";
import { profitHeadroomDollars } from "./search";
import { UNCERTAINTY_SCALE, hasRanges, modelAt } from "./uncertainty";
import { creditTrace, evaluateYear, solveCredit } from "./year";

export { ENGINE_VERSION, RULES_VERSION } from "./rules";
export type { AgreedPlan, AgreedPlanChange, AgreedPlanOutcome } from "./agreed";

/** Share of the 400% threshold below which remaining profit headroom is labelled "at risk". */
export const AT_RISK_SHARE = 0.10;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort()
      .filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => [k, canonical((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/** SHA-256 of canonical key-sorted input + engine version + rules version. */
export async function calculationFingerprint(input: CaseInput): Promise<string> {
  const text = JSON.stringify({ input: canonical(input), engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function stopToBlocked(e: EngineStop, path = ""): BlockedComparison {
  // A baseline that is itself infeasible (e.g. existing SEP above the legal limit) is a data problem.
  return { status: e.kind === "unsupported" ? "unsupported" : "needs_data", code: e.code, message: e.message,
    fields: [{ path: e.path || path, reason: e.message }] };
}

function modelWarnings(models: YearModel[], input: CaseInput): string[] {
  const w: string[] = [];
  if (input.isSynthetic) w.push("Synthetic example household: amounts are illustrative, not a real customer's results.");
  for (const m of models) {
    if (m.benchmarkStatus === "county_candidate") w.push(`${m.year} benchmark is a county-level candidate, not a confirmed benchmark for your exact address and family.`);
    if (m.benchmarkStatus === "illustrative") w.push(`${m.year} benchmark premium is illustrative.`);
    if (m.rules.applicableFigureMethod === "official-table") w.push(`${m.year} applicable figures come from the DRAFT 2026 Form 8962 instructions.`);
    else w.push(`${m.year} applicable figures are derived from Rev. Proc. 2026-26 bands (no published ${m.year} Form 8962 table yet).`);
    if (!m.ptcEligible) w.push(`${m.year}: no premium tax credit eligibility was confirmed, so any advance credit is fully repaid.`);
  }
  w.push("Assumes required SSNs, lawful presence, Marketplace enrollment and no other coverage offers as confirmed in your entries; not a Marketplace eligibility determination.");
  return [...new Set(w)];
}

/** Current-year check: needs no new project and no next-year forecast. */
export async function assessCurrentRisk(raw: CaseInput): Promise<RiskAssessment> {
  const issues = new Issues();
  const input = parseCase(raw, issues);
  const model = input ? buildYearModel(input, 0, issues) : null;
  const blocked = issues.toBlocked();
  if (blocked || !input || !model) return blocked!;
  try {
    const c = solveCredit(model, NO_VARIATION);
    if (c.below100) {
      return stopToBlocked(new EngineStop("unsupported", "BELOW_100_FPL",
        "Household income is below 100% of the poverty line. Eligibility below 100% depends on conditions Headroom does not model.", "years[0].incomes"));
    }
    const fpl = c.fplDollars;
    const threshold = 400 * fpl;
    const assumptions = [
      `Extra profit means additional business profit (Schedule C) for ${model.persons.find(p => p.id === model.ownerId)!.label.toLowerCase()} in ${model.year}, after expenses — not gross revenue or bank deposits.`,
      "Re-solved with the self-employed health insurance deduction and credit recalculated at each amount.",
      "No additional SEP-IRA contribution; other income, premiums and household as entered.",
      `The credit stops when ACA household income is above ${formatUsd(threshold)} (400% of the $${fpl.toLocaleString("en-US")} poverty line for ${model.familySize}).`,
    ];
    const warnings = modelWarnings([model], input);
    let state: CurrentRisk["state"];
    let additionalProfitHeadroomCents: number | null = null;
    const trace = creditTrace(model, c);
    if (!model.ptcEligible) {
      state = "no_credit";
      assumptions.push("No credit because eligibility was not confirmed; this is not an income cliff.");
    } else if (c.ptc.line5 > 400) {
      state = "over_cliff";
      trace.push({ id: `${model.year}.over_by`, label: "ACA income above the 400% line", amountCents: c.magi - threshold, inputPaths: [],
        sourceIds: ["irs-i8962-2026-draft"], explanation: "ACA income must fall by more than this (for example through an allowed SEP contribution) to restore the credit." });
    } else if (c.ptc.ptc === 0) {
      state = "no_credit";
      assumptions.push("The benchmark premium is below your required contribution, so no credit is due; this is not an income cliff.");
    } else {
      const headroom = profitHeadroomDollars(model, NO_VARIATION);
      additionalProfitHeadroomCents = headroom === null ? null : headroom * 100;
      const gradual = headroom !== null && solveCredit(model, { profitDelta: (headroom + 1) * 100, additionalSep: 0 }).ptc.line5 <= 400;
      if (gradual) assumptions.push("Here the credit phases out to zero before the 400% line because the benchmark premium is low; there is no sudden cliff at this point.");
      let highCrosses = false;
      if (hasRanges(model)) {
        const high = solveCredit(modelAt(model, UNCERTAINTY_SCALE), NO_VARIATION, false);
        highCrosses = high.ptc.ptc === 0;
        assumptions.push(highCrosses ? "With every declared income range at its high end, the credit would be lost." : "The credit holds for every combination of your declared income ranges (checked at the all-high combination, the highest possible household income).");
      }
      state = highCrosses || (headroom !== null && headroom * 100 < threshold * AT_RISK_SHARE) ? "at_risk" : "below_cliff";
      assumptions.push(`"At risk" means the remaining profit headroom is under ${AT_RISK_SHARE * 100}% of the threshold, or a declared range reaches it.`);
    }
    // Take-home support is a separate question; flag (not block) when the full return is outside it.
    try { evaluateYear(model, NO_VARIATION); } catch (e) {
      if (!(e instanceof EngineStop)) throw e;
      warnings.push(`Subsidy figures are calculated, but take-home comparisons are not available for this household: ${e.message}`);
    }
    return {
      status: "ready", engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION,
      calculationFingerprint: await calculationFingerprint(input),
      risk: { year: model.year, state, forecastMagiCents: c.magi, thresholdMagiCents: threshold, subsidyCents: c.ptc.ptc,
        advanceSettlementCents: c.aptcTotal - c.ptc.ptc, additionalProfitHeadroomCents, headroomAssumptions: assumptions, trace },
      warnings,
    };
  } catch (e) {
    if (e instanceof EngineStop) return stopToBlocked(e);
    throw e;
  }
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
