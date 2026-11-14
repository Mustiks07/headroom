import { z } from "zod";
import { ANALYTICS_DATA_KINDS, ANALYTICS_EVENTS, ANALYTICS_INPUT_PATHS } from "@/lib/client/analytics-events";
import { handle, readJsonBody } from "@/lib/server/http";
import { privilegedClient } from "@/lib/server/supabase";

const BodySchema = z.object({
  event: z.enum(ANALYTICS_EVENTS),
  dataKind: z.enum(ANALYTICS_DATA_KINDS).default("unknown"),
  inputPath: z.enum(ANALYTICS_INPUT_PATHS).default("none"),
}).strict();

/**
 * One whitelisted event: increments an anonymous daily counter (day, event, dataKind, inputPath)
 * in Supabase when the server secret is configured; always logs the same coarse line. Anything
 * else — amounts, text, ids — is rejected by the strict schema.
 */
export const POST = handle(async (request: Request) => {
  const { event, dataKind, inputPath } = await readJsonBody(request, BodySchema, 300);
  console.info(JSON.stringify({ type: "headroom_analytics", event, dataKind, inputPath, day: new Date().toISOString().slice(0, 10) }));
  const admin = privilegedClient();
  if (admin) {
    const { error } = await admin.rpc("headroom_count_event", { p_event: event, p_data_kind: dataKind, p_input_path: inputPath });
    if (error) console.error("[headroom] analytics counter failed", error.code ?? "unknown");
  }
  return new Response(null, { status: 204 });
});
