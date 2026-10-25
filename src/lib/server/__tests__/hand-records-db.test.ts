jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('../../database/pool', () => ({ getPool: jest.fn() }));
jest.mock('../../utils/post-hand-result', () => ({ postHandResultToChat: jest.fn() }));
jest.mock('../../database/player-statistics-manager', () => ({ PlayerStatisticsManager: jest.fn() }));

import { getPool } from '../../database/pool';
import { postHandResultToChat } from '../../utils/post-hand-result';
import { PlayerStatisticsManager } from '../../database/player-statistics-manager';
import {
  applyHandToStatistics,
  buildHandRecord,
  finishHand,
  markCardsShown,
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
    const awarded = () => query.mock.calls.map(c => c[1][1]);

    it('updates every player and awards first-hand and first-win achievements', async () => {
      await applyHandToStatistics({ query } as any, record());
      expect(updateStats).toHaveBeenCalledWith('a', { handsPlayed: 1, handsWon: 1, totalProfit: 100, biggestPot: 200 });
      expect(updateStats).toHaveBeenCalledWith('b', { handsPlayed: 1, handsWon: 0, totalProfit: -100, biggestPot: undefined });
      expect(awarded()).toEqual(['first_hand', 'first_win', 'quads_plus', 'first_hand']);
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
