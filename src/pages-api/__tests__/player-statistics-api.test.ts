import type { NextApiRequest, NextApiResponse } from 'next';

import getHandler from '../../../pages/api/stats/get';
import updateHandler from '../../../pages/api/stats/update';
import recordHandler from '../../../pages/api/stats/achievements/record';
import listHandler from '../../../pages/api/stats/achievements/list';
import leaderboardHandler from '../../../pages/api/stats/leaderboard';

jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({})) }));
jest.mock('../../../src/lib/api/rate-limit', () => ({ rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 }) }));

const mockService: any = {
  getOrCreate: jest.fn(),
  update: jest.fn(),
  recordAchievement: jest.fn(),
  listAchievements: jest.fn(),
  leaderboard: jest.fn(),
};

jest.mock('../../../src/lib/services/player-statistics-service', () => ({
  PlayerStatisticsService: jest.fn().mockImplementation(() => mockService),
}));

function resHelper() {
  const res: Partial<NextApiResponse> & { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as any;
  return res;
}

function reqHelper(method: string, body?: any, query?: any): Partial<NextApiRequest> {
  return { method, body, query, headers: {}, socket: { remoteAddress: '127.0.0.1' } as any } as any;
}

describe('Player Statistics API (US-022)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GET /api/stats/get returns stats', async () => {
    mockService.getOrCreate.mockResolvedValue({ id: 's1', userId: 'u1' });
    const req = reqHelper('GET', undefined, { userId: 'u1' });
    const res = resHelper();
    await getHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: 's1', userId: 'u1' });
  });

  it('POST /api/stats/update returns updated stats', async () => {
    mockService.update.mockResolvedValue({ id: 's1', userId: 'u1', handsPlayed: 10 });
    const req = reqHelper('POST', { userId: 'u1', delta: { handsPlayed: 5 } });
    const res = resHelper();
    await updateHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: 's1', userId: 'u1', handsPlayed: 10 });
  });

  it('POST /api/stats/achievements/record returns created achievement', async () => {
    mockService.recordAchievement.mockResolvedValue({ id: 'a1', userId: 'u1', achievementType: 'first_win' });
    const req = reqHelper('POST', { userId: 'u1', achievementType: 'first_win', metadata: { handId: 'h1' } });
    const res = resHelper();
    await recordHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'a1', userId: 'u1', achievementType: 'first_win' });
  });

  it('GET /api/stats/achievements/list returns items array', async () => {
    mockService.listAchievements.mockResolvedValue([{ id: 'a1' }]);
    const req = reqHelper('GET', undefined, { userId: 'u1', limit: '10', offset: '0' });
    const res = resHelper();
    await listHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ items: [{ id: 'a1' }] });
  });

  it('GET /api/stats/leaderboard returns items array', async () => {
    mockService.leaderboard.mockResolvedValue([{ userId: 'u1', value: 100, rank: 1 }]);
    const req = reqHelper('GET', undefined, { metric: 'total_profit', limit: '5' });
    const res = resHelper();
    await leaderboardHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ items: [{ userId: 'u1', value: 100, rank: 1 }] });
  });
});
