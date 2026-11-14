import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverConfig } from "./env";
import { HttpError } from "./http";

const NO_PERSIST = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

export interface AuthenticatedOwner {
  userId: string;
  /** Client that acts AS the user: every query is filtered by RLS (auth.uid() = owner_id). */
  db: SupabaseClient;
}

/**
 * Verify the bearer token of an (anonymous) Supabase session. Ownership is always derived
 * from the verified user, never from the request body.
 * 503 when cloud storage is not configured, 401 when the session is missing/invalid.
 */
export async function requireOwner(request: Request): Promise<AuthenticatedOwner> {
  const config = serverConfig().supabase;
  if (!config) throw new HttpError(503, "CLOUD_NOT_CONFIGURED", "Cloud save is not configured. Plans are saved in this browser instead.");
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([\w.-]+)$/.exec(header);
  if (!match) throw new HttpError(401, "SESSION_REQUIRED", "A guest session is required for cloud save.");
  const token = match[1];
  const db = createClient(config.url, config.publishableKey, {
    auth: NO_PERSIST,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  let result;
  try {
    result = await db.auth.getUser(token);
  } catch {
    throw new HttpError(503, "CLOUD_UNAVAILABLE", "Cloud save is unavailable right now.");
  }
  if (result.error || !result.data.user) {
    // No HTTP status (network/DNS) or 5xx: the auth service is down, not the session invalid.
    const status = result.error?.status ?? 0;
    if (result.error && (status === 0 || status >= 500)) throw new HttpError(503, "CLOUD_UNAVAILABLE", "Cloud save is unavailable right now.");
    throw new HttpError(401, "SESSION_INVALID", "The guest session has expired. Reload the page to continue.");
  }
  return { userId: result.data.user.id, db };
}

/**
 * Privileged client for strictly scoped server operations (writing entitlements, deleting the
 * anonymous auth user). Returns null when no secret key is configured. Never used for normal reads.
 */
export function privilegedClient(): SupabaseClient | null {
  const config = serverConfig().supabase;
  if (!config?.secretKey) return null;
  return createClient(config.url, config.secretKey, { auth: NO_PERSIST });
}

/** Map PostgREST/network failures to a safe 503 without leaking database details. */
export function dbFailure(error: { code?: string; message?: string } | null | undefined): never {
  console.error("[headroom] database error", error?.code ?? "unknown");
  throw new HttpError(503, "CLOUD_UNAVAILABLE", "Cloud save is unavailable right now. Your entries are still on the page.");
}

/** Owner when a valid cloud session is supplied; null in local mode. Never throws for missing sessions. */
export async function optionalOwner(request: Request): Promise<AuthenticatedOwner | null> {
  if (!request.headers.get("authorization")) return null;
  try { return await requireOwner(request); } catch { return null; }
}
