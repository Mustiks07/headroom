import { BenchmarkLookupBodySchema } from "@/domain/insurance";
import { validateWorkspace } from "@/lib/client/workspace-integrity";
import { PlanIntegrityError } from "@/lib/client/errors";
import { handle, HttpError, json, readJsonBody } from "@/lib/server/http";
import { lookupBenchmark } from "@/lib/server/insurance";

/** POST /api/insurance/benchmark { workspace, year } → confirmed | county_candidate | not_available, with source/version/date. No external call. */
export const POST = handle(async (request: Request) => {
  const body = await readJsonBody(request, BenchmarkLookupBodySchema, 4_000_000);
  let ws;
  try { ws = validateWorkspace(body.workspace); } catch (e) {
    if (e instanceof PlanIntegrityError) throw new HttpError(400, e.code, e.message, e.fields);
    throw e;
  }
  return json(lookupBenchmark(ws, body.year), 200, { "Cache-Control": "no-store" });
});
