import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../../pages/api/security/collusion';

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

describe('Security API (US-060)', () => {
  it('returns analysis for valid input', async () => {
    const res = createRes();
    await handler(createReq('POST', { hands: [{ handId: 'h1', players: ['a','b'], actions: [], pot: 0, winners: ['a'] }] }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.patterns).toBeDefined();
    expect(Array.isArray(json.alerts)).toBe(true);
  });

  it('errors on invalid input', async () => {
    const res = createRes();
    await handler(createReq('POST', { foo: 'bar' }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
