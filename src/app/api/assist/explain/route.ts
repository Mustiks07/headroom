import { z } from "zod";
import { ExplainWorkspaceBodySchema, type ExplainResponse, type ExplanationPacket, type ExplanationVerification } from "@/domain/assistance";
import { buildExplanationPacket, ENGINE_VERSION, RULES_VERSION, type ExplanationAnswer } from "@/lib/engine";
import { validateWorkspace } from "@/lib/client/workspace-integrity";
import { PlanIntegrityError } from "@/lib/client/errors";
import { aiFeatureEnabled, reserveAiCall } from "@/lib/server/ai-budget";
import { assertSameOrigin } from "@/lib/server/ai-guard";
import { deterministicExplanation, explainWithProvider, figureFree } from "@/lib/server/assist/provider";
import { handle, HttpError, json, readJsonBody } from "@/lib/server/http";

export const maxDuration = 20;

const PacketSchema = z.object({
  id: z.string().min(1).max(120), subject: z.string().max(80), fingerprint: z.string().max(200),
  facts: z.array(z.object({ ref: z.string().min(1).max(120), label: z.string().max(200), kind: z.enum(["money", "date", "text", "percent"]),
    valueCents: z.number().int().safe().optional(), date: z.string().date().optional(), text: z.string().max(300).optional(), percent: z.number().finite().optional() })).max(60),
  statements: z.array(z.string().max(500)).max(20),
  limitations: z.array(z.string().max(300)).max(10),
});
/** Legacy body: a packet built in the browser. Only its shape can be checked here. */
const PacketBodySchema = z.object({ packet: PacketSchema, consentToProvider: z.boolean().default(false) });
const BodySchema = z.union([ExplainWorkspaceBodySchema, PacketBodySchema]);

const QUESTION: Record<ExplanationAnswer["question"], string> = {
  why_worse: "Why am I worse off?", why_january: "Why January?", client_refuses: "What if the client refuses?", what_changes: "What would change the answer?",
};

/**
 * Explain a result. Preferred: { workspace, subject, refId? } — the server rebuilds the packet with the
 * engine from exactly that plan revision ("server_recomputed"). Legacy: { packet } — schema-checked only,
 * labelled "client_packet_unverified". Every financial sentence is an engine template; a provider (with
 * consent, budget and the feature on) may add only a number-free plain-English framing in front of it.
 */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  const body = await readJsonBody(request, BodySchema, 4_000_000);
  let packet: ExplanationPacket;
  let verification: ExplanationVerification;
  let unanswered: string[] = [];
  if ("workspace" in body) {
    let ws;
    try { ws = validateWorkspace(body.workspace); } catch (e) {
      if (e instanceof PlanIntegrityError) throw new HttpError(400, e.code, e.message, e.fields);
      throw e;
    }
    const built = await buildExplanationPacket(ws, body.subject, body.refId);
    if ("status" in built) throw new HttpError(409, built.code === "STALE_RESULT" ? "STALE_RESULT" : built.code, built.message, built.fields);
    packet = built;
    unanswered = built.answers.filter(a => a.status === "unresolved" && a.missing).map(a => `${QUESTION[a.question]} ${a.missing}`.slice(0, 300)).slice(0, 10);
    verification = { origin: "server_recomputed", workspaceId: ws.id, workspaceRevision: ws.revision, fingerprint: built.fingerprint, engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION,
      note: `Rebuilt on the server from plan revision ${ws.revision} with the current calculation (${ENGINE_VERSION} / ${RULES_VERSION}).` };
  } else {
    packet = body.packet;
    verification = { origin: "client_packet_unverified", workspaceId: null, workspaceRevision: null, fingerprint: packet.fingerprint, engineVersion: null, rulesVersion: null,
      note: "These figures were sent by the browser and were not recalculated by the server." };
  }
  const base = deterministicExplanation(packet);
  const respond = (extra: string[] = [], summary: string | null = null): ExplainResponse => ({ providerUsed: summary !== null, verification,
    explanation: { packetId: packet.id, text: (summary ? `${summary} ${base.text}` : base.text).slice(0, 4000), references: base.references.slice(0, 60),
      source: summary ? "ai_model" : "deterministic", unanswered: [...unanswered, ...extra].slice(0, 10) } });
  if (!body.consentToProvider || !aiFeatureEnabled("explanation")) return json(respond());
  let reservation;
  try { reservation = await reserveAiCall(request, "explanation", { textChars: base.text.length + 2_000 }); }
  catch (e) { if (e instanceof HttpError) return json(respond([e.message])); throw e; }
  try {
    const call = await explainWithProvider(packet, reservation);
    await reservation.settle(call.usage, call.outcome);
    if (call.value && figureFree(call.value)) return json(respond([], call.value.trim().slice(0, 600)));
    return json(respond(call.value ? ["The simplified wording contained a figure that isn't in your result, so the standard explanation is shown."] : []));
  } catch (e) {
    await reservation.settle(null, e instanceof Error ? e.name : "error");
    return json(respond(["The simplified explanation isn't available right now."]));
  }
});
