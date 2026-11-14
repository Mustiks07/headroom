import "server-only";

/**
 * Small per-instance limiter for the costly provider path only. It is a guard against bursts,
 * not a global quota, and is never applied to the deterministic calculator or demo.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimited(request: Request, scope: string, limit: number, windowMs: number): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size > 5000) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}
