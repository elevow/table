import type { NextApiRequest, NextApiResponse } from 'next';
import collusionHandler from '../../../pages/api/security/collusion';
import multiHandler from '../../../pages/api/security/multi-account';

jest.mock('../../../src/lib/database/pool', () => ({ getPool: jest.fn(() => ({})) }));
const mockRequirePermission = jest.fn();
jest.mock('../../../src/lib/auth/access-control', () => ({
  requirePermission: (...args: any[]) => mockRequirePermission(...args)
}));

// Mock rate limiter
jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: 1 })
}));

function createRes() {
  const res: Partial<NextApiResponse> & { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  } as any;
  return res;
}

function createReq(method: string, body?: any): Partial<NextApiRequest> {
  return {
    method,
    body,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' } as any
  } as any;
}

describe('Security API (US-060/US-061)', () => {
  beforeEach(() => {
    mockRequirePermission.mockReset();
    mockRequirePermission.mockResolvedValue({ userId: 'staff' });
  });

  it('only staff with admin.security.config can run an analysis', async () => {
    mockRequirePermission.mockImplementation(async (_req: any, res: any) => {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    });
    for (const [handler, body] of [[collusionHandler, { hands: [] }], [multiHandler, { logins: [] }]] as const) {
      const res = createRes();
      await (handler as any)(createReq('POST', body) as any, res as any);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.status).not.toHaveBeenCalledWith(200);
    }
    expect(mockRequirePermission).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'admin.security.config');
  });

  it('returns analysis for valid input', async () => {
    const res = createRes();
  await collusionHandler(createReq('POST', { hands: [{ handId: 'h1', players: ['a','b'], actions: [], pot: 0, winners: ['a'] }] }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.patterns).toBeDefined();
    expect(Array.isArray(json.alerts)).toBe(true);
  });

  it('errors on invalid input', async () => {
    const res = createRes();
    await collusionHandler(createReq('POST', { foo: 'bar' }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('multi-account endpoint returns linkage for valid input', async () => {
    const res = createRes();
    const now = Date.now();
    const logins = [
      { accountId: 'u1', ip: '3.3.3.3', timestamp: now, fingerprint: 'fpx' },
      { accountId: 'u2', ip: '3.3.3.3', timestamp: now + 1000, fingerprint: 'fpx' }
    ];
    await multiHandler(createReq('POST', { logins }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.signals).toBeDefined();
    expect(Array.isArray(json.linkedAccounts)).toBe(true);
  });

  it('multi-account endpoint errors on invalid input', async () => {
    const res = createRes();
    await multiHandler(createReq('POST', { }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
