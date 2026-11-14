import "server-only";
import { recomputeForPlan } from "@/lib/client/plan-integrity";
import { PlanIntegrityError } from "@/lib/client/errors";
import { HttpError } from "../http";
import { buildReportModel } from "./report-model";
import { renderReportPdf } from "./render";

/** Recompute with the engine, refuse stale requests, and render the PDF from that fresh result only. */
export async function exportPdfFromInput(input: unknown, chosenScenarioId: string, expectedFingerprint: string | null,
  completedActionIds: string[] = []): Promise<{ pdf: Uint8Array; fingerprint: string }> {
  try {
    const { input: parsed, comparison } = await recomputeForPlan(input, chosenScenarioId, expectedFingerprint);
    const chosen = comparison.scenarios.find(s => s.id === chosenScenarioId)!;
    const validActions = completedActionIds.filter(id => chosen.actions.some(a => a.id === id));
    const model = buildReportModel(parsed, comparison, chosenScenarioId, validActions, new Date());
    return { pdf: await renderReportPdf(model), fingerprint: comparison.calculationFingerprint };
  } catch (error) {
    if (error instanceof PlanIntegrityError) {
      const status = error.code === "INVALID_INPUT" ? 400 : error.code === "RESULT_UNAVAILABLE" ? 503
        : error.code.startsWith("RESULT_") ? 422 : 409;
      throw new HttpError(status, error.code, error.message, error.fields);
    }
    throw error;
  }
}
