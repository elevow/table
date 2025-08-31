import { describe, it, beforeEach, expect, jest } from '@jest/globals';
import { PlayerStatisticsService } from '../player-statistics-service';

type EnsureExistsFn = (userId: string) => Promise<any>;
type UpdateStatsFn = (userId: string, delta: any) => Promise<any>;
type RecordAchievementFn = (userId: string, type: string, metadata?: any) => Promise<any>;
type ListAchievementsFn = (userId: string, limit?: number, offset?: number) => Promise<any[]>;
type GetLeaderboardFn = (metric: any, limit?: number) => Promise<any[]>;

const mockMgr = {
  ensureExists: jest.fn<EnsureExistsFn>() as jest.MockedFunction<EnsureExistsFn>,
  updateStats: jest.fn<UpdateStatsFn>() as jest.MockedFunction<UpdateStatsFn>,
  recordAchievement: jest.fn<RecordAchievementFn>() as jest.MockedFunction<RecordAchievementFn>,
  listAchievements: jest.fn<ListAchievementsFn>() as jest.MockedFunction<ListAchievementsFn>,
  getLeaderboard: jest.fn<GetLeaderboardFn>() as jest.MockedFunction<GetLeaderboardFn>,
};

jest.mock('../../database/player-statistics-manager', () => ({
  PlayerStatisticsManager: jest.fn().mockImplementation(() => mockMgr),
}));

describe('PlayerStatisticsService (US-022)', () => {
  let svc: PlayerStatisticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new PlayerStatisticsService({} as any);
  });

  it('getOrCreate validates and delegates', async () => {
    mockMgr.ensureExists.mockResolvedValue({ id: 's1', userId: 'u1' });
    await expect(svc.getOrCreate('')).rejects.toThrow('userId is required');
    const res = await svc.getOrCreate('u1');
    expect(res.id).toBe('s1');
    expect(mockMgr.ensureExists).toHaveBeenCalledWith('u1');
  });

  it('update validates numeric delta and delegates', async () => {
    await expect(svc.update('u1', { handsPlayed: 'x' as any })).rejects.toThrow('handsPlayed must be a number');
    await expect(svc.update('', { handsPlayed: 1 })).rejects.toThrow('userId is required');
    await expect(svc.update('u1', null as any)).rejects.toThrow('delta is required');
    mockMgr.updateStats.mockResolvedValue({ id: 's1', userId: 'u1', handsPlayed: 1 });
    const res = await svc.update('u1', { handsPlayed: 2, handsWon: 1, totalProfit: 3.5, biggestPot: 10 });
    expect(res.userId).toBe('u1');
    expect(mockMgr.updateStats).toHaveBeenCalled();
  });

  it('recordAchievement validates and delegates', async () => {
    await expect(svc.recordAchievement('', 'first_win')).rejects.toThrow('userId is required');
    await expect(svc.recordAchievement('u1', '')).rejects.toThrow('type is required');
    mockMgr.recordAchievement.mockResolvedValue({ id: 'a1', userId: 'u1', achievementType: 'first_win' });
    const res = await svc.recordAchievement('u1', 'first_win', { handId: 'h1' });
    expect(res.id).toBe('a1');
    expect(mockMgr.recordAchievement).toHaveBeenCalledWith('u1', 'first_win', { handId: 'h1' });
  });

  it('listAchievements validates and delegates with normalized pagination', async () => {
    mockMgr.listAchievements.mockResolvedValue([{ id: 'a1' }]);
    await expect(svc.listAchievements('', 10, 0)).rejects.toThrow('userId is required');
    const res = await svc.listAchievements('u1', 500, -10); // normalization will clamp
    expect(Array.isArray(res)).toBe(true);
    expect(mockMgr.listAchievements).toHaveBeenCalled();
  });

  it('leaderboard validates metric and delegates', async () => {
    mockMgr.getLeaderboard.mockResolvedValue([{ userId: 'u1', value: 42, rank: 1 }]);
    await expect(svc.leaderboard('invalid' as any, 10)).rejects.toThrow('invalid metric');
    const res = await svc.leaderboard('total_profit', 5);
    expect(res[0].rank).toBe(1);
    expect(mockMgr.getLeaderboard).toHaveBeenCalledWith('total_profit', 5);
  });
});
