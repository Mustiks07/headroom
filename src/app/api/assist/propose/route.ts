import { ProposeBodySchema, type ProposeResponse } from "@/domain/assistance";
import { proposeFromPatterns } from "@/lib/client/assistance-text";
import { aiFeatureEnabled, reserveAiCall } from "@/lib/server/ai-budget";
import { assertSameOrigin } from "@/lib/server/ai-guard";
import { proposeWithProvider } from "@/lib/server/assist/provider";
import { handle, HttpError, json, readJsonBody } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";
import { apiError } from "@/lib/server/http";

export const maxDuration = 30;

/**
 * Turn the user's words into a typed change PROPOSAL (nothing is saved). With consent and an
 * enabled provider the model proposes; otherwise — or if it fails — Headroom's deterministic
 * patterns do. Either way every id/amount/date is validated and ambiguities are asked, not guessed.
 */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  if (rateLimited(request, "propose", 30, 60_000)) return apiError(429, "RATE_LIMITED", "Too many messages in a short time. Wait a minute or use the form.");
  const { request: req, consentToProvider } = await readJsonBody(request, ProposeBodySchema, 40_000);
  const id = `prop-${crypto.randomUUID()}`;
  const notes: string[] = [];
  if (consentToProvider && aiFeatureEnabled("proposal")) {
    let reservation;
    try {
      reservation = await reserveAiCall(request, "proposal", { textChars: req.text.length + JSON.stringify(req.context).length });
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      notes.push(`${e.message} Headroom's built-in reading of your message is shown instead.`);
    }
    if (reservation) {
      try {
        const call = await proposeWithProvider(req, id, reservation);
        await reservation.settle(call.usage, call.outcome);
        if (call.value) return json({ proposal: call.value, providerUsed: true, notes } satisfies ProposeResponse);
        notes.push("The assistant couldn't read this message safely; Headroom's built-in reading is shown instead.");
      } catch (e) {
        await reservation.settle(null, e instanceof Error ? e.name : "error");
        console.error("[headroom] proposal provider failed", e instanceof Error ? e.name : "unknown");
        notes.push("The assistant didn't respond in time; Headroom's built-in reading is shown instead.");
      }
    }
  }
  return json({ proposal: proposeFromPatterns(req, id), providerUsed: false, notes } satisfies ProposeResponse);
});
