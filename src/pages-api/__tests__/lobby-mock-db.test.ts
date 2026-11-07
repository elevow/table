/**
 * @jest-environment node
 */
import type { NextApiRequest, NextApiResponse } from 'next';

const mockGetPool = jest.fn(() => { throw new Error('No database URL found'); });
jest.mock('../../lib/database/pool', () => ({ getPool: () => mockGetPool() }));
jest.mock('../../lib/auth/auth-utils', () => ({ getSessionUser: jest.fn().mockResolvedValue(null) }));
jest.mock('../../lib/auth/access-control', () => ({
  getUserAccess: jest.fn().mockResolvedValue({}),
  hasPermission: jest.fn().mockReturnValue(true),
}));

import handler from '../../../pages/api/games/rooms/lobby';

async function getLobby() {
  const req = { method: 'GET', url: '/api/games/rooms/lobby', headers: {}, query: {}, socket: {} } as unknown as NextApiRequest;
  const res: any = { setHeader: jest.fn() };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  await handler(req, res as NextApiResponse);
  return res;
}

describe('GET /api/games/rooms/lobby', () => {
  afterEach(() => {
    delete process.env.USE_MOCK_DB;
  });

  it('returns empty lists in the mock database run', async () => {
    process.env.USE_MOCK_DB = 'true';
    const res = await getLobby();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ open: [], mine: [], canView: true });
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  it('still fails when a real database is expected but missing', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await getLobby();
    expect(res.status).toHaveBeenCalledWith(500);
    logged.mockRestore();
  });
});
