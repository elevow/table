import { rateLimit } from '../../api/rate-limit';

describe('rateLimit', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('allows first call and decreases remaining', () => {
    const res = rateLimit('k1', { windowMs: 1000, max: 3 });
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(2);
    expect(res.resetAt).toBeGreaterThan(Date.now());
  });

  test('blocks after exceeding max within window', () => {
    const cfg = { windowMs: 1000, max: 2 };
    const k = 'k2';
    expect(rateLimit(k, cfg).allowed).toBe(true); // 1st
    expect(rateLimit(k, cfg).allowed).toBe(true); // 2nd
    const third = rateLimit(k, cfg);
    expect(third.allowed).toBe(false); // blocked
    expect(third.remaining).toBe(0);
  });

  test('resets after window passes', () => {
    const cfg = { windowMs: 1000, max: 1 };
    const k = 'k3';
    expect(rateLimit(k, cfg).allowed).toBe(true);
    // advance beyond window; ensure reset occurs
    jest.setSystemTime(new Date(Date.now() + 1001));
    const after = rateLimit(k, cfg);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(0);
  });

  test('supports limit fallback and custom key segmentation', () => {
    const cfg = { windowMs: 1000, limit: 2, key: 'A' } as const;
    const id = 'k4';
    expect(rateLimit(id, cfg).allowed).toBe(true); // 1st in key A
    expect(rateLimit(id, cfg).allowed).toBe(true); // 2nd in key A
    expect(rateLimit(id, cfg).allowed).toBe(false); // blocked in key A

    // same id but different key should be independent
    const cfgB = { windowMs: 1000, limit: 2, key: 'B' } as const;
    const fresh = rateLimit(id, cfgB);
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(1);
  });

  test('resolves id from NextApiRequest with x-forwarded-for string', () => {
    const req: any = {
      headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
      method: 'POST',
      url: '/api/test',
      socket: { remoteAddress: '9.9.9.9' },
    };
    const cfg = { windowMs: 1000, max: 1 };
    expect(rateLimit(req, cfg).allowed).toBe(true);
    expect(rateLimit(req, cfg).allowed).toBe(false); // same derived id within window
  });

  test('resolves id from NextApiRequest with x-forwarded-for array', () => {
    const req: any = {
      headers: { 'x-forwarded-for': ['3.3.3.3', '4.4.4.4'] },
      method: 'GET',
      url: '/x',
      socket: { remoteAddress: '8.8.8.8' },
    };
    const cfg = { windowMs: 1000, max: 1 };
    expect(rateLimit(req, cfg).allowed).toBe(true);
    expect(rateLimit(req, cfg).allowed).toBe(false);
  });

  test('falls back to remoteAddress when no forwarded header', () => {
    const req: any = {
      headers: {},
      method: 'PUT',
      url: '/y',
      socket: { remoteAddress: '7.7.7.7' },
    };
    const cfg = { windowMs: 1000, max: 1 };
    expect(rateLimit(req, cfg).allowed).toBe(true);
    expect(rateLimit(req, cfg).allowed).toBe(false);
  });

  test('defaults to max=60 when neither max nor limit provided', () => {
    const res = rateLimit('k5', { windowMs: 1000 } as any);
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(59);
  });
});
