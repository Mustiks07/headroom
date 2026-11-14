import { z } from "zod";
import { buildCalendar, buildCurrentCalendar } from "@/lib/client/deal-exports";
import { PlanIntegrityError } from "@/lib/client/errors";
import { validateWorkspace } from "@/lib/client/workspace-integrity";
import { loadCurrentPackage } from "@/lib/server/deal-verify";
import { handle, HttpError, readJsonBody } from "@/lib/server/http";

const BodySchema = z.object({ workspace: z.unknown(), packageId: z.string().min(1).max(100).optional() });
const ics = (text: string, name: string, extra: Record<string, string> = {}) => new Response(text, { status: 200, headers: {
  "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="${name}"`, ...extra } });

/**
 * iCalendar (.ics). With `packageId`: a CURRENT package's open dated actions (round 4; stale
 * packages are refused). Without it: the current agreed plan (open agreed payments, open actions,
 * remaining SEP), including STATUS:CANCELLED entries for previously issued events that no longer
 * apply. The client function `exportCurrentCalendar` also saves what was issued; this route does not.
 */
export const POST = handle(async (request: Request) => {
  const body = await readJsonBody(request, BodySchema, 2_500_000);
  if (body.packageId) {
    const ctx = await loadCurrentPackage(body.workspace, body.packageId);
    return ics(buildCalendar(ctx.ws, ctx.pkg), `headroom-actions-${ctx.pkg.projectId.replace(/[^\w-]/g, "")}.ics`, { "X-Headroom-Fingerprint": ctx.searchFingerprint });
  }
  let ws;
  try { ws = validateWorkspace(body.workspace); } catch (e) {
    if (e instanceof PlanIntegrityError) throw new HttpError(400, e.code, e.message, e.fields);
    throw e;
  }
  const out = buildCurrentCalendar(ws);
  return ics(out.ics, "headroom-plan.ics", { "X-Headroom-Events": `${out.active} current, ${out.cancelled} cancelled` });
});
