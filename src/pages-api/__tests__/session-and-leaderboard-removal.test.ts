import type { NextApiRequest, NextApiResponse } from 'next';

let mockCaller: { userId: string; permissions: Set<string> } | null = null;
const mockLog = jest.fn();
jest.mock('../../lib/auth/access-control', () => ({
  requirePermission: async (_req: any, res: any, permission: string) => {
    if (!mockCaller?.permissions.has(permission)) {
      res.status(403).json({ code: 'PERMISSION_DENIED', permission });
      return null;
    }
    return mockCaller;
  },
  logAdminAction: (...args: any[]) => mockLog(...args),
}));
const mockQuery = jest.fn();
jest.mock('../../lib/database/pool', () => ({ getPool: () => ({ query: (...args: any[]) => mockQuery(...args) }) }));
const mockDeleteSessions = jest.fn();
jest.mock('../../lib/server/hidden-hands', () => ({ deleteSessions: (...args: any[]) => mockDeleteSessions(...args) }));
jest.mock('../../lib/api/rate-limit', () => ({ rateLimit: () => ({ allowed: true }) }));

import deleteHandler from '../../../pages/api/stats/sessions/delete';
import leaderboardHandler from '../../../pages/api/admin/leaderboard';

async function call(handler: (req: NextApiRequest, res: NextApiResponse) => unknown, method: string, body?: any) {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  await handler({ method, body, query: {}, headers: {} } as any, res);
  return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}

const as = (...permissions: string[]) => { mockCaller = { userId: 'me', permissions: new Set(permissions) }; };

beforeEach(() => {
  mockQuery.mockReset();
  mockLog.mockReset();
  mockDeleteSessions.mockReset().mockResolvedValue({ hands: 3, net: -12.5 });
});

describe('POST /api/stats/sessions/delete', () => {
  test('needs stats.delete_sessions', async () => {
    as('history.view_own');
    expect((await call(deleteHandler, 'POST', { all: true })).status).toBe(403);
    expect(mockDeleteSessions).not.toHaveBeenCalled();
  });

  test('deletes one session of the signed-in player', async () => {
    as('stats.delete_sessions');
    const res = await call(deleteHandler, 'POST', { roomId: 'r1', start: 1000, end: 5000, userId: 'someone-else' });
    expect(res).toEqual({ status: 200, body: { hands: 3, net: -12.5 } });
    // Always the caller's own hands, whatever the body says
    expect(mockDeleteSessions).toHaveBeenCalledWith(expect.anything(), 'me', { roomId: 'r1', start: 1000, end: 5000 });
  });

  test('deletes every session', async () => {
    as('stats.delete_sessions');
    await call(deleteHandler, 'POST', { all: true });
    expect(mockDeleteSessions).toHaveBeenCalledWith(expect.anything(), 'me', { all: true });
  });

  test('rejects anything else', async () => {
    as('stats.delete_sessions');
    for (const body of [{}, { roomId: 'r1' }, { roomId: 'r1', start: 5, end: 1 }, { all: 'yes' }, { roomId: 1, start: 1, end: 2 }]) {
      expect((await call(deleteHandler, 'POST', body)).status).toBe(400);
    }
    expect((await call(deleteHandler, 'GET')).status).toBe(405);
    expect(mockDeleteSessions).not.toHaveBeenCalled();
  });
});

describe('/api/admin/leaderboard', () => {
  test('needs admin.leaderboard', async () => {
    as('stats.delete_sessions');
    expect((await call(leaderboardHandler, 'GET')).status).toBe(403);
    expect((await call(leaderboardHandler, 'POST', { userId: 'u1', hidden: true })).status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('lists the hidden players', async () => {
    as('admin.leaderboard');
    mockQuery.mockResolvedValue({ rows: [{ user_id: 'u1', username: 'test1', hands_played: '40' }] });
    const res = await call(leaderboardHandler, 'GET');
    expect(res.body).toEqual({ hidden: [{ userId: 'u1', username: 'test1', handsPlayed: 40 }] });
    expect(mockQuery.mock.calls[0][0]).toContain('WHERE ps.leaderboard_hidden');
  });

  test('hides and restores a player, and logs it', async () => {
    as('admin.leaderboard');
    mockQuery.mockResolvedValue({ rowCount: 1 });
    expect(await call(leaderboardHandler, 'POST', { userId: 'u1', hidden: true })).toEqual({ status: 200, body: { userId: 'u1', hidden: true } });
    expect(mockQuery.mock.calls[0][1]).toEqual(['u1', true]);
    expect(mockLog).toHaveBeenCalledWith('me', 'leaderboard.hide', 'user', 'u1');
    await call(leaderboardHandler, 'POST', { userId: 'u1', hidden: false });
    expect(mockLog).toHaveBeenLastCalledWith('me', 'leaderboard.restore', 'user', 'u1');
  });

  test('404 for a player with no statistics, 400 for a bad body', async () => {
    as('admin.leaderboard');
    mockQuery.mockResolvedValue({ rowCount: 0 });
    expect((await call(leaderboardHandler, 'POST', { userId: 'nobody', hidden: true })).status).toBe(404);
    expect((await call(leaderboardHandler, 'POST', { userId: 'u1', hidden: 'yes' })).status).toBe(400);
    expect(mockLog).not.toHaveBeenCalled();
  });
});
