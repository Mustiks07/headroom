import { buildCalendar } from "@/lib/client/deal-exports";
import { loadCurrentPackage, PackageExportBodySchema } from "@/lib/server/deal-verify";
import { handle, readJsonBody } from "@/lib/server/http";

/** iCalendar (.ics) of a CURRENT package's open dated actions. Stable UIDs; nothing is sent anywhere. */
export const POST = handle(async (request: Request) => {
  const body = await readJsonBody(request, PackageExportBodySchema, 2_500_000);
  const ctx = await loadCurrentPackage(body.workspace, body.packageId);
  return new Response(buildCalendar(ctx.ws, ctx.pkg), { status: 200, headers: {
    "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store", "X-Headroom-Fingerprint": ctx.searchFingerprint,
    "Content-Disposition": `attachment; filename="headroom-actions-${ctx.pkg.projectId.replace(/[^\w-]/g, "")}.ics"`,
  } });
});
