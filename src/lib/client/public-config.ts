/**
 * Public (browser-safe) configuration. Only NEXT_PUBLIC_* values are read here; they are
 * inlined at build time. Secrets live in src/lib/server/env.ts and never reach the client.
 */
const PLACEHOLDER = /^(|your[-_ ].*|change[-_ ]?me|placeholder|todo|xxx+|<.*>|\.\.\.)$/i;

export function isRealValue(value: string | undefined | null): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return v.length > 0 && !PLACEHOLDER.test(v) && !/example\.(com|org)/i.test(v);
}

export function validSupabaseUrl(value: string | undefined): string | null {
  if (!isRealValue(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Accept the new publishable key format or the documented legacy anon JWT. Never a secret key. */
export function validPublishableKey(value: string | undefined): string | null {
  if (!isRealValue(value)) return null;
  const v = value.trim();
  if (v.startsWith("sb_secret_")) return null;
  return v.startsWith("sb_publishable_") || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v) ? v : null;
}

export function publicSupabaseConfig(): { url: string; publishableKey: string } | null {
  const url = validSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = validPublishableKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  return url && publishableKey ? { url, publishableKey } : null;
}
