import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PlayerStatisticsManager } from '../player-statistics-manager';

// Helper to build a row with optional string numerics to exercise toNumber/map
const makeRow = (overrides: Partial<any> = {}) => ({
  id: 's1',
  user_id: 'u1',
  hands_played: overrides.hands_played ?? 10,
  hands_won: overrides.hands_won ?? 4,
  total_profit: overrides.total_profit ?? '12.5',
  biggest_pot: overrides.biggest_pot ?? '50.0',
  last_updated: overrides.last_updated ?? new Date('2023-01-01T00:00:00Z'),
  game_specific_stats: overrides.game_specific_stats ?? { nlhe: { vpip: 25 } },
  ...overrides,
});

describe('PlayerStatisticsManager (US-022)', () => {
  type QueryResult = { rows: any[]; rowCount?: number; command?: string };
  type QueryFn = (...args: any[]) => Promise<QueryResult>;
  let query: jest.MockedFunction<QueryFn>;
  let mgr: PlayerStatisticsManager;

  beforeEach(() => {
  // Explicitly type the mock to avoid TS inferring `never` for mockResolvedValueOnce
  query = jest.fn<QueryFn>() as jest.MockedFunction<QueryFn>;
    mgr = new PlayerStatisticsManager({ query } as any);
    jest.clearAllMocks();
  });

  it('getByUserId returns null when not found and maps when found', async () => {
    // Not found
  query.mockResolvedValueOnce({ rows: [] });
    expect(await mgr.getByUserId('u-missing')).toBeNull();

    // Found and mapping of numeric strings
    const row = makeRow({ user_id: 'u2', total_profit: '20.75', biggest_pot: '99.9' });
    query.mockResolvedValueOnce({ rows: [row] });
    const rec = await mgr.getByUserId('u2');
    expect(rec).toMatchObject({ userId: 'u2', totalProfit: 20.75, biggestPot: 99.9, handsPlayed: 10, handsWon: 4 });
  });

  it('ensureExists inserts when absent and returns existing when present', async () => {
    // Absent -> INSERT -> RETURNING
  query
      .mockResolvedValueOnce({ rows: [] }) // getByUserId -> none
      .mockResolvedValueOnce({ rows: [makeRow({ user_id: 'u3', hands_played: 0, hands_won: 0, total_profit: 0, biggest_pot: 0 })] });

    const created = await mgr.ensureExists('u3');
    expect(created).toMatchObject({ userId: 'u3', handsPlayed: 0, handsWon: 0, totalProfit: 0, biggestPot: 0 });

    // Present -> no insert
    const existingRow = makeRow({ user_id: 'u4', hands_played: 5 });
  query.mockResolvedValueOnce({ rows: [existingRow] });
    const existing = await mgr.ensureExists('u4');
    expect(existing).toMatchObject({ userId: 'u4', handsPlayed: 5 });
  });

  it('updateStats increments fields and applies set-if-greater on biggest_pot (no decrease)', async () => {
    // Current state with biggest_pot 50
  query
      .mockResolvedValueOnce({ rows: [makeRow({ user_id: 'u5', biggest_pot: '50' })] }) // ensureExists/getByUserId
      .mockResolvedValueOnce({ rows: [makeRow({ user_id: 'u5', hands_played: 12, hands_won: 5, total_profit: '15.5', biggest_pot: '80' })] }); // UPDATE returning

    const res = await mgr.updateStats('u5', { handsPlayed: 2, handsWon: 1, totalProfit: 3, biggestPot: 80 });
    expect(res).toMatchObject({ userId: 'u5', handsPlayed: 12, handsWon: 5, totalProfit: 15.5, biggestPot: 80 });

    // Now try with a lower biggestPot; should not reduce
  query
      .mockResolvedValueOnce({ rows: [makeRow({ user_id: 'u6', biggest_pot: '50' })] }) // ensureExists/getByUserId
      .mockResolvedValueOnce({ rows: [makeRow({ user_id: 'u6', biggest_pot: '50', hands_played: 11 })] }); // UPDATE returning

    const res2 = await mgr.updateStats('u6', { handsPlayed: 1, biggestPot: 40 });
    expect(res2.biggestPot).toBe(50);

    // Validate call shapes
    const [sql1] = query.mock.calls[1];
    expect(String(sql1)).toContain('UPDATE player_statistics');
  });

  it('recordAchievement inserts and maps', async () => {
    const achRow = { id: 'a1', user_id: 'u7', achievement_type: 'first_win', achieved_at: new Date('2023-02-02T00:00:00Z'), metadata: { handId: 'h1' } };
  query.mockResolvedValueOnce({ rows: [achRow] });
    const rec = await mgr.recordAchievement('u7', 'first_win', { handId: 'h1' });
    expect(rec).toEqual({ id: 'a1', userId: 'u7', achievementType: 'first_win', achievedAt: achRow.achieved_at, metadata: { handId: 'h1' } });
  });

  it('listAchievements orders and maps', async () => {
    const now = new Date();
  query.mockResolvedValueOnce({ rows: [
      { id: 'a2', user_id: 'u8', achievement_type: 'royal_flush', achieved_at: now, metadata: null },
      { id: 'a1', user_id: 'u8', achievement_type: 'first_win', achieved_at: now, metadata: { handId: 'h1' } },
    ]});

    const list = await mgr.listAchievements('u8', 10, 0);
    expect(list.map(a => a.id)).toEqual(['a2', 'a1']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM achievements'), ['u8', 10, 0]);
  });

  it('getLeaderboard maps and ranks results; converts numeric strings', async () => {
  query.mockResolvedValueOnce({ rows: [
      { user_id: 'u9', value: '100.5' },
      { user_id: 'u10', value: 50 },
    ]});

    const lb = await mgr.getLeaderboard('total_profit', 2);
    expect(lb).toEqual([
      { userId: 'u9', value: 100.5, rank: 1 },
      { userId: 'u10', value: 50, rank: 2 },
    ]);
    expect(query.mock.calls[0][0]).toContain('ORDER BY total_profit DESC');
  });
});
