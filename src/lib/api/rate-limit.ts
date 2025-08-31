import type { NextApiRequest } from 'next';

// Backward/forward compatible config: allow either `max` or `limit`
type LimitConfig = { windowMs: number; max?: number; limit?: number; key?: string };

const buckets = new Map<string, { count: number; resetAt: number }>();

function resolveId(reqOrId: string | NextApiRequest): string {
  if (typeof reqOrId === 'string') return reqOrId;
  const forwarded = reqOrId.headers['x-forwarded-for'];
  let ip = '';
  if (Array.isArray(forwarded)) {
    ip = forwarded[0] || '';
  } else if (typeof forwarded === 'string') {
    ip = forwarded.split(',')[0]?.trim() || '';
  }
  const remote = (reqOrId.socket as any)?.remoteAddress || '';
  const method = reqOrId.method || 'GET';
  const url = reqOrId.url || '';
  const base = ip || remote || 'unknown';
  return `${base}:${method}:${url}`;
}

export function rateLimit(reqOrId: string | NextApiRequest, cfg: LimitConfig): { allowed: boolean; remaining: number; resetAt: number } {
  const id = resolveId(reqOrId);
  const max = (cfg.max ?? cfg.limit) ?? 60; // default to 60 if not provided
  const key = `${cfg.key || ''}:${id}:${cfg.windowMs}:${max}`;
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + cfg.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: max - 1, resetAt };
  }
  if (entry.count < max) {
    entry.count += 1;
    return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt };
  }
  return { allowed: false, remaining: 0, resetAt: entry.resetAt };
}
