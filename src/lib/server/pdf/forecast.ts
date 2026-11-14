import "server-only";
import { z } from "zod";
import type { RiskAssessment, TaxYear } from "@/domain/contracts";
import { workspaceFingerprint, workspaceToCaseInput, type HouseholdProjectionResult, type HouseholdWorkspace } from "@/domain/household-workspace";
import * as engine from "@/lib/engine";
import { assessCurrentRisk, ENGINE_VERSION, RULES_VERSION } from "@/lib/engine";
import { validateWorkspace } from "@/lib/client/workspace-integrity";
import { PlanIntegrityError } from "@/lib/client/errors";
import { HttpError } from "../http";
import { buildForecastModel } from "./forecast-model";
import { renderReportPdf } from "./render";

export const ForecastExportBodySchema = z.object({
  workspace: z.unknown(),
  year: z.union([z.literal(2026), z.literal(2027)]).default(2026),
  /** Refuse the export if the fresh fingerprint differs (the page shows older numbers). */
  expectedFingerprint: z.string().min(1).max(200).optional(),
});

/** The engine's projection when Claude 2's entry point is present; the v1 current-year check otherwise. */
async function currentRisk(ws: HouseholdWorkspace): Promise<RiskAssessment> {
  const build = (engine as unknown as { buildHouseholdProjection?: (w: HouseholdWorkspace) => Promise<HouseholdProjectionResult> }).buildHouseholdProjection;
  if (typeof build === "function") {
    const projection = await build(ws);
    if (projection.status !== "ready") return projection;
    if (projection.currentRisk) return { status: "ready", engineVersion: projection.engineVersion, rulesVersion: projection.rulesVersion,
      calculationFingerprint: projection.fingerprint, risk: projection.currentRisk, warnings: projection.warnings };
  }
  const adapted = workspaceToCaseInput(ws);
  if (adapted.missing.length) {
    return { status: "needs_data", code: "WORKSPACE_FACTS_MISSING", message: "Some facts are missing or unconfirmed.",
      fields: adapted.missing };
  }
  return assessCurrentRisk(adapted.input);
}

export async function exportForecastPdf(raw: unknown, year: TaxYear, expectedFingerprint: string | null): Promise<{ pdf: Uint8Array; fingerprint: string }> {
  let ws: HouseholdWorkspace;
  try { ws = validateWorkspace(raw); } catch (e) {
    if (e instanceof PlanIntegrityError) throw new HttpError(400, e.code, e.message, e.fields);
    throw e;
  }
  const fingerprint = await workspaceFingerprint(ws, ENGINE_VERSION, RULES_VERSION);
  if (expectedFingerprint !== null && expectedFingerprint !== fingerprint) {
    throw new HttpError(409, "STALE_RESULT", "The plan changed since these figures were shown. Recalculate before downloading the explanation.");
  }
  const risk = year === 2026 ? await currentRisk(ws) : null;
  const model = buildForecastModel({ ws, year, risk, fingerprint, engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION, generatedAt: new Date() });
  return { pdf: await renderReportPdf(model), fingerprint };
}
