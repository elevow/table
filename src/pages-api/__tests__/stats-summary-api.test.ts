// CI has no database: keep pg and the pool out of these route tests
jest.mock('pg', () => ({ Pool: jest.fn() }));
const mockQuery = jest.fn();
jest.mock('../../../src/lib/database/pool', () => ({ getPool: jest.fn(() => ({ query: mockQuery })) }));
jest.mock('../../../src/lib/auth/auth-utils', () => ({ getAuthenticatedUserId: jest.fn() }));

import handler from '../../../pages/api/stats/summary';
import { getAuthenticatedUserId } from '../../../src/lib/auth/auth-utils';

const mockAuth = getAuthenticatedUserId as jest.Mock;

function createRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn();
  return res;
}
const req = () => ({ method: 'GET', query: {}, headers: {}, socket: {} }) as any;

function answer(rows: { stats?: any[]; totals?: any[]; recent?: any[]; played?: any[] }) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (/FROM player_statistics/.test(sql)) return { rows: rows.stats ?? [] };
    if (/AS winnings/.test(sql)) return { rows: rows.totals ?? [{ winnings: 0, losses: 0 }] };
    if (/SELECT actions/.test(sql)) return { rows: rows.played ?? [] };
    return { rows: rows.recent ?? [] };
  });
}

describe('GET /api/stats/summary', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockAuth.mockReset();
  });

  it('requires a signed-in player', async () => {
    mockAuth.mockResolvedValue(null);
    const res = createRes();
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('takes the leaderboard numbers from player_statistics and the rest from hand records', async () => {
    mockAuth.mockResolvedValue('me');
    answer({
      stats: [{ user_id: 'me', hands_played: '40', hands_won: '12', total_profit: '-35.5', biggest_pot: '220' }],
      totals: [{ winnings: '310', losses: '345.5' }],
      recent: [
        // One table, two sessions three hours apart: 10 minutes, then 5
        { room_id: 'r1', started_at: '2026-11-01T20:05:00Z', ended_at: '2026-11-01T20:10:00Z' },
        { room_id: 'r1', started_at: '2026-11-01T17:00:00Z', ended_at: '2026-11-01T17:10:00Z' },
      ],
    });
    const res = createRes();
    await handler(req(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      handsPlayed: 40,
      handsWon: 12,
      profit: -35.5,
      biggestPot: 220,
      winnings: 310,
      losses: 345.5,
      sessions: 2,
      timePlayedMs: 15 * 60 * 1000,
      hud: expect.objectContaining({ hands: 0 }),
    });
    // Only this player's hands, never ones they deleted
    for (const [sql, params] of mockQuery.mock.calls.filter(([sql]) => /hand_records/.test(sql))) {
      expect(sql).toContain('hidden_for');
      expect(params[0]).toBe('me');
    }
  });

  it('works out how the player plays from their own hands, as the HUD does for others', async () => {
    mockAuth.mockResolvedValue('me');
    const hand = (myAction: string) => ({
      variant: 'texas-holdem',
      kind: 'normal',
      actions: JSON.stringify([
        { playerId: 'opp', action: 'big-blind', amount: 2, put: 2, stage: 'preflop' },
        { playerId: 'me', action: myAction, amount: myAction === 'raise' ? 6 : 0, put: myAction === 'raise' ? 6 : 0, stage: 'preflop' },
      ]),
    });
    answer({ played: [hand('raise'), hand('fold')] });
    const res = createRes();
    await handler(req(), res);

    const { hud } = res.json.mock.calls[0][0];
    expect(hud).toMatchObject({ hands: 2, vpip: 50, pfr: 50 });
    const actionsQuery = mockQuery.mock.calls.find(([sql]) => /SELECT actions/.test(sql));
    expect(actionsQuery[0]).not.toMatch(/players|board/);
  });

  it('reports zeros for a player with no hands', async () => {
    mockAuth.mockResolvedValue('new');
    answer({});
    const res = createRes();
    await handler(req(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ handsPlayed: 0, handsWon: 0, profit: 0, sessions: 0, timePlayedMs: 0 }));
  });
});
