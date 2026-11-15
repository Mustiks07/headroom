import { IntakeRequestSchema, type IntakeResult, type ProviderStatus } from "@/domain/intake";
import { parseOfferText } from "@/lib/client/offer-intake";
import { aiFeatureEnabled, reserveAiCall } from "@/lib/server/ai-budget";
import { assertSameOrigin } from "@/lib/server/ai-guard";
import { intakeWithProvider, providerStatusOf } from "@/lib/server/assist/intake";
import { apiError, handle, HttpError, json, readJsonBody } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";

export const maxDuration = 30;

/**
 * First-offer / counteroffer intake from an ordinary pasted message (nothing is saved).
 * With consent and the text feature enabled, the provider reads the terms and every value is checked
 * against the text; otherwise — or on quota/timeout/refusal/invalid output — Headroom's own reading is
 * returned with `providerStatus` saying why. Uses the `proposal` AI feature and its daily call quota.
 */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  if (rateLimited(request, "intake", 20, 60_000)) return apiError(429, "RATE_LIMITED", "Too many messages in a short time. Wait a minute or enter the offer yourself.");
  const req = await readJsonBody(request, IntakeRequestSchema, 40_000);
  const draftId = `draft-${crypto.randomUUID()}`;
  const fallback = (status: ProviderStatus, note: string | null): IntakeResult => {
    const r = parseOfferText(req.text, req.userDate, draftId);
    return { ...r, providerStatus: status, notes: note ? [note, ...r.notes] : r.notes };
  };
  if (!req.consentToProvider) return json(fallback("not_consented", null));
  if (!aiFeatureEnabled("proposal")) return json(fallback("disabled", "The assistant isn't enabled here; Headroom's built-in reading is shown."));
  let reservation;
  try { reservation = await reserveAiCall(request, "proposal", { textChars: req.text.length + 1_500 }); }
  catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return json(fallback(e.status === 429 ? "quota" : "unavailable", `${e.message} Headroom's built-in reading is shown instead.`));
  }
  try {
    const call = await intakeWithProvider(req, draftId, reservation);
    await reservation.settle(call.usage, call.outcome);
    if (!call.value) return json(fallback(call.outcome === "refusal" ? "refused" : "invalid_output", "The assistant couldn't read this message safely; Headroom's built-in reading is shown instead."));
    if (call.value.outcome === "nothing_found") {
      const own = fallback("used", null);
      if (own.offers.length) return json({ ...own, notes: ["The assistant found no offer terms; Headroom's built-in reading found the terms below. Check them carefully.", ...own.notes] } satisfies IntakeResult);
    }
    return json(call.value);
  } catch (e) {
    await reservation.settle(null, e instanceof Error ? e.name : "error");
    const status = providerStatusOf(e);
    console.error("[headroom] intake provider failed", e instanceof Error ? e.name : "unknown");
    return json(fallback(status, status === "timeout" ? "The assistant didn't respond in time; Headroom's built-in reading is shown instead." : "The assistant is unavailable right now; Headroom's built-in reading is shown instead."));
  }
});
