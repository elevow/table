import type { NextApiRequest, NextApiResponse } from 'next';

let mockUser: string | null = 'u1';
const mockQuery = jest.fn();
jest.mock('../../lib/auth/auth-utils', () => ({
  requirePlayer: async (_req: any, res: any) => {
    if (!mockUser) { res.status(401).json({ error: 'Authentication required' }); return null; }
    return mockUser;
  },
}));
jest.mock('../../lib/database/pool', () => ({ getPool: () => ({ query: (...args: unknown[]) => mockQuery(...args) }) }));
jest.mock('../../lib/api/rate-limit', () => ({ rateLimit: () => ({ allowed: true }) }));

import handler from '../../../pages/api/profile/preferences';

function call(method: string, body?: unknown) {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  return Promise.resolve(handler({ method, body, query: {}, headers: {} } as unknown as NextApiRequest, res as NextApiResponse))
    .then(() => ({ status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] }));
}

beforeEach(() => { mockUser = 'u1'; mockQuery.mockReset(); });

test('a new user gets the usual defaults', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  expect(await call('GET')).toEqual({ status: 200, body: { display: { highContrastCards: false, showPotOdds: true, showStackInBB: false, showHandValue: true } } });
  expect(mockQuery.mock.calls[0][1]).toEqual(['u1']);
});

test('saving sends only known true/false settings, for the signed-in user', async () => {
  mockQuery.mockResolvedValue({ rows: [{ display: { highContrastCards: true } }] });
  const r = await call('PUT', { display: { highContrastCards: true, showPotOdds: 'yes', soundEnabled: false } });
  expect(r).toEqual({ status: 200, body: { display: { highContrastCards: true, showPotOdds: true, showStackInBB: false, showHandValue: true } } });
  expect(mockQuery.mock.calls[0][1]).toEqual(['u1', JSON.stringify({ highContrastCards: true })]);
});

test('nothing to save, signed out, or another method is refused', async () => {
  expect((await call('PUT', { display: { soundEnabled: true } })).status).toBe(400);
  expect((await call('DELETE')).status).toBe(405);
  mockUser = null;
  expect((await call('GET')).status).toBe(401);
  expect(mockQuery).not.toHaveBeenCalled();
});
