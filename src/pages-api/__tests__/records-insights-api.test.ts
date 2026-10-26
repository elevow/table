// CI has no database: keep pg and the pool out of these route tests
jest.mock('pg', () => ({ Pool: jest.fn() }));
const mockQuery = jest.fn();
jest.mock('../../../src/lib/database/pool', () => ({ getPool: jest.fn(() => ({ query: mockQuery })) }));
jest.mock('../../../src/lib/auth/auth-utils', () => ({ getAuthenticatedUserId: jest.fn() }));
jest.mock('../../../src/lib/utils/post-hand-result', () => ({ postHandResultToChat: jest.fn() }));

import hudHandler from '../../../pages/api/stats/hud';
import profitHandler from '../../../pages/api/stats/profit';
import exportHandler from '../../../pages/api/history/export';
import { getAuthenticatedUserId } from '../../../src/lib/auth/auth-utils';

const mockAuth = getAuthenticatedUserId as jest.Mock;

function createRes() {
  const res: any = { headers: {} as Record<string, string> };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.send = jest.fn(() => res);
  res.setHeader = jest.fn((k: string, v: string) => { res.headers[k] = v; });
  return res;
}
const req = (query: Record<string, string> = {}, method = 'GET') => ({ method, query, headers: {} }) as any;

const HAND_ID = '0000000a-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const handRow = {
  id: HAND_ID,
  room_id: 'room-1',
  hand_number: 3,
  variant: 'texas-holdem',
  kind: 'normal',
  small_blind: 5,
  big_blind: 10,
  started_at: null,
  ended_at: '2026-10-23T16:05:09.000Z',
  board: [],
  players: [
    { id: 'me', name: 'Me', seat: 1, startStack: 100, endStack: 105, net: 5, won: 15, folded: false, revealed: false, cards: { hole: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }] } },
    { id: 'opp', name: 'Opp', seat: 2, startStack: 100, endStack: 95, net: -5, won: 0, folded: true, revealed: false, cards: { hole: [{ rank: '7', suit: 'hearts' }, { rank: '2', suit: 'clubs' }] } },
  ],
  actions: [
    { playerId: 'me', action: 'small-blind', amount: 5, put: 5, stage: 'preflop' },
    { playerId: 'opp', action: 'big-blind', amount: 10, put: 10, stage: 'preflop' },
    { playerId: 'me', action: 'raise', amount: 30, put: 25, stage: 'preflop' },
    { playerId: 'opp', action: 'fold', put: 0, stage: 'preflop' },
  ],
  winners: [{ playerId: 'me', amount: 15 }],
  pot: 15,
  player_ids: ['me', 'opp'],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue('me');
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/stats/hud', () => {
  it('rejects other methods and signed-out users', async () => {
    let res = createRes();
    await hudHandler(req({}, 'POST'), res);
    expect(res.status).toHaveBeenCalledWith(405);
    mockAuth.mockResolvedValueOnce(null);
    res = createRes();
    await hudHandler(req({ subjects: 'opp' }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns nothing without subjects', async () => {
    const res = createRes();
    await hudHandler(req({ subjects: ' , ' }), res);
    expect(res.json).toHaveBeenCalledWith({ stats: {} });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('computes stats from shared hands only, reading no cards', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { subject: 'opp', actions: handRow.actions, variant: 'texas-holdem', kind: 'normal' },
        { subject: 'opp', actions: JSON.stringify(handRow.actions), variant: 'texas-holdem', kind: 'normal' },
        { subject: 'opp', actions: 'not json', variant: null, kind: null },
      ],
    });
    const res = createRes();
    await hudHandler(req({ subjects: 'opp,opp,stranger' }), res);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('player_ids @> ARRAY[$1, s.subject]::text[]');
    expect(sql).not.toMatch(/players/);
    expect(params).toEqual(['me', ['opp', 'stranger'], 500]);
    const { stats } = res.json.mock.calls[0][0];
    expect(stats.opp).toMatchObject({ hands: 3, vpip: 0, threeBetOpportunities: 2, threeBets: 0 });
    expect(stats.stranger).toMatchObject({ hands: 0, vpip: null });
  });

  it('reports database errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('down'));
    const res = createRes();
    await hudHandler(req({ subjects: 'opp' }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('GET /api/stats/profit', () => {
  it('requires sign-in', async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = createRes();
    await profitHandler(req(), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns the running total, sessions and room names', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'h2', room_id: 'room-1', started_at: '2026-10-23T16:10:00Z', ended_at: '2026-10-23T16:12:00Z', net: '-4' },
          { id: 'h1', room_id: 'room-1', started_at: null, ended_at: '2026-10-23T16:05:00Z', net: '10' },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'room-1', name: 'Friday Game' }] });
    const res = createRes();
    await profitHandler(req(), res);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("elem->>'net'");
    expect(params[0]).toBe('me');
    const body = res.json.mock.calls[0][0];
    expect(body.series.map((p: any) => p.cumulative)).toEqual([10, 6]);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({ roomId: 'room-1', hands: 2, net: 6 });
    expect(body.roomNames).toEqual({ 'room-1': 'Friday Game' });
    expect(body.totals).toEqual({ hands: 2, net: 6 });
    expect(body.truncated).toBe(false);
  });

  it('still answers when room names cannot be read', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'h1', room_id: 'r', started_at: null, ended_at: '2026-10-23T16:05:00Z', net: null }] })
      .mockRejectedValueOnce(new Error('no rooms table'));
    const res = createRes();
    await profitHandler(req(), res);
    expect(res.json.mock.calls[0][0]).toMatchObject({ roomNames: {}, totals: { hands: 1, net: 0 } });
  });

  it('reports database errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('down'));
    const res = createRes();
    await profitHandler(req(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('GET /api/history/export', () => {
  it('validates input and sign-in', async () => {
    let res = createRes();
    await exportHandler(req({}, 'POST'), res);
    expect(res.status).toHaveBeenCalledWith(405);
    mockAuth.mockResolvedValueOnce(null);
    res = createRes();
    await exportHandler(req(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    res = createRes();
    await exportHandler(req({ handId: 'bad' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    res = createRes();
    await exportHandler(req({ from: 'yesterday-ish' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('exports one hand with only the viewer\'s cards', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [handRow] }).mockResolvedValueOnce({ rows: [] });
    const res = createRes();
    await exportHandler(req({ handId: HAND_ID }), res);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('player_ids @> ARRAY[$1]::text[] AND id = $2');
    expect(params).toEqual(['me', HAND_ID, 1]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(res.headers['Content-Disposition']).toBe('attachment; filename="hand-3-0000000a.txt"');
    const text: string = res.send.mock.calls[0][0];
    expect(text).toContain('PokerStars Hand #');
    expect(text).toContain('Dealt to Me [As Ks]');
    // The opponent folded without showing
    expect(text).not.toContain('7h');
    expect(text).not.toContain('2c');
  });

  it('hides hands the viewer was not in', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = createRes();
    await exportHandler(req({ handId: HAND_ID }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('exports many hands filtered by table and dates', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [handRow, { ...handRow, id: 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee', ended_at: '2026-10-22T00:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'room-1', name: 'Friday Game' }] });
    const res = createRes();
    await exportHandler(req({ roomId: 'room-1', from: '2026-10-01T00:00:00Z', to: '2026-10-31T00:00:00Z' }), res);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('room_id = $2 AND ended_at >= $3 AND ended_at <= $4');
    expect(sql).toContain('LIMIT $5');
    expect(params).toEqual(['me', 'room-1', '2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z', 1000]);
    expect(res.headers['Content-Disposition']).toMatch(/^attachment; filename="hands-room-1-\d{4}-\d{2}-\d{2}\.txt"$/);
    const text: string = res.send.mock.calls[0][0];
    expect(text.split('\n\n\n')).toHaveLength(2);
    expect(text).toContain("Table 'Friday Game'");
  });

  it('reports database errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('down'));
    const res = createRes();
    await exportHandler(req(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
