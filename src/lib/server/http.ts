import "server-only";
import type { z } from "zod";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function apiError(status: number, code: string, message: string,
  extra: Record<string, unknown> = {}): Response {
  const { fields, ...rest } = extra;
  return json({ error: { code, message, ...(fields ? { fields } : {}) }, ...rest }, status);
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string,
    public readonly fields?: Array<{ path: string; reason: string }>) {
    super(message);
  }
}

const MAX_JSON_BYTES = 1_000_000;

/** Read and validate a JSON body. Throws HttpError(400/413). */
export async function readJsonBody<T>(request: Request, schema: z.ZodType<T>, maxBytes = MAX_JSON_BYTES): Promise<T> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch {
    throw new HttpError(400, "MALFORMED_JSON", "The request body is not valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, "INVALID_REQUEST", "The request does not match the expected format.",
      parsed.error.issues.slice(0, 20).map(i => ({ path: i.path.join("."), reason: i.message })));
  }
  return parsed.data;
}

/** Wrap a route handler: HttpError → JSON error; anything else → 500 without leaking details. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof HttpError) {
        return apiError(error.status, error.code, error.message, error.fields ? { fields: error.fields } : {});
      }
      console.error("[headroom] unhandled API error", error instanceof Error ? error.name : "unknown");
      return apiError(500, "INTERNAL_ERROR", "Something went wrong on our side. Your entries are still on the page.");
    }
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
