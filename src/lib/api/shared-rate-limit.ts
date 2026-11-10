import type Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { rateLimit as localRateLimit } from './rate-limit';
import { envString, runtime } from '../config/env';

type LimitResult = { allowed: boolean; remaining: number; resetAt: number };
type RedisLike = Pick<Redis, 'eval'>;

/**
 * Count the hit and return [count, ms until the window resets]. It's one EVAL, so Upstash bills
 * a single command per check, and it repairs a key left without an expiry.
 */
const HIT_SCRIPT = `local n = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {n, ttl}`;

let client: Promise<RedisLike | null> | undefined;
let lastWarning = 0;

function warn(message: string, error?: unknown) {
  // A dead connection would otherwise log on every request
  if (Date.now() - lastWarning < 60_000) return;
  lastWarning = Date.now();
  console.warn(`[shared-rate-limit] ${message}; using the per-instance limiter`, error ?? '');
}

/** Options for the rate limiter's Redis client at this URL. */
export function redisClientOptions(url: string): RedisOptions {
  // Upstash only accepts TLS, whichever scheme the URL was copied with
  const useTls = url.startsWith('rediss://') || new URL(url).hostname.endsWith('.upstash.io');
  return {
    tls: useTls ? {} : undefined,
    connectTimeout: 2_000,
    commandTimeout: 1_000,
    maxRetriesPerRequest: 1,
    // ioredis 6 speaks RESP3 by default; keep RESP2, which every Redis host (Upstash included) accepts
    protocol: 2,
  };
}

async function connect(): Promise<RedisLike | null> {
  const url = envString('REDIS_URL');
  // Tests never talk to the real store, even when .env.local sets REDIS_URL
  if (!url || runtime.isTest) return null;
  try {
    const { default: IORedis } = await import('ioredis');
    const redis = new IORedis(url, redisClientOptions(url));
    redis.on('error', (e: unknown) => warn('Redis connection error', e));
    return redis;
  } catch (e) {
    warn('could not create the Redis client', e);
    return null;
  }
}

/** Where keys live, so local dev, previews and production never share counters. */
function scope(): string {
  return envString('VERCEL_ENV') || process.env.NODE_ENV || 'development';
}

/**
 * A rate limit shared by every serverless instance, kept in Redis (REDIS_URL). Without Redis,
 * or if it fails, it falls back to the per-instance limiter so requests are never blocked by
 * an outage. Each call is one Redis command, so keep it to low-traffic routes where the limit
 * matters (sign-in, password resets, uploads), not polling.
 */
export async function sharedRateLimit(id: string, cfg: { windowMs: number; max: number }): Promise<LimitResult> {
  client ??= connect();
  const redis = await client;
  if (redis) {
    try {
      const key = `rl:${scope()}:${id}:${cfg.windowMs}`;
      const [count, ttl] = (await redis.eval(HIT_SCRIPT, 1, key, cfg.windowMs)) as [number, number];
      return { allowed: count <= cfg.max, remaining: Math.max(0, cfg.max - count), resetAt: Date.now() + ttl };
    } catch (e) {
      warn('Redis command failed', e);
    }
  }
  return localRateLimit(id, cfg);
}

/** Tests only: use this client (or none) instead of connecting to REDIS_URL. */
export function setSharedRateLimitClient(redis: RedisLike | null | undefined) {
  client = redis === undefined ? undefined : Promise.resolve(redis);
  lastWarning = 0;
}
