jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('../../database/pool', () => ({ getPool: jest.fn() }));

import { settleHandSideBets, settleSideBets, type SideBetHandInput, type SideBetParticipant } from '../side-bets';
import {
  bestSuitForHand, isValidPick, parseSideBetStakes, sideBetStake,
} from '../../shared/side-bets';
import type { Card } from '../../../types/poker';
import type { HandRecord, HandRecordPlayer } from '../../../types/hand-record';

const SUITS: Record<string, Card['suit']> = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };
const c = (code: string): Card => ({ rank: code.slice(0, -1) as Card['rank'], suit: SUITS[code.slice(-1)] });
const cards = (codes: string) => codes.split(' ').filter(Boolean).map(c);

function player(id: string, seat: number, hole: string, extra: Partial<HandRecordPlayer> = {}): HandRecordPlayer {
  return {
    id, name: id.toUpperCase(), seat, startStack: 100, endStack: 100, net: 0, won: 0, folded: false,
    cards: { hole: cards(hole) }, revealed: false, ...extra,
  };
}

function record(players: HandRecordPlayer[], board = '', extra: Partial<HandRecord> = {}): HandRecord {
  return {
    id: 'hand-1', roomId: 'room-1', handNumber: 1, variant: 'texas-holdem', smallBlind: 1, bigBlind: 2,
    startedAt: '2026-11-13T00:00:00.000Z', endedAt: '2026-11-13T00:01:00.000Z',
    board: cards(board), players, actions: [], winners: [], pot: 0, ...extra,
  };
}

const p = (id: string, pick: string | null = null): SideBetParticipant => ({ playerId: id, name: id.toUpperCase(), pick });

function settle(input: Partial<SideBetHandInput> & Pick<SideBetHandInput, 'record'>) {
  return settleSideBets({ stakes: {}, participants: {}, pools: {}, wild: false, ...input });
}

const amounts = (entries: Array<{ playerId: string; amount: number }>) =>
  Object.fromEntries(entries.map(e => [e.playerId, e.amount]));

describe('side bet rules', () => {
  it('rotates the best suit through the suits by hand', () => {
    expect([0, 1, 2, 3, 4].map(bestSuitForHand)).toEqual(['spades', 'hearts', 'diamonds', 'clubs', 'spades']);
  });

  it('reads stakes from the room configuration, dropping anything unusable', () => {
    expect(parseSideBetStakes({ 'best-suit': 2, 'flop-color': '0.5', 'bad-beat': -1, 'high-card-bingo': 'x', nope: 5 }))
      .toEqual({ 'best-suit': 2, 'flop-color': 0.5 });
    expect(parseSideBetStakes(null)).toEqual({});
    expect(sideBetStake(1.239)).toBe(1.24);
    expect(sideBetStake(1e9)).toBe(1000);
  });

  it('checks picks against each bet', () => {
    expect(isValidPick('flop-color', 'red')).toBe(true);
    expect(isValidPick('flop-color', 'blue')).toBe(false);
    expect(isValidPick('high-card-bingo', 'Q')).toBe(true);
    expect(isValidPick('best-suit', null)).toBe(true);
    expect(isValidPick('best-suit', 'red')).toBe(false);
  });
});

describe('best suit', () => {
  // Hand 1 is played for hearts
  const players = [player('a', 1, 'Ah 2c'), player('b', 2, 'Kh Qh'), player('c', 3, '9s 9d', { folded: true })];
  const participants = { 'best-suit': [p('a'), p('b'), p('c')] };

  it('pays the player with the most of the suit by value, folded or not', () => {
    const out = settle({ record: record(players), stakes: { 'best-suit': 2 }, participants });
    // B has K+Q = 25 against A's ace = 14
    expect(amounts(out.entries)).toEqual({ b: 4, a: -2, c: -2 });
    expect(out.messages[0]).toBe('Best ♥: B wins $4');
  });

  it('splits a tie', () => {
    const tied = [player('a', 1, 'Kh Qh'), player('b', 2, 'Qh Kh'), player('c', 3, '2s 3s')];
    const out = settle({ record: record(tied), stakes: { 'best-suit': 1 }, participants });
    expect(amounts(out.entries)).toEqual({ a: 0.5, b: 0.5, c: -1 });
  });

  it('is a push when nobody holds the suit or everyone ties', () => {
    const none = [player('a', 1, '2s 3s'), player('b', 2, '4c 5c')];
    expect(settle({ record: record(none), stakes: { 'best-suit': 1 }, participants }).entries).toEqual([]);
  });

  it('counts stud players\' down and up cards', () => {
    const stud = [
      player('a', 1, '', { cards: { down: cards('2h 3h'), up: cards('Ah') } }),
      player('b', 2, '', { cards: { down: cards('Kh 2c'), up: cards('3c') } }),
    ];
    const out = settle({ record: record(stud, '', { variant: 'seven-card-stud' }), stakes: { 'best-suit': 1 }, participants });
    expect(amounts(out.entries)).toEqual({ a: 1, b: -1 });
  });

  it('only counts players who were dealt in, and needs two', () => {
    const out = settle({ record: record([player('a', 1, 'Ah 2c')]), stakes: { 'best-suit': 1 }, participants });
    expect(out.entries).toEqual([]);
  });

  it('does nothing when the bet is off', () => {
    expect(settle({ record: record(players), participants }).entries).toEqual([]);
  });
});

describe('flop color', () => {
  const players = [player('a', 1, '2c 3c'), player('b', 2, '4c 5c'), player('c', 3, '6c 7c'), player('d', 4, '8c 9c')];

  it('pays the callers who got it right from those who did not', () => {
    const participants = { 'flop-color': [p('a', 'red'), p('b', 'black'), p('c', 'mixed'), p('d', 'red')] };
    const out = settle({ record: record(players, 'Ah Kd 2h 3s 4s'), stakes: { 'flop-color': 1 }, participants });
    expect(amounts(out.entries)).toEqual({ a: 1, d: 1, b: -1, c: -1 });
    expect(out.messages[0]).toBe('Flop color (red): A, D split $2');
  });

  it('splits odd cents to the first seats', () => {
    const participants = { 'flop-color': [p('a', 'mixed'), p('b', 'mixed'), p('c', 'mixed'), p('d', 'red')] };
    const out = settle({ record: record(players, 'Ah Ks 2h'), stakes: { 'flop-color': 1 }, participants });
    expect(amounts(out.entries)).toEqual({ a: 0.34, b: 0.33, c: 0.33, d: -1 });
  });

  it('is a push when everyone called it the same and when there is no flop', () => {
    const same = { 'flop-color': [p('a', 'black'), p('b', 'black')] };
    expect(settle({ record: record(players, 'As Kc 2s'), stakes: { 'flop-color': 1 }, participants: same }).entries).toEqual([]);
    const split = { 'flop-color': [p('a', 'black'), p('b', 'red')] };
    expect(settle({ record: record(players, ''), stakes: { 'flop-color': 1 }, participants: split }).entries).toEqual([]);
  });

  it('leaves out players with no call', () => {
    const participants = { 'flop-color': [p('a', 'black'), p('b', 'red'), p('c', null)] };
    const out = settle({ record: record(players, 'As Kc 2s'), stakes: { 'flop-color': 1 }, participants });
    expect(amounts(out.entries)).toEqual({ a: 1, b: -1 });
  });
});

describe('high card bingo', () => {
  const players = [player('a', 1, '2c 3c'), player('b', 2, '4c 5c'), player('c', 3, '6c 7c')];
  const participants = { 'high-card-bingo': [p('a', 'Q'), p('b', '9'), p('c', 'Q')] };

  it('carries the pot over when nobody\'s rank comes, owing nothing yet', () => {
    const out = settle({ record: record(players, '2h 3d 4s 5c 6h'), stakes: { 'high-card-bingo': 1 }, participants });
    expect(out.entries).toEqual([]);
    expect(out.changedPools).toEqual(['high-card-bingo']);
    expect(out.pools['high-card-bingo'].map(s => [s.playerId, s.amount])).toEqual([['a', 1], ['b', 1], ['c', 1]]);
  });

  it('pays the whole pot to the first rank to come, including stakes from players who left', () => {
    const pool = [
      { playerId: 'a', name: 'A', amount: 2 },
      { playerId: 'b', name: 'B', amount: 2 },
      { playerId: 'c', name: 'C', amount: 2 },
      { playerId: 'gone', name: 'Gone', amount: 2 },
    ];
    // The 9 comes before the queen
    const out = settle({ record: record(players, '9h Qd 2s'), stakes: { 'high-card-bingo': 1 }, participants, pools: { 'high-card-bingo': pool } });
    // Pot: 8 carried + 3 this hand = 11; B put in 3 and wins 11
    expect(amounts(out.entries)).toEqual({ a: -3, b: 8, c: -3, gone: -2 });
    expect(out.pools['high-card-bingo']).toEqual([]);
    expect(out.messages[0]).toBe('High card bingo (9♥): B wins the $11 pot');
    expect(out.entries.reduce((sum, e) => sum + e.amount, 0)).toBe(0);
  });

  it('splits the pot between players with the same rank', () => {
    const out = settle({ record: record(players, 'Qh'), stakes: { 'high-card-bingo': 1 }, participants });
    expect(amounts(out.entries)).toEqual({ a: 0.5, b: -1, c: 0.5 });
  });

  it('skips hands without a board', () => {
    const out = settle({ record: record(players, '', { variant: 'five-card-draw' }), stakes: { 'high-card-bingo': 1 }, participants });
    expect(out.changedPools).toEqual([]);
  });
});

describe('bad beat jackpot', () => {
  // Quad fours lose to a queen-high straight flush
  const board = '8h 9h 10h 4s 4d';
  const players = () => [
    player('loser', 1, '4c 4h'),
    player('winner', 2, 'Jh Qh', { won: 50 }),
    player('other', 3, '2c 3d', { folded: true }),
  ];
  const all = { 'bad-beat': [p('loser'), p('winner'), p('other')] };

  it('pays 75% to the player beaten with quads and 25% to the winner', () => {
    const pool = [{ playerId: 'loser', name: 'LOSER', amount: 9 }, { playerId: 'winner', name: 'WINNER', amount: 9 }, { playerId: 'other', name: 'OTHER', amount: 9 }];
    const out = settle({ record: record(players(), board), stakes: { 'bad-beat': 1 }, participants: all, pools: { 'bad-beat': pool } });
    // Jackpot 27 + 3 = 30: loser gets 22.50, winner 7.50, each put in 10
    expect(amounts(out.entries)).toEqual({ loser: 12.5, winner: -2.5, other: -10 });
    expect(out.pools['bad-beat']).toEqual([]);
    expect(out.messages[0]).toContain('LOSER lost with four of a kind');
  });

  it('gives the beaten player all of it when the winner is not in', () => {
    const participants = { 'bad-beat': [p('loser'), p('other')] };
    const out = settle({ record: record(players(), board), stakes: { 'bad-beat': 1 }, participants });
    expect(amounts(out.entries)).toEqual({ loser: 1, other: -1 });
  });

  it('only builds the jackpot on an ordinary hand', () => {
    const plain = [player('a', 1, '2c 7d', { won: 10 }), player('b', 2, 'Kc Qd')];
    const out = settle({ record: record(plain, 'As 9s 5h 3c Jd'), stakes: { 'bad-beat': 1 }, participants: { 'bad-beat': [p('a'), p('b')] } });
    expect(out.entries).toEqual([]);
    expect(out.pools['bad-beat'].map(s => s.amount)).toEqual([1, 1]);
  });

  it('is not played with wild cards or in games without a high hand', () => {
    expect(settle({ record: record(players(), board), stakes: { 'bad-beat': 1 }, participants: all, wild: true }).changedPools).toEqual([]);
    expect(settle({ record: record(players(), board, { variant: 'razz' }), stakes: { 'bad-beat': 1 }, participants: all }).changedPools).toEqual([]);
  });
});

describe('settling a stored hand', () => {
  function fakePool(rows: { players?: any[]; pools?: any[] } = {}) {
    const queries: Array<{ sql: string; params?: any[] }> = [];
    const client = {
      query: jest.fn(async (sql: string, params?: any[]) => {
        queries.push({ sql, params });
        if (sql.includes('FROM side_bet_players')) return { rows: rows.players || [] };
        if (sql.includes('FROM side_bet_pools')) return { rows: rows.pools || [] };
        return { rows: [], rowCount: 1 };
      }),
      release: jest.fn(),
    };
    return { pool: { connect: jest.fn(async () => client) } as any, client, queries };
  }
  const hand = record([player('a', 1, 'Ah 2c'), player('b', 2, 'Kh Qh')]);

  it('does nothing when no side bets are on', async () => {
    const { pool } = fakePool();
    await expect(settleHandSideBets(pool, hand, {} as any, { sideBets: {} })).resolves.toEqual([]);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('writes each result in one transaction and returns the chat lines', async () => {
    const { pool, client, queries } = fakePool({
      players: [
        { player_id: 'a', player_name: 'A', bet: 'best-suit', active: true, pick: null },
        { player_id: 'b', player_name: 'B', bet: 'best-suit', active: true, pick: null },
        { player_id: 'z', player_name: 'Z', bet: 'best-suit', active: false, pick: null },
      ],
    });
    const lines = await settleHandSideBets(pool, hand, {} as any, { sideBets: { 'best-suit': 5 } });
    expect(lines).toEqual(['Best ♥: B wins $5']);
    const inserts = queries.filter(q => q.sql.includes('INSERT INTO side_bet_entries'));
    expect(inserts.map(q => [q.params![4], q.params![6]])).toEqual([['b', 5], ['a', -5]]);
    expect(queries[0].sql).toBe('BEGIN');
    expect(queries[queries.length - 1].sql).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back when a write fails', async () => {
    const { pool, client } = fakePool({
      players: [
        { player_id: 'a', player_name: 'A', bet: 'best-suit', active: true, pick: null },
        { player_id: 'b', player_name: 'B', bet: 'best-suit', active: true, pick: null },
      ],
    });
    const base = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('INSERT INTO side_bet_entries')) throw new Error('boom');
      return base(sql, params);
    });
    await expect(settleHandSideBets(pool, hand, {} as any, { sideBets: { 'best-suit': 5 } })).rejects.toThrow('boom');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
