import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "./public-config";

/**
 * Invisible anonymous Supabase session. There is no sign-up, login, email or password UI:
 * the session is created silently and used only as an ownership key for cloud plans.
 * If anything fails, callers fall back to local browser storage.
 */
let client: SupabaseClient | null = null;
let pending: Promise<CloudSession | null> | null = null;
let lastFailure: string | null = null;

export interface CloudSession { accessToken: string; userId: string }

const SIGN_IN_TIMEOUT_MS = 6000;

function getClient(): SupabaseClient | null {
  const config = publicSupabaseConfig();
  if (!config || typeof window === "undefined") return null;
  client ??= createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "headroom:v1:auth" },
  });
  return client;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error("Cloud session timed out.")), ms))]);
}

async function establish(): Promise<CloudSession | null> {
  const supabase = getClient();
  if (!supabase) { lastFailure = "Cloud save is not configured."; return null; }
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), SIGN_IN_TIMEOUT_MS);
    let session = data.session;
    if (!session) {
      const result = await withTimeout(supabase.auth.signInAnonymously(), SIGN_IN_TIMEOUT_MS);
      if (result.error || !result.data.session) throw result.error ?? new Error("No session returned.");
      session = result.data.session;
    }
    lastFailure = null;
    return { accessToken: session.access_token, userId: session.user.id };
  } catch {
    lastFailure = "The cloud service could not start a guest session.";
    return null;
  }
}

/** Returns a valid session or null (local mode). Concurrent callers share one attempt. */
export async function getCloudSession(): Promise<CloudSession | null> {
  pending ??= establish().finally(() => { pending = null; });
  return pending;
}

export function lastCloudFailure(): string | null {
  return lastFailure;
}

/** Forget the anonymous session in this browser (after "Clear my data"). */
export async function forgetCloudSession(): Promise<void> {
  const supabase = getClient();
  if (!supabase) return;
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* local token removal is best effort */ }
}
