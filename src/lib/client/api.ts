import type { ExtractionResult, PlanRepository, SavedPlan } from "@/domain/contracts";

/** Claude 3 implements this adapter. Claude 1 depends only on these exports. */
export function createPlanRepository(): PlanRepository {
  const unavailable = async (): Promise<never> => {
    throw new Error("Plan storage is not implemented in this foundation build.");
  };
  return { list: unavailable, get: unavailable, save: unavailable, remove: unavailable,
    appendEvent: unavailable, listEvents: unavailable, clear: unavailable };
}

export async function extractDocument(file: File): Promise<ExtractionResult> {
  void file;
  return { status: "unavailable", fields: [], warnings: ["Document import is not configured yet. Use manual entry."] };
}

export async function exportPlanPdf(plan: SavedPlan): Promise<Blob> {
  void plan;
  throw new Error("PDF export is not implemented in this foundation build.");
}
