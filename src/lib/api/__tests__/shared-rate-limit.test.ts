const mockLocalRateLimit = jest.fn();
jest.mock('../rate-limit', () => ({ rateLimit: (...args: any[]) => mockLocalRateLimit(...args) }));

import { redisClientOptions, sharedRateLimit, setSharedRateLimitClient } from '../shared-rate-limit';

/** A stand-in Redis that runs the hit script's logic against a Map. */
function fakeRedis() {
  const store = new Map<string, { n: number; expiresAt: number }>();
  const evalFn = jest.fn(async (_script: string, _keys: number, key: string, windowMs: number) => {
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || entry.expiresAt <= now) entry = { n: 0, expiresAt: now + Number(windowMs) };
    entry.n += 1;
    store.set(key, entry);
    return [entry.n, entry.expiresAt - now];
  });
  return { eval: evalFn, store };
}

describe('sharedRateLimit', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    mockLocalRateLimit.mockReset().mockReturnValue({ allowed: true, remaining: 9, resetAt: 0 });
    warn.mockClear();
  });

  afterAll(() => {
    setSharedRateLimitClient(undefined);
    warn.mockRestore();
  });

  it('counts hits in Redis and blocks past the limit', async () => {
    const redis = fakeRedis();
    setSharedRateLimitClient(redis as any);
    const cfg = { windowMs: 60_000, max: 2 };

    const first = await sharedRateLimit('POST /api/auth/login:1.2.3.4', cfg);
    const second = await sharedRateLimit('POST /api/auth/login:1.2.3.4', cfg);
    const third = await sharedRateLimit('POST /api/auth/login:1.2.3.4', cfg);

    expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, false]);
    expect([first.remaining, second.remaining, third.remaining]).toEqual([1, 0, 0]);
    expect(third.resetAt).toBeGreaterThan(Date.now());
    expect(mockLocalRateLimit).not.toHaveBeenCalled();
  });

  it('keeps separate counts per client and namespaces keys by environment', async () => {
    const redis = fakeRedis();
    setSharedRateLimitClient(redis as any);
    const cfg = { windowMs: 60_000, max: 1 };

    expect((await sharedRateLimit('POST /api/auth/login:1.1.1.1', cfg)).allowed).toBe(true);
    expect((await sharedRateLimit('POST /api/auth/login:2.2.2.2', cfg)).allowed).toBe(true);
    expect([...redis.store.keys()]).toEqual([
      'rl:test:POST /api/auth/login:1.1.1.1:60000',
      'rl:test:POST /api/auth/login:2.2.2.2:60000',
    ]);
  });

  it('falls back to the per-instance limiter when Redis fails, and warns once', async () => {
    setSharedRateLimitClient({ eval: jest.fn().mockRejectedValue(new Error('down')) } as any);
    const cfg = { windowMs: 60_000, max: 10 };

    const result = await sharedRateLimit('k', cfg);
    await sharedRateLimit('k', cfg);

    expect(result).toEqual({ allowed: true, remaining: 9, resetAt: 0 });
    expect(mockLocalRateLimit).toHaveBeenCalledWith('k', cfg);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('uses the per-instance limiter when no Redis is configured', async () => {
    setSharedRateLimitClient(null);
    await sharedRateLimit('k', { windowMs: 1_000, max: 3 });
    expect(mockLocalRateLimit).toHaveBeenCalledWith('k', { windowMs: 1_000, max: 3 });
  });

  it('never connects to REDIS_URL under test', async () => {
    setSharedRateLimitClient(undefined);
    const saved = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://default:x@example.upstash.io:6379';
    try {
      await sharedRateLimit('k', { windowMs: 1_000, max: 3 });
      expect(mockLocalRateLimit).toHaveBeenCalled();
    } finally {
      if (saved === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = saved;
    }
  });
});

describe('redisClientOptions', () => {
  it('keeps the old Redis protocol (RESP2) that ioredis 5 used', () => {
    expect(redisClientOptions('redis://localhost:6379').protocol).toBe(2);
  });

  it('uses TLS for Upstash and rediss:// URLs only', () => {
    expect(redisClientOptions('redis://default:x@eu1-test.upstash.io:6379').tls).toEqual({});
    expect(redisClientOptions('rediss://cache.example.com:6380').tls).toEqual({});
    expect(redisClientOptions('redis://localhost:6379').tls).toBeUndefined();
  });
});
