import { loadCurrentPackage, PackageExportBodySchema, recheckWithEngine } from "@/lib/server/deal-verify";
import { handle, readJsonBody } from "@/lib/server/http";
import { buildDecisionModel } from "@/lib/server/pdf/decision-model";
import { renderReportPdf } from "@/lib/server/pdf/render";

export const maxDuration = 30;

/** Decision package PDF for a saved, CURRENT package; figures from a fresh engine re-check. */
export const POST = handle(async (request: Request) => {
  const body = await readJsonBody(request, PackageExportBodySchema, 2_500_000);
  const ctx = await loadCurrentPackage(body.workspace, body.packageId);
  const { result, variant } = await recheckWithEngine(ctx);
  const pdf = await renderReportPdf(buildDecisionModel({ ws: ctx.ws, pkg: ctx.pkg, goal: ctx.goal, cash: ctx.cash, result, variant, generatedAt: new Date() }));
  return new Response(new Blob([pdf as BlobPart], { type: "application/pdf" }), { status: 200, headers: {
    "Content-Type": "application/pdf", "Cache-Control": "no-store", "X-Headroom-Fingerprint": result.searchFingerprint,
    "Content-Disposition": `attachment; filename="headroom-decision-${ctx.pkg.projectId.replace(/[^\w-]/g, "")}-${result.searchFingerprint.slice(0, 10)}.pdf"`,
  } });
});
