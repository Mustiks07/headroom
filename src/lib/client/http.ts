import { HeadroomError, StorageUnavailableError } from "./errors";

export interface ApiErrorBody { error: { code: string; message: string; fields?: Array<{ path: string; reason: string }> } }

const DEFAULT_TIMEOUT_MS = 20000;

/** fetch with timeout; network failures become StorageUnavailableError-like HeadroomErrors. */
export async function apiFetch(path: string, init: RequestInit & { timeoutMs?: number; token?: string } = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, token, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(rest.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    return await fetch(path, { ...rest, headers, signal: controller.signal, cache: "no-store" });
  } catch (error) {
    const timedOut = (error as Error)?.name === "AbortError";
    throw new StorageUnavailableError(timedOut ? "The request timed out. Your entries are still on this page; try again."
      : "The service could not be reached. Your entries are still on this page; try again.",
    timedOut ? "TIMEOUT" : "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }
}

export async function errorFromResponse(response: Response): Promise<HeadroomError> {
  let body: Partial<ApiErrorBody> = {};
  try { body = await response.json(); } catch { /* non-JSON error */ }
  const code = body.error?.code ?? `HTTP_${response.status}`;
  const message = body.error?.message ?? "The request could not be completed.";
  return new HeadroomError(code, message, response.status);
}

export async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await errorFromResponse(response);
  return response.json() as Promise<T>;
}
