import { z } from "zod";
import type { ExplainResponse } from "@/domain/assistance";
import { aiFeatureEnabled, reserveAiCall } from "@/lib/server/ai-budget";
import { assertSameOrigin } from "@/lib/server/ai-guard";
import { deterministicExplanation, explainWithProvider, onlyPacketFigures } from "@/lib/server/assist/provider";
import { handle, HttpError, json, readJsonBody } from "@/lib/server/http";

export const maxDuration = 20;

const PacketSchema = z.object({
  id: z.string().min(1).max(120), subject: z.string().max(80), fingerprint: z.string().max(200),
  facts: z.array(z.object({ ref: z.string().min(1).max(120), label: z.string().max(200), kind: z.enum(["money", "date", "text", "percent"]),
    valueCents: z.number().int().safe().optional(), date: z.string().date().optional(), text: z.string().max(300).optional(), percent: z.number().finite().optional() })).max(60),
  statements: z.array(z.string().max(500)).max(20),
  limitations: z.array(z.string().max(300)).max(10),
});
const BodySchema = z.object({ packet: PacketSchema, consentToProvider: z.boolean().default(false) });

/**
 * Explain a VERIFIED result packet (built by the engine). Deterministic by default; a provider
 * rewrite is published only if every figure/date in it matches the packet.
 */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  const { packet, consentToProvider } = await readJsonBody(request, BodySchema, 60_000);
  const base = deterministicExplanation(packet);
  const deterministic = (unanswered: string[] = []): ExplainResponse => ({ providerUsed: false,
    explanation: { packetId: packet.id, text: base.text.slice(0, 4000), references: base.references.slice(0, 60), source: "deterministic", unanswered } });
  if (!consentToProvider || !aiFeatureEnabled("explanation")) return json(deterministic());
  let reservation;
  try { reservation = await reserveAiCall(request, "explanation", { textChars: base.text.length + 2_000 }); }
  catch (e) { if (e instanceof HttpError) return json(deterministic([e.message])); throw e; }
  try {
    const call = await explainWithProvider(packet, reservation);
    await reservation.settle(call.usage, call.outcome);
    if (call.value && onlyPacketFigures(call.value, packet)) {
      return json({ providerUsed: true, explanation: { packetId: packet.id, text: call.value.slice(0, 4000), references: base.references, source: "ai_model", unanswered: [] } } satisfies ExplainResponse);
    }
    return json(deterministic(call.value ? ["The simplified wording contained a figure that isn't in your result, so the standard explanation is shown."] : []));
  } catch (e) {
    await reservation.settle(null, e instanceof Error ? e.name : "error");
    return json(deterministic(["The simplified explanation isn't available right now."]));
  }
});
