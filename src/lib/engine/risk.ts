/** Current-year subsidy risk (v1 assessCurrentRisk), shared with the household entry points. */
import type { CaseInput, CurrentRisk, RiskAssessment } from "@/domain/contracts";
import { calculationFingerprint, modelWarnings, stopToBlocked } from "./common";
import { buildYearModel, Issues, parseCase } from "./guard";
import { formatUsd } from "./money";
import { EngineStop, NO_VARIATION } from "./model";
import { ENGINE_VERSION, RULES_VERSION } from "./rules";
import { profitHeadroomDollars } from "./search";
import { UNCERTAINTY_SCALE, hasRanges, modelAt } from "./uncertainty";
import { creditTrace, evaluateYear, solveCredit } from "./year";

/** Share of the 400% threshold below which remaining profit headroom is labelled "at risk". */
export const AT_RISK_SHARE = 0.10;

/** Current-year check: needs no new project and no next-year forecast. */
export async function assessRisk(raw: CaseInput): Promise<RiskAssessment> {
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

