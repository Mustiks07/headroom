import { z } from "zod";
import { ANALYTICS_EVENTS } from "@/lib/client/analytics-events";
import { handle, readJsonBody } from "@/lib/server/http";

const BodySchema = z.object({ event: z.enum(ANALYTICS_EVENTS) }).strict();

/** Logs one whitelisted event name (visible in Vercel logs). Anything else is rejected. */
export const POST = handle(async (request: Request) => {
  const { event } = await readJsonBody(request, BodySchema, 200);
  console.info(JSON.stringify({ type: "headroom_analytics", event, day: new Date().toISOString().slice(0, 10) }));
  return new Response(null, { status: 204 });
});
