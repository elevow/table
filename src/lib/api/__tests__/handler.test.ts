import type { NextApiRequest } from 'next';
import { apiHandler, ApiError, assertSelf, clientIp, routeKey } from '../handler';

const mockRateLimit = jest.fn();
jest.mock('../rate-limit', () => ({ rateLimit: (...args: any[]) => mockRateLimit(...args) }));

const mockSharedRateLimit = jest.fn();
jest.mock('../shared-rate-limit', () => ({ sharedRateLimit: (...args: any[]) => mockSharedRateLimit(...args) }));

const mockGetUserId = jest.fn();
jest.mock('../../auth/auth-utils', () => ({
  getAuthenticatedUserId: (...args: any[]) => mockGetUserId(...args)
}));

function req(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
  return {
    method: 'GET',
    url: '/api/thing?x=1',
    headers: {},
    query: {},
    socket: { remoteAddress: '10.0.0.1' },
    ...overrides
  } as any;
}

function res() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() } as any;
}

describe('apiHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRateLimit.mockReturnValue({ allowed: true });
    mockGetUserId.mockResolvedValue('u1');
  });

  it('rejects other methods with 405 and an Allow header', async () => {
    const fn = jest.fn();
    const r = res();
    await apiHandler({ methods: ['GET', 'POST'] }, fn)(req({ method: 'DELETE' }), r);
    expect(r.status).toHaveBeenCalledWith(405);
    expect(r.setHeader).toHaveBeenCalledWith('Allow', 'GET, POST');
    expect(fn).not.toHaveBeenCalled();
  });

  it('rate limits per method, path (without query) and client IP', async () => {
    mockRateLimit.mockReturnValue({ allowed: false });
    const fn = jest.fn();
    const r = res();
    await apiHandler({ methods: 'GET', rateLimit: { windowMs: 1000, max: 1 } }, fn)(req(), r);
    expect(mockRateLimit).toHaveBeenCalledWith('GET /api/thing:10.0.0.1', { windowMs: 1000, max: 1 });
    expect(r.status).toHaveBeenCalledWith(429);
    expect(fn).not.toHaveBeenCalled();
  });

  it('requires a session when auth is set, and passes the user ID through', async () => {
    const fn = jest.fn();
    await apiHandler({ methods: 'GET', auth: true }, fn)(req(), res());
    expect(fn).toHaveBeenCalledWith(expect.anything(), expect.anything(), { userId: 'u1' });

    mockGetUserId.mockResolvedValue(null);
    const r = res();
    fn.mockClear();
    await apiHandler({ methods: 'GET', auth: true }, fn)(req(), r);
    expect(r.status).toHaveBeenCalledWith(401);
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not look up a session when auth is not set', async () => {
    await apiHandler({ methods: 'GET' }, jest.fn())(req(), res());
    expect(mockGetUserId).not.toHaveBeenCalled();
  });

  it('turns ApiError into its status, mapped codes into theirs, and anything else into 500', async () => {
    const run = async (err: any) => {
      const r = res();
      await apiHandler({ methods: 'GET', errorStatus: { NOT_FOUND: 404 } }, () => { throw err; })(req(), r);
      return r;
    };
    expect((await run(new ApiError(418, 'teapot'))).status).toHaveBeenCalledWith(418);
    expect((await run(Object.assign(new Error('gone'), { code: 'NOT_FOUND' }))).status).toHaveBeenCalledWith(404);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await run(new Error('connection to db.internal refused'));
    expect(r.status).toHaveBeenCalledWith(500);
    // Internal details are logged, not sent
    expect(r.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('hands other errors to onError when given', async () => {
    const onError = jest.fn((r: any) => r.status(409).json({ error: 'conflict' }));
    const r = res();
    await apiHandler({ methods: 'GET', onError }, () => { throw new Error('domain'); })(req(), r);
    expect(onError).toHaveBeenCalledWith(r, expect.objectContaining({ message: 'domain' }));
    expect(r.status).toHaveBeenCalledWith(409);
  });

  it('keeps shared limits in the shared store, keyed the same way', async () => {
    mockSharedRateLimit.mockResolvedValue({ allowed: false });
    const r = res();
    await apiHandler({ methods: 'POST', rateLimit: { windowMs: 1000, max: 1, shared: true } }, jest.fn())(req({ method: 'POST' }), r);
    expect(mockSharedRateLimit).toHaveBeenCalledWith('POST /api/thing:10.0.0.1', { windowMs: 1000, max: 1 });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(429);
  });

  it('uses a custom rate-limit message', async () => {
    mockRateLimit.mockReturnValue({ allowed: false });
    const r = res();
    await apiHandler({ methods: 'GET', rateLimit: { windowMs: 1000, max: 1, message: 'Slow down' } }, jest.fn())(req(), r);
    expect(r.json).toHaveBeenCalledWith({ error: 'Slow down' });
  });
});

describe('routeKey', () => {
  it('names dynamic segments so every ID shares one limit', () => {
    expect(routeKey(req({ url: '/api/avatars/abc-123?x=1', query: { avatarId: 'abc-123', x: '1' } }))).toBe('/api/avatars/[avatarId]');
    expect(routeKey(req({ url: '/api/users/u%201/access', query: { id: 'u 1' } }))).toBe('/api/users/[id]/access');
  });

  it('leaves static paths alone', () => {
    expect(routeKey(req({ url: '/api/thing?x=1', query: { x: '1' } }))).toBe('/api/thing');
  });
});

describe('clientIp', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(clientIp(req({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }))).toBe('1.2.3.4');
    expect(clientIp(req({ headers: { 'x-forwarded-for': ['9.9.9.9'] } as any }))).toBe('9.9.9.9');
  });

  it('falls back to the socket address', () => {
    expect(clientIp(req())).toBe('10.0.0.1');
  });
});

describe('assertSelf', () => {
  it('defaults an omitted claim to the caller', () => {
    expect(assertSelf({ userId: 'u1' }, undefined, 'userId')).toBe('u1');
    expect(assertSelf({ userId: 'u1' }, 'u1', 'userId')).toBe('u1');
  });

  it('throws 403 when the claim names someone else', () => {
    expect(() => assertSelf({ userId: 'u1' }, 'u2', 'userId')).toThrow(
      expect.objectContaining({ status: 403 })
    );
  });
});
