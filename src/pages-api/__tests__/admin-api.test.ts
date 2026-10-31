import type { NextApiRequest, NextApiResponse } from 'next';

const mockQuery = jest.fn();
jest.mock('../../../src/lib/database/pool', () => ({
  getPool: () => ({ query: (...args: any[]) => mockQuery(...args) }),
}));
jest.mock('../../../src/lib/api/rate-limit', () => ({ rateLimit: jest.fn().mockReturnValue({ allowed: true }) }));
jest.mock('../../../src/lib/shared/game-seats', () => ({
  getRoomStats: jest.fn().mockReturnValue({ roomId: 'r1', currentPlayers: 0, playerList: [] }),
  getActiveRooms: jest.fn().mockReturnValue([]),
}));
jest.mock('../../../src/lib/shared/rebuy-tracker', () => ({ getRoomRebuySnapshot: jest.fn().mockReturnValue([]) }));

import roomStatsHandler from '../../../pages/api/admin/room-stats';
import alertsHandler from '../../../pages/api/admin/alerts/index';
import checkAdminHandler from '../../../pages/api/auth/check-admin';

function makeReq(headers: Record<string, string> = {}): NextApiRequest {
  return { method: 'GET', headers, cookies: {}, query: {} } as unknown as NextApiRequest;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as NextApiResponse & { status: jest.Mock; json: jest.Mock };
}

describe('admin API session auth', () => {
  const ORIGINAL_ADMIN_EMAILS = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'admin@example.com';
    mockQuery.mockReset();
  });

  afterAll(() => {
    process.env.ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
  });

  test('room-stats ignores a claimed x-user-email header', async () => {
    const res = makeRes();
    await roomStatsHandler(makeReq({ 'x-user-email': 'admin@example.com' }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('room-stats rejects a signed-in non-admin', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'u1', email: 'player@example.com' }] });
    const res = makeRes();
    await roomStatsHandler(makeReq({ authorization: 'Bearer tok' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('room-stats allows a signed-in admin', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'u1', email: 'admin@example.com' }] });
    const res = makeRes();
    await roomStatsHandler(makeReq({ authorization: 'Bearer tok' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('alerts no longer accept the shared x-admin-token', async () => {
    process.env.ADMIN_API_TOKEN = 'secret';
    const res = makeRes();
    await alertsHandler(makeReq({ 'x-admin-token': 'secret' }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    delete process.env.ADMIN_API_TOKEN;
  });

  test('check-admin only looks up session tokens', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'u1', email: 'admin@example.com' }] });
    const res = makeRes();
    await checkAdminHandler(makeReq({ authorization: 'Bearer tok' }), res);
    expect(mockQuery.mock.calls[0][0]).toContain("at.type = 'session'");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: true, email: 'admin@example.com' }));
    expect(res.json.mock.calls[0][0].permissions).toContain('roles.edit');
  });
});
