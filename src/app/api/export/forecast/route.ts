import { handle, readJsonBody } from "@/lib/server/http";
import { exportForecastPdf, ForecastExportBodySchema } from "@/lib/server/pdf/forecast";

/** "Annual income forecast explanation" PDF, generated from the validated workspace and a fresh engine result. */
export const POST = handle(async (request: Request) => {
  const body = await readJsonBody(request, ForecastExportBodySchema, 2_000_000);
  const { pdf, fingerprint } = await exportForecastPdf(body.workspace, body.year, body.expectedFingerprint ?? null);
  return new Response(new Blob([pdf as BlobPart], { type: "application/pdf" }), { status: 200, headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="headroom-income-forecast-${body.year}-${fingerprint.slice(0, 10)}.pdf"`,
    "Cache-Control": "no-store",
    "X-Headroom-Fingerprint": fingerprint,
  } });
});
