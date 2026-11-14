import "server-only";
import { isRealValue, publicSupabaseConfig } from "@/lib/client/public-config";

/** Server-only configuration. Values are read per call so tests and Vercel env changes apply. */
export interface ServerConfig {
  supabase: { url: string; publishableKey: string; secretKey: string | null } | null;
  ai: { provider: "anthropic"; apiKey: string; model: string } | null;
  stripe: { secretKey: string; webhookSecret: string | null; priceId: string } | null;
  appUrl: string | null;
}

/** Default extraction model when AI_MODEL is not set. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export function serverConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const pub = publicSupabaseConfig();
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  const secretKey = isRealValue(secret) && (secret.startsWith("sb_secret_") || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(secret)) ? secret : null;
  const supabase = pub ? { ...pub, secretKey } : null;

  const provider = env.AI_PROVIDER?.trim().toLowerCase();
  const aiKey = env.AI_API_KEY?.trim();
  const ai = provider === "anthropic" && isRealValue(aiKey) && aiKey.startsWith("sk-ant-")
    ? { provider: "anthropic" as const, apiKey: aiKey, model: isRealValue(env.AI_MODEL) ? env.AI_MODEL.trim() : DEFAULT_ANTHROPIC_MODEL }
    : null;

  // Only Stripe TEST mode is supported. A live key is ignored so real billing is never enabled silently.
  const stripeKey = env.STRIPE_SECRET_KEY?.trim();
  const priceId = env.STRIPE_ANNUAL_PRICE_ID?.trim();
  const webhook = env.STRIPE_WEBHOOK_SECRET?.trim();
  const stripe = isRealValue(stripeKey) && /^(sk|rk)_test_/.test(stripeKey) && isRealValue(priceId) && priceId.startsWith("price_")
    ? { secretKey: stripeKey, priceId, webhookSecret: isRealValue(webhook) && webhook.startsWith("whsec_") ? webhook : null }
    : null;

  const appUrl = isRealValue(env.NEXT_PUBLIC_APP_URL) ? env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "") : null;
  return { supabase, ai, stripe, appUrl };
}

export type CheckoutMode = "demo" | "stripe_test";

export interface Capabilities {
  cloudSave: boolean;
  aiExtraction: boolean;
  checkoutMode: CheckoutMode;
  /** CSV/TXT figures can be read deterministically without any provider. */
  localTextImport: boolean;
}

export function capabilities(config = serverConfig()): Capabilities {
  return {
    cloudSave: config.supabase !== null,
    aiExtraction: config.ai !== null,
    checkoutMode: config.stripe ? "stripe_test" : "demo",
    localTextImport: true,
  };
}
