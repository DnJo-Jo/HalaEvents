import "server-only";

/**
 * In-memory fixed-window limiter (event.md §5.6). Per server instance only: a deployment with
 * several instances or restarts resets it. Good enough to slow down form abuse in the MVP.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function allowRequest(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000)
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

/** Test helper: forget all counters so one test's calls don't throttle the next. */
export function resetRateLimits(): void {
  buckets.clear();
}
