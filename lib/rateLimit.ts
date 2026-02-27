type RateLimitOptions = {
  windowMs: number;
  max: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function now() {
  return Date.now();
}

export function getClientId(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

export function rateLimit(key: string, options: RateLimitOptions) {
  const current = buckets.get(key);
  const ts = now();

  if (!current || current.resetAt <= ts) {
    const next: Bucket = { count: 1, resetAt: ts + options.windowMs };
    buckets.set(key, next);
    return { allowed: true, remaining: options.max - 1, resetAt: next.resetAt };
  }

  if (current.count >= options.max) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt };
  }

  current.count += 1;
  buckets.set(key, current);
  return { allowed: true, remaining: options.max - current.count, resetAt: current.resetAt };
}
