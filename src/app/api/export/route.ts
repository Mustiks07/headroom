import { handle, readJsonBody } from "@/lib/server/http";
import { exportPdfFromInput } from "@/lib/server/pdf";
import { ExportBodySchema } from "@/lib/server/schemas";

export const POST = handle(async (request: Request) => {
  const body = await readJsonBody(request, ExportBodySchema);
  const { pdf, fingerprint } = await exportPdfFromInput(body.input, body.chosenScenarioId,
    body.expectedFingerprint ?? null, body.completedActionIds ?? []);
  return new Response(new Blob([pdf as BlobPart], { type: "application/pdf" }), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="headroom-plan-${fingerprint.slice(0, 12)}.pdf"`,
      "Cache-Control": "no-store",
      "X-Headroom-Fingerprint": fingerprint,
    },
  });
});
