import "server-only";
import { createHmac } from "node:crypto";
import { serverConfig } from "./env";
import { HttpError } from "./http";
import { privilegedClient, requireOwner } from "./supabase";
import { BASISWEB_MODELS, type AiProvider } from "./ai-client";

/**
 * Durable spend budget for every AI endpoint (extraction, proposals, explanations).
 * Before a provider call: reserve the WORST-CASE cost (estimated input + max output tokens at the
 * configured model's dated price) atomically in Postgres against a global, per-guest and per-IP
 * daily budget. After the call: settle with the provider's actual token usage. A crash leaves the
 * reservation in place (fail-safe). No retries, no fallback to another (possibly pricier) model.
 */

export type AiFeature = "extraction" | "proposal" | "explanation";

/**
 * USD per million tokens (input, output), from the Anthropic models overview checked 2026-11-16.
 * A model missing here cannot be budgeted, so AI stays disabled for it (fail closed).
 */
export const MODEL_PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
export const PRICES_CHECKED_ON = "2026-11-16";

export const FEATURE_LIMITS: Record<AiFeature, { maxOutputTokens: number; timeoutMs: number }> = {
  extraction: { maxOutputTokens: 4_000, timeoutMs: 40_000 },
  proposal: { maxOutputTokens: 2_000, timeoutMs: 20_000 },
  explanation: { maxOutputTokens: 1_200, timeoutMs: 15_000 },
};

const usd = (value: string | undefined, fallback: number, max: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};

/** Daily budgets in USD (defaults deliberately small). */
export function aiBudgets(env: NodeJS.ProcessEnv = process.env) {
  return {
    globalUsd: usd(env.AI_DAILY_BUDGET_USD, 5, 1_000),
    guestUsd: usd(env.AI_GUEST_DAILY_BUDGET_USD, 0.5, 50),
    ipUsd: usd(env.AI_IP_DAILY_BUDGET_USD, 1, 100),
  };
}

/** Features explicitly enabled. Unset = extraction only (round 2 behaviour); proposals/explanations must be listed. */
export function enabledFeatures(env: NodeJS.ProcessEnv = process.env): Set<AiFeature> {
  const raw = env.AI_FEATURES?.trim();
  if (!raw) return new Set(["extraction"]);
  return new Set(raw.split(",").map(s => s.trim()).filter((s): s is AiFeature => s === "extraction" || s === "proposal" || s === "explanation"));
}

/** Provider + durable budget store + priced model + feature flag — otherwise the feature is off. */
export function aiFeatureEnabled(feature: AiFeature): boolean {
  const config = serverConfig();
  return config.ai !== null && config.supabase?.secretKey != null
    && (config.ai.provider === "basisweb" ? BASISWEB_MODELS.has(config.ai.model) : MODEL_PRICES_PER_MTOK[config.ai.model] !== undefined)
    && enabledFeatures().has(feature);
}

/** Micro-USD cost of a token count at the model's price (rounded up). */
export function costMicroUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICES_PER_MTOK[model];
  if (!price) throw new Error("Unpriced model");
  return Math.ceil(inputTokens * price.input + outputTokens * price.output); // $/MTok × tokens = micro-USD
}

/** Conservative input estimate: text ≈ 1 token / 3 chars; PDF page ≈ 3,000; image ≈ 1,800; plus instructions. */
export function estimateInputTokens(input: { textChars?: number; pdfPages?: number; images?: number }): number {
  return 2_000 + Math.ceil((input.textChars ?? 0) / 3) + (input.pdfPages ?? 0) * 3_000 + (input.images ?? 0) * 1_800;
}

export interface AiUsage { inputTokens: number; outputTokens: number }
export interface AiReservation {
  provider: AiProvider;
  model: string;
  apiKey: string;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Settle once with reported usage. Unknown usage keeps the reservation. */
  settle(usage: AiUsage | null, outcome: string): Promise<void>;
}

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

const MESSAGES: Record<AiFeature, string> = {
  extraction: "Document analysis",
  proposal: "Understanding typed changes",
  explanation: "Plain-language explanations",
};

/** Verify the guest session and reserve the worst-case cost for one provider call, or throw 401/429/503. */
export async function reserveAiCall(request: Request, feature: AiFeature, input: { textChars?: number; pdfPages?: number; images?: number }): Promise<AiReservation> {
  const config = serverConfig();
  const admin = privilegedClient();
  if (!aiFeatureEnabled(feature) || !config.ai || !admin || !config.supabase?.secretKey) {
    throw new HttpError(503, "AI_UNAVAILABLE", `${MESSAGES[feature]} is unavailable. You can continue by entering the details yourself.`);
  }
  let owner;
  try { owner = await requireOwner(request); } catch {
    throw new HttpError(401, "SESSION_REQUIRED", `${MESSAGES[feature]} needs this browser's guest session, which isn't available right now. You can continue by entering the details yourself.`);
  }
  const limits = FEATURE_LIMITS[feature];
  const model = config.ai.model;
  const day = new Date().toISOString().slice(0, 10);
  const hash = (v: string) => createHmac("sha256", config.supabase!.secretKey!).update(`${day}:${v}`).digest("hex").slice(0, 32);
  // BasisWeb sells token credits with gateway-specific multipliers, not direct
  // Anthropic USD pricing. Use the existing atomic call quota, keep failed calls
  // counted, and report token usage without inventing a dollar cost.
  if (config.ai.provider === "basisweb") {
    const cap = (name: string, fallback: number, max: number) => Math.floor(usd(process.env[name], fallback, max));
    const { data, error } = await admin.rpc("headroom_consume_ai_quota", {
      p_user: hash(owner.userId), p_ip: hash(clientIp(request)),
      p_user_limit: cap("AI_GUEST_DAILY_CALL_LIMIT", 10, 100),
      p_ip_limit: cap("AI_IP_DAILY_CALL_LIMIT", 20, 200),
      p_global_limit: cap("AI_DAILY_CALL_LIMIT", 100, 1000),
    });
    if (error || typeof data !== "string") throw new HttpError(503, "AI_UNAVAILABLE", "The AI request limit could not be checked. Enter the details manually.");
    if (data !== "ok") throw new HttpError(429, "AI_BUDGET_REACHED", "Today's AI request limit has been reached. Enter the details manually or try again tomorrow.");
    let reported = false;
    return { provider: "basisweb", model, apiKey: config.ai.apiKey, ...limits,
      async settle(usage, outcome) {
        if (reported) return;
        reported = true;
        console.info(JSON.stringify({ type: "headroom_ai_call", provider: "basisweb", feature, model, outcome,
          inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null,
          usageKnown: usage !== null, accounting: "daily_call_quota", costUsd: null }));
      },
    };
  }
  const reserve = costMicroUsd(model, estimateInputTokens(input), limits.maxOutputTokens);
  const b = aiBudgets();
  const { data, error } = await admin.rpc("headroom_reserve_ai_spend", {
    p_guest: hash(owner.userId), p_ip: hash(clientIp(request)), p_feature: feature, p_model: model, p_reserve: reserve,
    p_global_limit: Math.round(b.globalUsd * 1_000_000), p_guest_limit: Math.round(b.guestUsd * 1_000_000), p_ip_limit: Math.round(b.ipUsd * 1_000_000),
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    console.error("[headroom] ai budget check failed", error?.code ?? "no_row");
    throw new HttpError(503, "AI_UNAVAILABLE", `${MESSAGES[feature]} is temporarily unavailable. You can continue by entering the details yourself.`);
  }
  if (row.outcome !== "ok" || !row.reservation_id) {
    throw new HttpError(429, "AI_BUDGET_REACHED", row.outcome === "global_budget"
      ? `Today's ${MESSAGES[feature].toLowerCase()} budget has been used. Continue by entering the details yourself or try again tomorrow.`
      : `You've reached today's limit for ${MESSAGES[feature].toLowerCase()}. Continue by entering the details yourself or try again tomorrow.`);
  }
  let settled = false;
  return {
    provider: "anthropic", model, apiKey: config.ai.apiKey, maxOutputTokens: limits.maxOutputTokens, timeoutMs: limits.timeoutMs,
    async settle(usage, outcome) {
      if (settled) return;
      settled = true;
      // A timeout/lost response does not prove the provider did no billable work.
      // Keep the reservation for the day rather than refunding a possibly paid call.
      if (!usage) {
        console.info(JSON.stringify({ type: "headroom_ai_call", feature, model, outcome,
          usageKnown: false, reservedMicroUsd: reserve, reservationRetained: true }));
        return;
      }
      const actual = costMicroUsd(model, usage.inputTokens, usage.outputTokens);
      const { error: e } = await admin.rpc("headroom_settle_ai_spend", { p_reservation: row.reservation_id, p_actual: actual,
        p_input: usage?.inputTokens ?? 0, p_output: usage?.outputTokens ?? 0, p_outcome: outcome });
      // Usage counters only (no content); a failed settle keeps the larger reservation in place.
      console.info(JSON.stringify({ type: "headroom_ai_call", feature, model, outcome, inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0, costMicroUsd: actual, settleError: e?.code ?? null }));
    },
  };
}
