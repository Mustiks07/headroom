import { LocationQuerySchema } from "@/domain/insurance";
import { apiError, handle, json } from "@/lib/server/http";
import { lookupCountiesByZip, lookupCountyByName } from "@/lib/server/insurance";
import { rateLimited } from "@/lib/server/rate-limit";

export const maxDuration = 10;

/** GET /api/insurance/location?zip=37203 or ?state=TN&q=davidson → county candidates (never a guessed county). */
export const GET = handle(async (request: Request) => {
  if (rateLimited(request, "insurance-location", 30, 60_000)) return apiError(429, "RATE_LIMITED", "Too many lookups in a short time. Wait a minute.");
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const q = LocationQuerySchema.safeParse(params.zip ? { zip: params.zip } : { state: params.state?.toUpperCase(), q: params.q });
  if (!q.success) return apiError(400, "INVALID_REQUEST", "Enter a 5-digit ZIP code, or a state and the start of a county name.");
  const result = "zip" in q.data ? await lookupCountiesByZip(q.data.zip) : lookupCountyByName(q.data.state, q.data.q);
  return json(result, 200, { "Cache-Control": "no-store" });
});
