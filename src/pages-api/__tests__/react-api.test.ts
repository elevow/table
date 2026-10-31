import type { NextApiRequest, NextApiResponse } from 'next';

// CI has no database: sessions and persisted seats come from this fake pool
const sessions = new Map<string, string>();
let persistedSeats: Record<string, unknown> | null = null;
jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('../../lib/database/pool', () => ({
  getPool: () => ({
    connect: async () => ({
      query: async (_sql: string, params: string[]) => {
        const userId = sessions.get(params[0]);
        return { rows: userId ? [{ user_id: userId }] : [] };
      },
      release: () => {},
    }),
    query: async (sql: string, params: string[]) => {
      // Session lookup and role grants for the game.react permission check
      if (sql.includes('auth_tokens')) {
        const userId = sessions.get(params[0]);
        return { rows: userId ? [{ id: userId, email: null }] : [] };
      }
      if (sql.includes('access_roles')) return { rows: [{ kind: 'role', key: 'player', rank: 10, item: 'game.react' }] };
      return { rows: persistedSeats ? [{ configuration: { seats: persistedSeats } }] : [] };
    },
  }),
}));
jest.mock('../../lib/realtime/publisher', () => ({
  publishTableEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../lib/poker/engine-persistence', () => ({
  getOrRestoreEngine: jest.fn().mockResolvedValue(null),
}));

import handler from '../../../pages/api/games/react';
import { hashSessionToken } from '../../lib/auth/session-token';
import { publishTableEvent } from '../../lib/realtime/publisher';
import { getOrRestoreEngine } from '../../lib/poker/engine-persistence';
import { setRoomSeats } from '../../lib/shared/game-seats';
import { REACTION_COOLDOWN_MS } from '../../lib/shared/reactions';

const signIn = (userId: string) => {
  const token = `token-${userId}`;
  sessions.set(hashSessionToken(token), userId);
  return { authorization: `Bearer ${token}` };
};

async function call(body: Record<string, unknown>, headers: Record<string, string> = {}, method = 'POST') {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() };
  await handler({ method, body, headers, cookies: {} } as unknown as NextApiRequest, res as NextApiResponse);
  return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0], res };
}

let now = 1_000_000;
beforeEach(() => {
  // Each test starts well clear of the previous test's rate-limit window
  now += 60_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  persistedSeats = null;
  setRoomSeats('t1', { 1: { playerId: 'alice', playerName: 'Alice', chips: 100 }, 2: null });
  (getOrRestoreEngine as jest.Mock).mockResolvedValue(null);
});
afterEach(() => {
  jest.restoreAllMocks();
  (publishTableEvent as jest.Mock).mockClear();
});

describe('POST /api/games/react', () => {
  it('publishes a seated player\'s reaction to the table', async () => {
    const out = await call({ tableId: 't1', emote: '🔥' }, signIn('alice'));
    expect(out.status).toBe(200);
    expect(publishTableEvent).toHaveBeenCalledWith('t1', { type: 'reaction', playerId: 'alice', emote: '🔥' });
  });

  it('rejects other methods', async () => {
    const out = await call({}, signIn('alice'), 'GET');
    expect(out.status).toBe(405);
  });

  it('requires a signed-in player', async () => {
    const out = await call({ tableId: 't1', emote: '👍' });
    expect(out.status).toBe(401);
    expect(publishTableEvent).not.toHaveBeenCalled();
  });

  it('refuses to react as someone else', async () => {
    const out = await call({ tableId: 't1', playerId: 'bob', emote: '👍' }, signIn('alice'));
    expect(out.status).toBe(403);
    expect(publishTableEvent).not.toHaveBeenCalled();
  });

  it('only accepts reactions from the list', async () => {
    for (const emote of ['💩', '<script>', '', 42, undefined]) {
      const out = await call({ tableId: 't1', emote }, signIn('alice'));
      expect(out.status).toBe(400);
    }
    expect(publishTableEvent).not.toHaveBeenCalled();
  });

  it('needs a table id', async () => {
    const out = await call({ emote: 'GG' }, signIn('alice'));
    expect(out.status).toBe(400);
  });

  it('refuses players who are not at the table', async () => {
    const out = await call({ tableId: 't1', emote: 'GG' }, signIn('mallory'));
    expect(out.status).toBe(403);
    expect(publishTableEvent).not.toHaveBeenCalled();
  });

  it('accepts a seat from the saved seat list', async () => {
    persistedSeats = { 3: { playerId: 'carol', playerName: 'Carol', chips: 50 } };
    const out = await call({ tableId: 't1', emote: 'GG' }, signIn('carol'));
    expect(out.status).toBe(200);
  });

  it('accepts a player dealt into the game', async () => {
    (getOrRestoreEngine as jest.Mock).mockResolvedValue({ getState: () => ({ players: [{ id: 'dave' }] }) });
    const out = await call({ tableId: 't1', emote: '😮' }, signIn('dave'));
    expect(out.status).toBe(200);
  });

  it('treats a failed game lookup as not at the table', async () => {
    (getOrRestoreEngine as jest.Mock).mockRejectedValue(new Error('db down'));
    const out = await call({ tableId: 't1', emote: '😮' }, signIn('erin'));
    expect(out.status).toBe(403);
  });

  it('allows one reaction per player every two seconds', async () => {
    const headers = signIn('alice');
    expect((await call({ tableId: 't1', emote: '👍' }, headers)).status).toBe(200);

    now += REACTION_COOLDOWN_MS - 1;
    const limited = await call({ tableId: 't1', emote: '👍' }, headers);
    expect(limited.status).toBe(429);
    expect(limited.res.setHeader).toHaveBeenCalledWith('Retry-After', '1');

    now += 2;
    expect((await call({ tableId: 't1', emote: '😂' }, headers)).status).toBe(200);
    expect(publishTableEvent).toHaveBeenCalledTimes(2);
  });

  it('reports a publishing failure', async () => {
    (publishTableEvent as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await call({ tableId: 't1', emote: 'GG' }, signIn('alice'));
    expect(out.status).toBe(500);
  });
});
