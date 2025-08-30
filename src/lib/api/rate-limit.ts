type LimitConfig = { windowMs: number; max: number; key?: string };

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(id: string, cfg: LimitConfig): { allowed: boolean; remaining: number; resetAt: number } {
  const key = `${cfg.key || ''}:${id}:${cfg.windowMs}:${cfg.max}`;
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + cfg.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: cfg.max - 1, resetAt };
  }
  if (entry.count < cfg.max) {
    entry.count += 1;
    return { allowed: true, remaining: cfg.max - entry.count, resetAt: entry.resetAt };
  }
  return { allowed: false, remaining: 0, resetAt: entry.resetAt };
}
