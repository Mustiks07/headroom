import "server-only";
import { createHmac } from "node:crypto";
import { serverConfig } from "./env";
import { HttpError } from "./http";
import { privilegedClient, requireOwner } from "./supabase";

/**
 * Cost controls for the paid document-analysis provider on a public, login-free endpoint.
 *
 * What works on Vercel (many short-lived instances):
 *  - request size (3 MB), PDF page count (5), provider timeout (40 s, no retries), max output tokens;
 *  - an invisible anonymous Supabase session is required, so each browser has a stable guest id;
 *  - a DURABLE daily quota in Postgres (`headroom_consume_ai_quota`): global, per guest and per
 *    hashed IP, checked atomically before every provider call. It fails closed.
 * The in-memory limiter in rate-limit.ts only smooths bursts within one warm instance.
 * Without the durable quota (no Supabase secret key / migration), AI extraction stays disabled.
 */
const int = (value: string | undefined, fallback: number, max: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
};

export function aiLimits(env: NodeJS.ProcessEnv = process.env) {
  return {
    globalDaily: int(env.AI_DAILY_LIMIT, 100, 10_000),
    perGuestDaily: int(env.AI_GUEST_DAILY_LIMIT, 5, 100),
    perIpDaily: int(env.AI_IP_DAILY_LIMIT, 15, 500),
  };
}

/** AI extraction is offered only when a provider AND the durable quota store are configured. */
export function aiExtractionEnabled(): boolean {
  const config = serverConfig();
  return config.ai !== null && config.supabase?.secretKey != null;
}

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/** Verify the guest session and consume one unit of today's quota, or throw 401/429/503. */
export async function authorizeAiCall(request: Request): Promise<void> {
  const config = serverConfig();
  const admin = privilegedClient();
  if (!config.ai || !admin || !config.supabase?.secretKey) {
    throw new HttpError(503, "AI_UNAVAILABLE", "Document analysis is unavailable. Enter the figures manually.");
  }
  let owner;
  try { owner = await requireOwner(request); } catch {
    throw new HttpError(401, "SESSION_REQUIRED", "Document analysis needs this browser's guest session, which isn't available right now. Enter the figures manually.");
  }
  const day = new Date().toISOString().slice(0, 10);
  const ipKey = createHmac("sha256", config.supabase.secretKey).update(`${day}:${clientIp(request)}`).digest("hex").slice(0, 32);
  const limits = aiLimits();
  const { data, error } = await admin.rpc("headroom_consume_ai_quota", {
    p_user: owner.userId, p_ip: ipKey, p_user_limit: limits.perGuestDaily, p_ip_limit: limits.perIpDaily, p_global_limit: limits.globalDaily,
  });
  if (error) {
    console.error("[headroom] ai quota check failed", error.code ?? "unknown");
    throw new HttpError(503, "AI_UNAVAILABLE", "Document analysis is temporarily unavailable. Enter the figures manually.");
  }
  if (data !== "ok") {
    throw new HttpError(429, "AI_QUOTA_REACHED", data === "global_limit"
      ? "Today's document-analysis capacity has been used. Enter the figures manually or try again tomorrow."
      : "You've reached today's limit for document analysis. Enter the figures manually or try again tomorrow.");
  }
}

/** Reject cross-site browser posts. (Scripts can omit Origin; the quota above still applies.) */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const allowed = new Set([new URL(request.url).origin]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) allowed.add(`${request.headers.get("x-forwarded-proto") ?? "https"}://${host}`);
  const app = serverConfig().appUrl;
  if (app) allowed.add(new URL(app).origin);
  if (!allowed.has(origin)) throw new HttpError(403, "CROSS_ORIGIN", "Requests from other sites are not accepted.");
}
