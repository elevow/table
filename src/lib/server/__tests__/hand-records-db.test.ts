jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('../../database/pool', () => ({ getPool: jest.fn() }));
jest.mock('../../utils/post-hand-result', () => ({ postHandResultToChat: jest.fn(), postSystemChatMessage: jest.fn() }));
jest.mock('../../database/player-statistics-manager', () => ({ PlayerStatisticsManager: jest.fn() }));

import { getPool } from '../../database/pool';
import { postHandResultToChat, postSystemChatMessage } from '../../utils/post-hand-result';
import { PlayerStatisticsManager } from '../../database/player-statistics-manager';
import {
  applyHandToStatistics,
  buildHandRecord,
  finishHand,
  handExtras,
  markCardsShown,
  recordLateSevenDeuceBounty,
  redactHandRecord,
  rowToHandRecord,
  saveHandRecord,
  summarizeHand,
} from '../hand-records';

const c = (rank: string, suit: string): any => ({ rank, suit });

const player = (overrides: Record<string, unknown> = {}): any => ({
  id: 'a',
  name: 'A',
  seat: 1,
  startStack: 1000,
  endStack: 1100,
  net: 100,
  won: 200,
  folded: false,
  cards: { hole: [c('A', 'hearts'), c('A', 'diamonds')] },
  revealed: true,
  ...overrides,
});

const record = (overrides: Record<string, unknown> = {}): any => ({
  id: 'hand-1',
  roomId: 'room-1',
  handNumber: 3,
  variant: 'texas-holdem',
  kind: 'normal',
  smallBlind: 5,
  bigBlind: 10,
  startedAt: null,
  endedAt: '2026-01-01T00:00:00.000Z',
  board: [c('A', 'spades'), c('A', 'clubs'), c('2', 'diamonds'), c('7', 'hearts'), c('9', 'spades')],
  players: [player(), player({ id: 'b', name: 'B', net: -100, won: 0, endStack: 900, cards: { hole: [c('K', 'hearts'), c('K', 'diamonds')] } })],
  actions: [],
  winners: [{ playerId: 'a', amount: 200 }],
  pot: 200,
  ...overrides,
});

const showdownState = (overrides: Record<string, unknown> = {}): any => ({
  stage: 'showdown',
  handId: `hand-${Math.random()}`,
  smallBlind: 5,
  bigBlind: 10,
  players: [
    { id: 'a', name: 'A', position: 1, stack: 1010, holeCards: [c('A', 'hearts'), c('A', 'diamonds')], isFolded: false },
    { id: 'b', name: 'B', position: 2, stack: 990, holeCards: [c('K', 'hearts'), c('K', 'diamonds')], isFolded: false },
  ],
  handStartStacks: { a: 1000, b: 1000 },
  handResult: { winnings: { a: 20 } },
  handWinners: ['a'],
  communityCards: [],
  ...overrides,
});

describe('hand records storage', () => {
  let query: jest.Mock;
  let updateStats: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    query = jest.fn().mockResolvedValue({ rowCount: 1 });
    (getPool as jest.Mock).mockReturnValue({ query });
    updateStats = jest.fn().mockResolvedValue({ handsPlayed: 1, handsWon: 0 });
    (PlayerStatisticsManager as unknown as jest.Mock).mockImplementation(() => ({ updateStats }));
  });

  afterEach(() => jest.restoreAllMocks());

  describe('buildHandRecord', () => {
    it('returns null for a hand that has not ended', () => {
      expect(buildHandRecord('room-1', showdownState({ stage: 'river' }))).toBeNull();
      expect(buildHandRecord('room-1', showdownState({ handId: undefined }))).toBeNull();
    });

    it('returns null when nobody was dealt in', () => {
      const state = showdownState({ players: [{ id: 'a', position: 1, stack: 1000, holeCards: [] }] });
      expect(buildHandRecord('room-1', state)).toBeNull();
    });

    it('records stud cards and falls back to defaults for missing fields', () => {
      const state = showdownState({
        handStartStacks: undefined,
        handResult: undefined,
        variant: undefined,
        handNumber: undefined,
        handStartedAt: Date.UTC(2026, 0, 1),
        communityCards: undefined,
        players: [
          { id: 'a', position: 1, stack: 1000, holeCards: [] },
          { id: 'b', name: 'B', position: 2, stack: 1000, holeCards: [] },
        ],
        studState: { playerCards: { a: { downCards: [c('2', 'hearts')], upCards: [c('3', 'hearts')] }, b: {} } },
      });
      const rec = buildHandRecord('room-1', state)!;
      expect(rec.players).toHaveLength(1);
      expect(rec.players[0]).toMatchObject({ name: 'a', startStack: 1000, net: 0, won: 0, cards: { down: [c('2', 'hearts')], up: [c('3', 'hearts')] } });
      expect(rec.variant).toBe('texas-holdem');
      expect(rec.handNumber).toBe(0);
      expect(rec.startedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(rec.board).toEqual([]);
      expect(rec.pot).toBe(0);
    });
  });

  describe('saveHandRecord', () => {
    it('reports whether the hand was newly stored', async () => {
      const pool: any = { query };
      await expect(saveHandRecord(pool, record())).resolves.toBe(true);
      const params = query.mock.calls[0][1];
      expect(params[0]).toBe('hand-1');
      expect(params[14]).toEqual(['a', 'b']);
      expect(params[15]).toBeNull();

      query.mockResolvedValueOnce({ rowCount: 0 });
      await expect(saveHandRecord(pool, record({ kind: undefined, runBoards: [[c('A', 'spades')], [c('K', 'spades')]] }))).resolves.toBe(false);
      const params2 = query.mock.calls[1][1];
      expect(params2[4]).toBe('normal');
      expect(params2[15]).toBe(JSON.stringify([[c('A', 'spades')], [c('K', 'spades')]]));

      query.mockResolvedValueOnce({});
      await expect(saveHandRecord(pool, record())).resolves.toBe(false);
    });
  });

  describe('applyHandToStatistics', () => {
    const awards = () => query.mock.calls.filter(c => String(c[0]).includes('INSERT INTO achievements'));
    const awarded = () => awards().map(c => c[1][1]);

    it('updates every player and awards first-hand and first-win achievements', async () => {
      await applyHandToStatistics({ query } as any, record());
      expect(updateStats).toHaveBeenCalledWith('a', { handsPlayed: 1, handsWon: 1, totalProfit: 100, biggestPot: 200 });
      expect(updateStats).toHaveBeenCalledWith('b', { handsPlayed: 1, handsWon: 0, totalProfit: -100, biggestPot: undefined });
      expect(awarded()).toEqual(['first_hand', 'first_win', 'quads_plus', 'first_hand']);
    });

    it('casts each parameter, since Postgres rejects one used both as a value and against a column', async () => {
      await applyHandToStatistics({ query } as any, record());
      const sql: string = awards()[0][0];
      expect(sql).toContain('SELECT $1::uuid, $2::varchar, $3::jsonb');
      expect(sql).toContain('user_id = $1::uuid AND achievement_type = $2::varchar');
    });

    it('awards milestone, big pot, double up, bomb pot and quads achievements', async () => {
      updateStats.mockResolvedValue({ handsPlayed: 1000, handsWon: 100 });
      await applyHandToStatistics({ query } as any, record({
        kind: 'bomb-pot',
        pot: 2000,
        players: [
          player({ net: 1000 }),
          player({ id: 'b', won: 0, net: -1000, cards: { hole: [c('K', 'hearts'), c('K', 'diamonds')] } }),
        ],
      }));
      expect(awarded()).toEqual(expect.arrayContaining([
        'hands_100', 'hands_1000', 'wins_100', 'big_pot', 'double_up', 'bomb_pot_win', 'quads_plus',
      ]));
    });

    it('evaluates Omaha hands and skips the rank when cards are missing or invalid', async () => {
      await applyHandToStatistics({ query } as any, record({
        variant: 'omaha',
        players: [
          player({ cards: { hole: [c('A', 'hearts'), c('A', 'diamonds'), c('3', 'clubs'), c('4', 'clubs')] } }),
          player({ id: 'b', won: 0, net: 0, cards: { hole: [c('K', 'hearts'), c('K', 'diamonds'), c('5', 'clubs'), c('6', 'clubs')] } }),
        ],
      }));
      expect(awarded()).toContain('quads_plus');

      query.mockClear();
      await applyHandToStatistics({ query } as any, record({
        players: [
          player({ cards: { hole: ['bad', 'cards'] } }),
          player({ id: 'b', won: 0, cards: undefined }),
        ],
      }));
      expect(awarded()).not.toContain('quads_plus');
    });

    it('awards a royal flush, and beating four of a kind or a straight flush at showdown', async () => {
      const board = [c('10', 'spades'), c('J', 'spades'), c('Q', 'spades'), c('9', 'hearts'), c('9', 'diamonds')];
      await applyHandToStatistics({ query } as any, record({
        board,
        players: [
          player({ cards: { hole: [c('A', 'spades'), c('K', 'spades')] } }),
          player({ id: 'b', won: 0, net: -100, cards: { hole: [c('9', 'spades'), c('8', 'spades')] } }),
        ],
      }));
      expect(awarded()).toEqual(expect.arrayContaining(['royal_flush', 'beat_quads', 'beat_straight_flush']));
    });

    it('awards beating four of a kind only to the winner, and not for a split pot', async () => {
      const board = [c('Q', 'hearts'), c('Q', 'diamonds'), c('2', 'clubs'), c('2', 'diamonds'), c('7', 'spades')];
      // a's queens beat b's deuces: four of a kind against four of a kind
      const deuces = player({ id: 'b', won: 0, net: -100, cards: { hole: [c('2', 'hearts'), c('2', 'spades')] } });
      const queens = player({ cards: { hole: [c('Q', 'clubs'), c('Q', 'spades')] } });
      await applyHandToStatistics({ query } as any, record({ board, players: [queens, deuces] }));
      expect(awards().filter(call => call[1][1] === 'beat_quads').map(call => call[1][0])).toEqual(['a']);

      query.mockClear();
      await applyHandToStatistics({ query } as any, record({ board, players: [queens, { ...deuces, won: 100 }] }));
      expect(awarded()).not.toContain('beat_quads');
    });

    it('awards winning Omaha while holding three of a kind', async () => {
      await applyHandToStatistics({ query } as any, record({
        variant: 'omaha',
        players: [
          player({ cards: { hole: [c('8', 'hearts'), c('8', 'diamonds'), c('8', 'clubs'), c('4', 'clubs')] } }),
          player({ id: 'b', won: 0, net: -100, cards: { hole: [c('K', 'hearts'), c('Q', 'diamonds'), c('5', 'clubs'), c('6', 'clubs')] } }),
        ],
      }));
      expect(awarded()).toContain('omaha_trips');

      query.mockClear();
      await applyHandToStatistics({ query } as any, record({
        players: [
          player({ cards: { hole: [c('8', 'hearts'), c('8', 'diamonds')] } }),
          player({ id: 'b', won: 0, net: -100 }),
        ],
      }));
      expect(awarded()).not.toContain('omaha_trips');
    });

    it('awards hammer tiers from the count of 7-2 offsuit wins', async () => {
      query.mockImplementation(async (sql: string) => (String(sql).includes('COUNT(*)::int AS wins') ? { rows: [{ wins: 7 }] } : { rowCount: 1, rows: [] }));
      await applyHandToStatistics({ query } as any, record({
        players: [player({ cards: { hole: [c('7', 'hearts'), c('2', 'diamonds')] } }), player({ id: 'b', won: 0, folded: true })],
      }));
      expect(awarded()).toEqual(expect.arrayContaining(['hammer', 'hammer_7']));
      expect(awarded()).not.toContain('hammer_72');
    });

    it('still awards the first hammer when the count cannot be read', async () => {
      query.mockImplementation(async (sql: string) => {
        if (String(sql).includes('COUNT(*)::int AS wins')) throw new Error('db down');
        return { rowCount: 1, rows: [] };
      });
      await applyHandToStatistics({ query } as any, record({
        players: [player({ cards: { hole: [c('7', 'hearts'), c('2', 'diamonds')] } }), player({ id: 'b', won: 0, folded: true })],
      }));
      expect(awarded()).toContain('hammer');
    });

    it("looks up a winner's earlier hands at the table for streaks", async () => {
      const earlier = [1, 2, 3, 4].map(i => ({
        id: `h${i}`, started_at: null, ended_at: new Date(Date.parse('2026-01-01T00:00:00.000Z') - i * 60_000).toISOString(),
        big_blind: '10', variant: 'texas-holdem', me: { startStack: 1000, endStack: 1100, net: 100, won: 200, folded: false },
      }));
      query.mockImplementation(async (sql: string) => (String(sql).includes('p AS me')
        ? { rows: earlier }
        : { rowCount: 1, rows: [] }));
      await applyHandToStatistics({ query } as any, record());
      expect(awards().filter(call => call[1][1] === 'heater').map(call => call[1][0])).toEqual(['a']);
    });

    it('awards deja vu for the same hole cards as the hand before', async () => {
      query.mockImplementation(async (sql: string) => (String(sql).startsWith('SELECT players FROM hand_records')
        ? { rows: [{ players: [player({ cards: { hole: [c('A', 'diamonds'), c('A', 'hearts')] } })] }] }
        : { rowCount: 1, rows: [] }));
      await applyHandToStatistics({ query } as any, record());
      expect(awards().filter(call => call[1][1] === 'deja_vu').map(call => call[1][0])).toEqual(['a']);
    });

    it('takes the splash, hi-lo halves and run winners from the final state', () => {
      const state = showdownState({
        handStartedAt: 1_000,
        lastSplash: { playerId: 'a', amount: 40, at: 2_000 },
        lastHiLoResult: { high: [{ playerId: 'a', amount: 10 }], low: null },
        runItTwice: { results: [{ winners: [{ playerId: 'a' }] }, { winners: [{ playerId: 'b' }] }] },
      });
      expect(handExtras(state)).toEqual({
        splashedBy: ['a'],
        hiLo: { high: [{ playerId: 'a', amount: 10 }], low: null },
        runWinners: [['a'], ['b']],
      });
      // A splash from an earlier hand doesn't count
      expect(handExtras({ ...state, lastSplash: { playerId: 'a', amount: 40, at: 500 } }).splashedBy).toBeUndefined();
    });

    it('keeps going when one player fails', async () => {
      updateStats.mockRejectedValueOnce(new Error('db down'));
      await applyHandToStatistics({ query } as any, record());
      expect(updateStats).toHaveBeenCalledTimes(2);
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('finishHand', () => {
    it('ignores hands that have not ended', async () => {
      await finishHand('room-1', showdownState({ stage: 'river' }));
      expect(query).not.toHaveBeenCalled();
      expect(postHandResultToChat).not.toHaveBeenCalled();
    });

    it('stores the hand, updates statistics and posts once', async () => {
      const state = showdownState();
      await finishHand('room-1', state);
      await finishHand('room-1', state);
      expect(updateStats).toHaveBeenCalledTimes(2);
      expect(postHandResultToChat).toHaveBeenCalledTimes(1);
    });

    it('does nothing more when another instance stored the hand first', async () => {
      query.mockResolvedValue({ rowCount: 0 });
      await finishHand('room-1', showdownState());
      expect(updateStats).not.toHaveBeenCalled();
      expect(postHandResultToChat).not.toHaveBeenCalled();
    });

    it('still posts to chat without a database, and survives chat failures', async () => {
      (getPool as jest.Mock).mockImplementation(() => { throw new Error('no db'); });
      (postHandResultToChat as jest.Mock).mockRejectedValueOnce(new Error('chat down'));
      await finishHand('room-1', showdownState());
      expect(postHandResultToChat).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledTimes(2);
    });

    it('posts to chat for a hand with no record, keyed by turn', async () => {
      const state = showdownState({ handId: undefined, turnSeq: 991 });
      await finishHand('room-x', state);
      await finishHand('room-x', state);
      expect(query).not.toHaveBeenCalled();
      expect(postHandResultToChat).toHaveBeenCalledTimes(1);
    });
  });

  it('markCardsShown updates the stored hand', async () => {
    await markCardsShown('hand-1', 'b');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE hand_records'), ['hand-1', 'b']);
  });

  describe('recordLateSevenDeuceBounty', () => {
    const bountyState = () => showdownState({
      handId: 'hand-1',
      players: [
        { id: 'a', name: 'A', position: 1, stack: 1015, holeCards: [c('7', 'hearts'), c('2', 'clubs')], isFolded: false },
        { id: 'b', name: 'B', position: 2, stack: 985, holeCards: [c('K', 'hearts'), c('K', 'diamonds')], isFolded: true },
      ],
      handActions: [
        { playerId: 'b', action: 'fold', put: 0, stage: 'preflop' },
        { playerId: 'b', action: 'bounty', put: 5, stage: 'showdown', toPlayerId: 'a' },
      ],
      sevenDeuceResult: { playerId: 'a', total: 5, payments: { b: 5 } },
    });

    it('adds the bounty to the stored hand and announces it', async () => {
      query.mockResolvedValueOnce({
        rows: [{
          players: JSON.stringify([
            player({ endStack: 1010, net: 10, revealed: false }),
            player({ id: 'b', name: 'B', startStack: 1000, endStack: 990, net: -10, revealed: false }),
          ]),
          actions: [{ playerId: 'b', action: 'fold', put: 0, stage: 'preflop' }],
        }],
      });
      await recordLateSevenDeuceBounty('room-1', bountyState());
      const [sql, params] = query.mock.calls[1];
      expect(sql).toContain('UPDATE hand_records');
      const players = JSON.parse(params[1]);
      expect(players[0]).toMatchObject({ id: 'a', endStack: 1015, net: 15, revealed: true });
      expect(players[1]).toMatchObject({ id: 'b', endStack: 985, net: -15, revealed: false });
      expect(JSON.parse(params[2]).map((x: any) => x.action)).toEqual(['fold', 'bounty']);
      expect(postSystemChatMessage).toHaveBeenCalledWith('room-1', '💰 7-2 bounty: A collects $5');
    });

    it('does not add the bounty twice', async () => {
      query.mockResolvedValueOnce({ rows: [{ players: [], actions: [{ playerId: 'b', action: 'bounty', put: 5, stage: 'showdown' }] }] });
      await recordLateSevenDeuceBounty('room-1', bountyState());
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('still announces it when the database is unavailable, and does nothing without a bounty', async () => {
      query.mockRejectedValueOnce(new Error('no db'));
      await recordLateSevenDeuceBounty('room-1', bountyState());
      expect(postSystemChatMessage).toHaveBeenCalledTimes(1);
      await recordLateSevenDeuceBounty('room-1', showdownState());
      expect(postSystemChatMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('rowToHandRecord', () => {
    it('parses JSON columns from strings or objects', () => {
      const rec = rowToHandRecord({
        id: 'h', room_id: 'r', hand_number: '4', variant: null, kind: 'bomb-pot',
        small_blind: '5', big_blind: '10', started_at: '2026-01-01T00:00:00Z', ended_at: '2026-01-01T00:01:00Z',
        board: '["As"]', run_boards: [[c('A', 'spades')], [c('K', 'spades')]], players: [{ id: 'a' }], actions: 'not json', winners: null, pot: '30',
      });
      expect(rec).toMatchObject({
        handNumber: 4, variant: 'texas-holdem', kind: 'bomb-pot', smallBlind: 5, bigBlind: 10,
        startedAt: '2026-01-01T00:00:00.000Z', board: ['As'], runBoards: [[c('A', 'spades')], [c('K', 'spades')]],
        players: [{ id: 'a' }], actions: [], winners: [], pot: 30,
      });
    });

    it('defaults kind, start time and run boards', () => {
      const rec = rowToHandRecord({ id: 'h', ended_at: '2026-01-01T00:01:00Z', kind: 'other' });
      expect(rec.kind).toBe('normal');
      expect(rec.startedAt).toBeNull();
      expect(rec.runBoards).toBeUndefined();
    });
  });

  it('redactHandRecord keeps stud up cards visible and hides the rest', () => {
    const rec = record({
      players: [
        player({ id: 'me', revealed: false }),
        player({ id: 'shown', revealed: true }),
        player({ id: 'stud', revealed: false, cards: { down: [c('2', 'hearts')], up: [c('3', 'hearts')] } }),
        player({ id: 'hidden', revealed: false }),
      ],
    });
    const out = redactHandRecord(rec, 'me').players;
    expect(out[0].cards).toBeDefined();
    expect(out[1].cards).toBeDefined();
    expect(out[2].cards).toEqual({ up: [c('3', 'hearts')] });
    expect(out[3].cards).toBeUndefined();
  });

  it('summarizeHand labels bomb pots and handles viewers not in the hand', () => {
    const summary = summarizeHand(record({ kind: 'bomb-pot', winners: [{ playerId: 'zzzzzzzz', amount: 5 }] }), 'nobody');
    expect(summary.variant).toBe('texas-holdem (bomb pot)');
    expect(summary.myNet).toBe(0);
    expect(summary.myCards).toBeUndefined();
    expect(summary.winners[0].name).toBe('zzzzzz');
  });
});
