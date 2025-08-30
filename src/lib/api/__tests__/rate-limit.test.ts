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
});
