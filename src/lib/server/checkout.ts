import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { serverConfig } from "./env";
import { HttpError } from "./http";
import { privilegedClient } from "./supabase";

export const PRICE_LABEL = "$99 per household for 12 months";
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface CheckoutResult {
  mode: "demo" | "stripe_test";
  /** True only for the demo unlock or a server-verified paid Stripe TEST session. */
  unlocked: boolean;
  isRealPayment: false;
  label: string;
  url?: string;
  expiresAt?: string;
  recorded: "cloud" | "browser_only";
}

/** Record a demo/test entitlement for a verified owner, when the trusted server path exists. */
async function recordEntitlement(ownerId: string | null, mode: "demo" | "test", reference: string | null, expiresAt: string) {
  const admin = privilegedClient();
  if (!admin || !ownerId) return false;
  const { error } = await admin.from("entitlements").upsert(
    { owner_id: ownerId, mode, product: "headroom_annual", provider_reference: reference, expires_at: expiresAt },
    reference ? { onConflict: "provider_reference", ignoreDuplicates: true } : undefined);
  if (error) console.error("[headroom] entitlement write failed", error.code ?? "unknown");
  return !error;
}

/** Demo checkout: no card, no payment, never counted as revenue. */
export async function demoCheckout(ownerId: string | null): Promise<CheckoutResult> {
  const expiresAt = new Date(Date.now() + YEAR_MS).toISOString();
  const recorded = await recordEntitlement(ownerId, "demo", null, expiresAt);
  return { mode: "demo", unlocked: true, isRealPayment: false, expiresAt, recorded: recorded ? "cloud" : "browser_only",
    label: `Demo checkout: everything is unlocked for this contest. No card was collected and no payment was made. Planned price: ${PRICE_LABEL}.` };
}

async function stripe(path: string, init: { method?: string; form?: Record<string, string> } = {}) {
  const config = serverConfig().stripe;
  if (!config) throw new HttpError(503, "CHECKOUT_UNAVAILABLE", "Test checkout is not configured.");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${config.secretKey}`, ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: init.form ? new URLSearchParams(init.form).toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => { throw new HttpError(503, "CHECKOUT_UNAVAILABLE", "The test payment service could not be reached."); });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[headroom] stripe error", response.status, body?.error?.type ?? "unknown");
    throw new HttpError(503, "CHECKOUT_UNAVAILABLE", "The test payment service returned an error.");
  }
  return body as Record<string, unknown>;
}

/** Stripe TEST-mode checkout session. Live keys are rejected by configuration. */
export async function createStripeTestCheckout(ownerId: string | null, origin: string): Promise<CheckoutResult> {
  const config = serverConfig();
  if (!config.stripe) throw new HttpError(503, "CHECKOUT_UNAVAILABLE", "Test checkout is not configured.");
  const price = await stripe(`prices/${encodeURIComponent(config.stripe.priceId)}`);
  if (price.livemode !== false) throw new HttpError(503, "CHECKOUT_UNAVAILABLE", "Only Stripe test mode is supported.");
  const base = config.appUrl ?? origin;
  const form: Record<string, string> = {
    mode: price.recurring ? "subscription" : "payment",
    "line_items[0][price]": config.stripe.priceId,
    "line_items[0][quantity]": "1",
    success_url: `${base}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/pricing?checkout=cancelled`,
    "metadata[app]": "headroom",
  };
  if (ownerId) form.client_reference_id = ownerId;
  const session = await stripe("checkout/sessions", { method: "POST", form });
  return { mode: "stripe_test", unlocked: false, isRealPayment: false, url: String(session.url), recorded: "browser_only",
    label: "Stripe TEST mode: use a Stripe test card. No real money moves and test purchases are not counted as revenue." };
}

/** Server-side verification of a returned test session before unlocking. */
export async function verifyStripeTestSession(sessionId: string, ownerId: string | null): Promise<CheckoutResult> {
  if (!/^cs_test_[\w]+$/.test(sessionId)) throw new HttpError(400, "INVALID_SESSION", "This is not a Stripe test checkout session.");
  const session = await stripe(`checkout/sessions/${encodeURIComponent(sessionId)}`);
  const paid = session.livemode === false && (session.payment_status === "paid" || session.payment_status === "no_payment_required")
    && session.status === "complete";
  const expiresAt = new Date(Date.now() + YEAR_MS).toISOString();
  const owner = typeof session.client_reference_id === "string" ? session.client_reference_id : ownerId;
  const recorded = paid && owner === ownerId ? await recordEntitlement(owner, "test", sessionId, expiresAt) : false;
  return { mode: "stripe_test", unlocked: paid, isRealPayment: false, expiresAt: paid ? expiresAt : undefined,
    recorded: recorded ? "cloud" : "browser_only",
    label: paid ? "Stripe TEST purchase verified. This is a test transaction, not revenue." : "The test checkout was not completed." };
}

/** Verify a Stripe webhook signature (v1 scheme, 5-minute tolerance). */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=") as [string, string]).filter(p => p.length === 2)) as Record<string, string>;
  const signatures = header.split(",").filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300 || signatures.length === 0) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest();
  return signatures.some(sig => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export async function handleStripeWebhook(payload: string, signature: string | null): Promise<void> {
  const config = serverConfig().stripe;
  if (!config?.webhookSecret) throw new HttpError(503, "CHECKOUT_UNAVAILABLE", "Test webhooks are not configured.");
  if (!verifyStripeSignature(payload, signature, config.webhookSecret)) throw new HttpError(400, "INVALID_SIGNATURE", "Invalid signature.");
  const event = JSON.parse(payload) as { type?: string; livemode?: boolean; data?: { object?: Record<string, unknown> } };
  if (event.livemode !== false) return; // never record live events from this contest build
  if (event.type === "checkout.session.completed") {
    const session = event.data?.object ?? {};
    const owner = typeof session.client_reference_id === "string" ? session.client_reference_id : null;
    if (owner && session.payment_status !== "unpaid") {
      await recordEntitlement(owner, "test", String(session.id), new Date(Date.now() + YEAR_MS).toISOString());
    }
  }
}
