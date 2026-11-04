import type { NextApiRequest, NextApiResponse } from 'next';

import createHandler from '../../../pages/api/tournaments/create';
import listHandler from '../../../pages/api/tournaments/list';
import viewHandler from '../../../pages/api/tournaments/view';
import getHandler from '../../../pages/api/tournaments/get';
import payoutsHandler from '../../../pages/api/tournaments/payouts';
import registerHandler from '../../../pages/api/tournaments/register';
import privacyHandler from '../../../pages/api/tournaments/privacy';
import joinHandler from '../../../pages/api/games/rooms/join';
import { tournamentManager } from '../../lib/tournament/manager-instance';
import { createDefaultFreezeoutConfig } from '../../lib/tournament/tournament-utils';

// The caller, by user ID; every test sets who is asking
const ALL_PLAYER = ['tournament.view', 'tournament.register'];
const DIRECTOR = [...ALL_PLAYER, 'tournament.create', 'tournament.manage'];
let mockCaller: { userId: string | null; permissions: Set<string> } = { userId: null, permissions: new Set() };
const as = (userId: string | null, permissions: string[] = ALL_PLAYER) => { mockCaller = { userId, permissions: new Set(permissions) }; };

jest.mock('../../lib/auth/access-control', () => ({
  requirePermission: async (_req: any, res: any, permission: string) => {
    if (!mockCaller.userId || !mockCaller.permissions.has(permission)) {
      res.status(403).json({ code: 'PERMISSION_DENIED', permission });
      return null;
    }
    return mockCaller;
  },
  getRequestAccess: async () => mockCaller,
  hasPermission: (access: any, permission: string) => !!access?.permissions.has(permission),
  sendPermissionDenied: (res: any, permission: string) => res.status(403).json({ code: 'PERMISSION_DENIED', permission }),
}));
jest.mock('../../lib/auth/auth-utils', () => ({
  requirePlayer: async (_req: any, res: any) => {
    if (!mockCaller.userId) { res.status(401).json({ error: 'Authentication required' }); return null; }
    return mockCaller.userId;
  },
  getSessionUser: async () => (mockCaller.userId ? { id: mockCaller.userId, email: `${mockCaller.userId}@example.com` } : null),
}));
jest.mock('../../lib/tournament/manager-instance', () => {
  const { TournamentManager } = jest.requireActual('../../lib/tournament/tournament-manager');
  const { MemoryTournamentStore } = jest.requireActual('../../lib/tournament/tournament-store');
  return { tournamentManager: new TournamentManager(new MemoryTournamentStore()) };
});
jest.mock('../../lib/tournament/table-rooms', () => ({ syncTournamentRooms: async () => {}, keepTablesMoving: async () => {} }));
jest.mock('../../lib/tournament/pg-tournament-store', () => ({ loadPlayerNames: async () => ({}) }));
jest.mock('../../lib/api/rate-limit', () => ({ rateLimit: () => ({ allowed: true, remaining: 1, resetAt: Date.now() + 60_000 }) }));
// No private tables here: invite codes only find tournaments
jest.mock('../../lib/server/room-privacy', () => ({
  ...jest.requireActual('../../lib/server/room-privacy'),
  findRoomByInviteCode: async () => null,
  addRoomMember: async () => {},
}));
jest.mock('../../lib/database/pool', () => ({ getPool: () => ({ query: jest.fn() }) }));

function call(handler: (req: NextApiRequest, res: NextApiResponse) => unknown, method: string, body?: any, query?: any) {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return Promise.resolve(handler({ method, body, query, headers: {} } as any, res)).then(() => ({
    status: res.status.mock.calls[0]?.[0] as number,
    body: res.json.mock.calls[0]?.[0],
  }));
}

async function createTournament(visibility?: 'public' | 'private', name = 'Home game') {
  as('director', DIRECTOR);
  const created = await call(createHandler, 'POST', { name, config: createDefaultFreezeoutConfig(), visibility });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

const inviteCodeOf = async (id: string) => (await tournamentManager.get(id))!.inviteCode!;
const lobbyIds = async () => (await call(listHandler, 'GET', undefined, {})).body.tournaments.map((t: { id: string }) => t.id);

describe('private tournaments', () => {
  test('creating one never sends the invite code back, and the director sees it in the view', async () => {
    const id = await createTournament('private');
    as('director', DIRECTOR);
    const created = await tournamentManager.get(id);
    expect(created?.visibility).toBe('private');
    const view = await call(viewHandler, 'GET', undefined, { tournamentId: id });
    expect(view.body.visibility).toBe('private');
    expect(view.body.inviteCode).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
  });

  test('stay out of the lobby for everyone who isn\'t invited', async () => {
    const pub = await createTournament('public', 'Open game');
    const priv = await createTournament('private');
    as('stranger');
    expect(await lobbyIds()).toEqual(expect.arrayContaining([pub]));
    expect(await lobbyIds()).not.toContain(priv);
    as(null, ['tournament.view']);
    expect(await lobbyIds()).not.toContain(priv);
    as('director', DIRECTOR);
    expect(await lobbyIds()).toContain(priv);
    as('mod', [...ALL_PLAYER, 'table.view_private']);
    expect(await lobbyIds()).toContain(priv);
  });

  test('can\'t be viewed, read or registered for without the invite', async () => {
    const id = await createTournament('private');
    as('stranger');
    for (const [handler, method, args] of [
      [viewHandler, 'GET', { query: { tournamentId: id } }],
      [getHandler, 'GET', { query: { tournamentId: id } }],
      [payoutsHandler, 'GET', { query: { tournamentId: id, prizePool: '100' } }],
      [registerHandler, 'POST', { body: { tournamentId: id } }],
    ] as const) {
      const res = await call(handler as any, method, (args as any).body, (args as any).query);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PRIVATE_TOURNAMENT');
    }
    expect((await tournamentManager.get(id))!.registeredPlayers).not.toContain('stranger');
  });

  test('the invite link lets a player in: they see it, register, and it shows in their lobby', async () => {
    const id = await createTournament('private');
    const code = await inviteCodeOf(id);
    as('friend');
    const joined = await call(joinHandler, 'POST', { code: `${code.slice(0, 5)}-${code.slice(5).toLowerCase()}` });
    expect(joined).toEqual({ status: 200, body: { tournamentId: id, name: 'Home game' } });
    expect((await call(viewHandler, 'GET', undefined, { tournamentId: id })).status).toBe(200);
    const registered = await call(registerHandler, 'POST', { tournamentId: id });
    expect(registered.status).toBe(200);
    // Nothing a player is sent includes the invite or who else was invited
    expect(registered.body).not.toHaveProperty('inviteCode');
    expect(registered.body).not.toHaveProperty('members');
    expect((await call(getHandler, 'GET', undefined, { tournamentId: id })).body).not.toHaveProperty('inviteCode');
    expect((await call(viewHandler, 'GET', undefined, { tournamentId: id })).body.inviteCode).toBeNull();
    expect(await lobbyIds()).toContain(id);
  });

  test('an invite code needs a signed-in user, and a wrong one finds nothing', async () => {
    const id = await createTournament('private');
    const code = await inviteCodeOf(id);
    as(null, ['tournament.view']);
    expect((await call(joinHandler, 'POST', { code })).status).toBe(401);
    as('friend');
    expect((await call(joinHandler, 'POST', { code: 'ZZZZZ-ZZZZZ' })).body.code).toBe('INVITE_NOT_FOUND');
  });

  test('public tournaments work as before', async () => {
    const id = await createTournament();
    as('anyone');
    expect((await call(viewHandler, 'GET', undefined, { tournamentId: id })).body.visibility).toBe('public');
    expect((await call(registerHandler, 'POST', { tournamentId: id })).status).toBe(200);
  });
});

describe('POST /api/tournaments/privacy', () => {
  test('the director makes a tournament private and replaces its link; the old link stops working', async () => {
    const id = await createTournament();
    as('director', DIRECTOR);
    const made = await call(privacyHandler, 'POST', { tournamentId: id, action: 'set-visibility', visibility: 'private' });
    expect(made.status).toBe(200);
    expect(made.body.visibility).toBe('private');
    const old = made.body.inviteCode;
    const fresh = await call(privacyHandler, 'POST', { tournamentId: id, action: 'new-invite-code' });
    expect(fresh.body.inviteCode).not.toBe(old);
    as('friend');
    expect((await call(joinHandler, 'POST', { code: old })).status).toBe(404);
    expect((await call(joinHandler, 'POST', { code: fresh.body.inviteCode })).status).toBe(200);
  });

  test('making it public opens it to everyone again', async () => {
    const id = await createTournament('private');
    as('director', DIRECTOR);
    const res = await call(privacyHandler, 'POST', { tournamentId: id, action: 'set-visibility', visibility: 'public' });
    expect(res.body).toEqual({ visibility: 'public', inviteCode: null });
    as('stranger');
    expect((await call(viewHandler, 'GET', undefined, { tournamentId: id })).status).toBe(200);
  });

  test('only the director can change it, even another director', async () => {
    const id = await createTournament('private');
    as('other-director', DIRECTOR);
    const res = await call(privacyHandler, 'POST', { tournamentId: id, action: 'set-visibility', visibility: 'public' });
    expect(res.status).toBe(403);
    as('player');
    expect((await call(privacyHandler, 'POST', { tournamentId: id, action: 'new-invite-code' })).status).toBe(403);
    expect((await tournamentManager.get(id))!.visibility).toBe('private');
  });

  test('rejects anything but the two actions', async () => {
    const id = await createTournament();
    as('director', DIRECTOR);
    expect((await call(privacyHandler, 'POST', { tournamentId: id, action: 'set-visibility', visibility: 'secret' })).status).toBe(400);
    expect((await call(privacyHandler, 'POST', { tournamentId: id, action: 'delete' })).status).toBe(400);
  });
});
