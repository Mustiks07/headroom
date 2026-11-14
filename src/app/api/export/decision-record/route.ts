import { handle, readJsonBody } from "@/lib/server/http";
import { buildDecisionRecordModel, loadDecisionRecord, RecordExportBodySchema } from "@/lib/server/pdf/decision-record";
import { renderReportPdf } from "@/lib/server/pdf/render";

/** Historical decision record PDF ("Decision recorded on …; figures as of …"), usable after the agreement changed the plan. */
export const POST = handle(async (request: Request) => {
  const body = await readJsonBody(request, RecordExportBodySchema, 4_000_000);
  const loaded = await loadDecisionRecord(body.workspace, body.recordId);
  const pdf = await renderReportPdf(buildDecisionRecordModel(loaded, new Date()));
  return new Response(new Blob([pdf as BlobPart], { type: "application/pdf" }), { status: 200, headers: {
    "Content-Type": "application/pdf", "Cache-Control": "no-store", "X-Headroom-Fingerprint": loaded.record.searchFingerprint, "X-Headroom-Record": loaded.integrity,
    "Content-Disposition": `attachment; filename="headroom-decision-record-${loaded.record.recordedAt.slice(0, 10)}.pdf"`,
  } });
});
