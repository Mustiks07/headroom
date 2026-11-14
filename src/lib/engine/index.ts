import type { CaseInput, ComparisonResult, RiskAssessment } from "@/domain/contracts";

/** Current-year check must not require a new project or known next-year income. */
export async function assessCurrentRisk(input: CaseInput): Promise<RiskAssessment> {
  void input;
  return { status: "unavailable", code: "ENGINE_NOT_IMPLEMENTED",
    message: "The subsidy assessment engine is not implemented in this foundation build.", fields: [] };
}

/** Claude 2 implements this pure entry point; no API keys or network required. */
export async function calculateComparison(input: CaseInput): Promise<ComparisonResult> {
  void input;
  return {
    status: "unavailable",
    code: "ENGINE_NOT_IMPLEMENTED",
    message: "The calculation engine is not implemented in this foundation build.",
    fields: [],
  };
}
