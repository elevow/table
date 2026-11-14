jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('../../database/pool', () => ({ getPool: jest.fn() }));
jest.mock('../../shared/game-seats', () => ({ loadPersistedRoomSeats: jest.fn(), getRoomSeats: jest.fn(() => ({})) }));
jest.mock('../../poker/engine-persistence', () => ({ getOrRestoreEngine: jest.fn() }));
jest.mock('../../utils/post-hand-result', () => ({ postSystemChatMessage: jest.fn(async () => null) }));

import { getPool } from '../../database/pool';
import * as GameSeats from '../../shared/game-seats';
import { getOrRestoreEngine } from '../../poker/engine-persistence';
import { postSystemChatMessage } from '../../utils/post-hand-result';
import {
  acceptChallenge, cancelChallenge, createChallenge, currentPokerNet, headToHeadResult, settleChallengesFor,
} from '../head-to-head';

type Row = Record<string, any>;

/** A tiny stand-in for the database: the chip ledger, the challenges and the side-bet entries. */
function fakeDb(state: { ledger: Row[]; challenges: Row[]; entries: Row[] }) {
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('FROM chip_ledger')) {
      const [, playerId] = params;
      const net = state.ledger.filter(e => e.player_id === playerId)
        .reduce((sum, e) => sum + (e.kind === 'cash_out' ? e.amount : -e.amount), 0);
      return { rows: [{ net }] };
    }
    if (sql.startsWith('SELECT 1 FROM side_bet_challenges')) {
      const [, a, b] = params;
      const rows = state.challenges.filter(c => ['pending', 'active'].includes(c.status)
        && ((c.challenger_id === a && c.opponent_id === b) || (c.challenger_id === b && c.opponent_id === a)));
      return { rows };
    }
    if (sql.includes('INSERT INTO side_bet_challenges')) {
      const [room_id, challenger_id, challenger_name, opponent_id, opponent_name, stake] = params;
      const row = { id: `c${state.challenges.length + 1}`, room_id, challenger_id, challenger_name, opponent_id, opponent_name, stake, status: 'pending' };
      state.challenges.push(row);
      return { rows: [row] };
    }
    if (sql.includes("status IN ('pending', 'active') ORDER BY")) {
      return { rows: state.challenges.filter(c => ['pending', 'active'].includes(c.status)) };
    }
    if (sql.includes("FROM side_bet_challenges WHERE id::text = $1 AND room_id = $2 AND status = 'pending'")) {
      return { rows: state.challenges.filter(c => c.id === params[0] && c.status === 'pending') };
    }
    if (sql.includes("SET status = 'active'")) {
      const c = state.challenges.find(x => x.id === params[0] && x.status === 'pending');
      if (c) Object.assign(c, { status: 'active', challenger_start: params[1], opponent_start: params[2] });
      return { rowCount: c ? 1 : 0, rows: [] };
    }
    if (sql.includes("SET status = 'cancelled'")) {
      const c = state.challenges.find(x => x.id === params[0] && x.status === 'pending'
        && (params.length < 3 || x.challenger_id === params[2] || x.opponent_id === params[2]));
      if (c) c.status = 'cancelled';
      return { rowCount: c ? 1 : 0, rows: [] };
    }
    if (sql.includes("SET status = 'settled'")) {
      const c = state.challenges.find(x => x.id === params[0] && x.status === 'active');
      if (c) c.status = 'settled';
      return { rowCount: c ? 1 : 0, rows: [] };
    }
    if (sql.includes('INSERT INTO side_bet_entries')) {
      const [room_id, hand_id, player_id, player_name, amount, note] = params;
      state.entries.push({ room_id, hand_id, player_id, player_name, amount, note });
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query };
}

const seatsWith = (...players: Array<[string, number]>) =>
  Object.fromEntries(players.map(([playerId, chips], i) => [i + 1, { playerId, playerName: playerId.toUpperCase(), chips }]));

describe('head to head', () => {
  let db: ReturnType<typeof fakeDb>;
  let state: { ledger: Row[]; challenges: Row[]; entries: Row[] };
  let stacks: Record<string, number>;

  beforeEach(() => {
    state = {
      ledger: [
        { player_id: 'ann', kind: 'buy_in', amount: 100 },
        { player_id: 'bob', kind: 'buy_in', amount: 100 },
      ],
      challenges: [],
      entries: [],
    };
    db = fakeDb(state);
    (getPool as jest.Mock).mockReturnValue(db);
    stacks = { ann: 100, bob: 100 };
    (GameSeats.loadPersistedRoomSeats as jest.Mock).mockImplementation(async () => seatsWith(...Object.entries(stacks)));
    (getOrRestoreEngine as jest.Mock).mockImplementation(async () => ({
      getState: () => ({ players: Object.entries(stacks).map(([id, stack]) => ({ id, stack })) }),
    }));
    (postSystemChatMessage as jest.Mock).mockClear();
  });

  it('works out a player\'s poker result from the ledger and the chips in front of them', async () => {
    stacks.ann = 160;
    await expect(currentPokerNet('room', 'ann')).resolves.toBe(60);
    delete stacks.bob;
    state.ledger.push({ player_id: 'bob', kind: 'cash_out', amount: 40 });
    await expect(currentPokerNet('room', 'bob')).resolves.toBe(-60);
  });

  it('decides the winner by how much each result changed since the challenge was accepted', () => {
    expect(headToHeadResult({ challengerStart: 50, opponentStart: -20 }, 60, 0)).toEqual({ challengerChange: 10, opponentChange: 20, winner: 'opponent' });
    expect(headToHeadResult({ challengerStart: 0, opponentStart: 0 }, 5, 5).winner).toBeNull();
  });

  it('runs from challenge to settlement when a player leaves', async () => {
    // Ann was already up 50 when Bob accepted
    stacks.ann = 150;
    const created = await createChallenge(db as any, { roomId: 'room', challengerId: 'ann', challengerName: 'ANN', opponentId: 'bob', opponentName: 'BOB', stake: 10 });
    expect(created.ok).toBe(true);
    const id = (created as any).challenge.id;

    expect(await acceptChallenge(db as any, 'room', id, 'ann')).toEqual({ ok: false, error: 'That challenge is no longer waiting for you' });
    expect(await acceptChallenge(db as any, 'room', id, 'bob')).toEqual({ ok: true });
    expect(state.challenges[0]).toMatchObject({ status: 'active', challenger_start: 50, opponent_start: 0 });

    // Since then Ann dropped 20 and Bob won 20; Ann leaves with 130
    delete stacks.ann;
    stacks.bob = 120;
    state.ledger.push({ player_id: 'ann', kind: 'cash_out', amount: 130 });
    await settleChallengesFor('room', 'ann');

    expect(state.challenges[0].status).toBe('settled');
    expect(state.entries.map(e => [e.player_id, e.amount, e.note])).toEqual([
      ['bob', 10, 'Head to head vs ANN'],
      ['ann', -10, 'Head to head vs BOB'],
    ]);
    expect(state.entries[0].hand_id).toBe(`h2h:${id}`);
    expect(postSystemChatMessage).toHaveBeenCalledWith('room', 'Side bet · Head to head: ANN -$20, BOB +$20. BOB wins $10');

    // Settling again pays nothing more
    await settleChallengesFor('room', 'bob');
    expect(state.entries).toHaveLength(2);
  });

  it('is a push on a tie', async () => {
    const { challenge } = await createChallenge(db as any, { roomId: 'room', challengerId: 'ann', challengerName: 'ANN', opponentId: 'bob', opponentName: 'BOB', stake: 10 }) as any;
    await acceptChallenge(db as any, 'room', challenge.id, 'bob');
    await settleChallengesFor('room', 'bob');
    expect(state.entries).toEqual([]);
    expect(state.challenges[0].status).toBe('settled');
    expect(postSystemChatMessage).toHaveBeenCalledWith('room', expect.stringContaining("A tie, so it's a push"));
  });

  it('allows one open challenge per pair, never yourself, and calls off unanswered ones when a player leaves', async () => {
    const args = { roomId: 'room', challengerId: 'ann', challengerName: 'ANN', opponentId: 'bob', opponentName: 'BOB', stake: 10 };
    expect((await createChallenge(db as any, { ...args, opponentId: 'ann' })).ok).toBe(false);
    expect((await createChallenge(db as any, args)).ok).toBe(true);
    expect(await createChallenge(db as any, { ...args, challengerId: 'bob', opponentId: 'ann' })).toEqual({ ok: false, error: 'You already have a head to head with that player' });
    await settleChallengesFor('room', 'bob');
    expect(state.challenges[0].status).toBe('cancelled');
    expect(state.entries).toEqual([]);
  });

  it('lets either player withdraw a challenge until it is accepted', async () => {
    const { challenge } = await createChallenge(db as any, { roomId: 'room', challengerId: 'ann', challengerName: 'ANN', opponentId: 'bob', opponentName: 'BOB', stake: 10 }) as any;
    expect(await cancelChallenge(db as any, 'room', challenge.id, 'someone-else')).toBe(false);
    expect(await cancelChallenge(db as any, 'room', challenge.id, 'bob')).toBe(true);
    expect(await acceptChallenge(db as any, 'room', challenge.id, 'bob')).toMatchObject({ ok: false });
  });

  it('does nothing when the database has no challenges table yet', async () => {
    (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async () => { throw Object.assign(new Error('missing'), { code: '42P01' }); }) });
    await expect(settleChallengesFor('room', 'ann')).resolves.toBeUndefined();
  });

  it('never stops a player leaving when there is no database at all', async () => {
    (getPool as jest.Mock).mockImplementation(() => { throw new Error('No database URL found'); });
    await expect(settleChallengesFor('room', 'ann')).resolves.toBeUndefined();
  });
});
