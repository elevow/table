/**
 * @jest-environment node
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import type { UserAccess } from '../../lib/auth/access-control';

// Rooms by id, as game_rooms rows; the fake pool below reads and writes them
type Row = { id: string; name: string; created_by: string; max_players: number; blind_levels: any; status: string; created_at: Date; configuration: any };
const mockRooms = new Map<string, Row>();

const mockQuery = jest.fn(async (sql: string, params: any[] = []) => {
  const room = mockRooms.get(params[0]);
  if (/SELECT created_by, max_players, configuration FROM game_rooms WHERE id = \$1/.test(sql)) {
    return { rows: room ? [room] : [] };
  }
  if (/\|\| \$2::jsonb/.test(sql)) {
    if (room) room.configuration = { ...(room.configuration || {}), ...JSON.parse(params[1]) };
    return { rows: [], rowCount: room ? 1 : 0 };
  }
  if (/jsonb_build_array\(\$2::text\)/.test(sql)) {
    if (room) {
      const members: string[] = Array.isArray(room.configuration?.members) ? room.configuration.members : [];
      room.configuration = { ...room.configuration, members: members.includes(params[1]) ? members : [...members, params[1]] };
    }
    return { rows: [] };
  }
  if (/- \$2::text/.test(sql)) {
    if (room && Array.isArray(room.configuration?.members)) {
      room.configuration = { ...room.configuration, members: room.configuration.members.filter((m: string) => m !== params[1]) };
    }
    return { rows: [] };
  }
  if (/configuration->>'inviteCode' = \$1/.test(sql)) {
    const found = [...mockRooms.values()].find(r => r.configuration?.visibility === 'private' && r.configuration?.inviteCode === params[0]);
    return { rows: found ? [found] : [] };
  }
  if (/FROM game_rooms r LEFT JOIN users/.test(sql)) {
    const all = [...mockRooms.values()].map(r => ({ ...r, host_name: `${r.created_by}-name` }));
    if (sql.includes(`<> 'private'`)) return { rows: all.filter(r => r.configuration?.visibility !== 'private') };
    return {
      rows: all.filter(r => r.configuration?.visibility === 'private'
        && (r.created_by === params[0] || (r.configuration.members || []).includes(params[0]))),
    };
  }
  return { rows: [] };
});
jest.mock('../../lib/database/pool', () => ({ getPool: () => ({ query: (sql: string, params: any[]) => mockQuery(sql, params) }) }));

// The signed-in caller (null when signed out) and their permissions
const PLAYER = [
  'lobby.view', 'table.view', 'table.join', 'table.join_private', 'table.waitlist', 'chat.send',
  'room.create', 'room.create_private', 'room.configure', 'room.kick_player',
];
const mockCaller: { current: UserAccess | null } = { current: null };
function signIn(userId: string, permissions = PLAYER) {
  mockCaller.current = {
    userId, email: null, roles: ['player'], rank: 10, permissions: new Set(permissions),
    bootstrapAdmin: false, limits: {}, sanction: null,
  };
}
jest.mock('../../lib/auth/auth-utils', () => ({
  getSessionUser: async () => (mockCaller.current?.userId ? { id: mockCaller.current.userId, email: null } : null),
  getAuthenticatedUserId: async () => mockCaller.current?.userId ?? null,
  requirePlayer: async (_req: any, res: any) => {
    if (mockCaller.current?.userId) return mockCaller.current.userId;
    res.status(401).json({ error: 'Authentication required' });
    return null;
  },
}));
jest.mock('../../lib/auth/access-control', () => ({
  ...jest.requireActual('../../lib/auth/access-control'),
  getUserAccess: async () => mockCaller.current ?? { userId: null, permissions: new Set(['lobby.view', 'table.view']) },
  requirePlayerAccess: async (_req: any, res: any) => {
    if (mockCaller.current?.userId) return mockCaller.current;
    res.status(401).json({ error: 'Authentication required' });
    return null;
  },
  logAdminAction: jest.fn(),
}));

jest.mock('../../lib/realtime/publisher', () => ({
  publishTableEvent: jest.fn().mockResolvedValue(undefined),
  publishChatMessage: jest.fn().mockResolvedValue(undefined),
}));
const mockSeatClaim = jest.fn(async () => ({ status: 200, body: { ok: true } }));
jest.mock('../../lib/server/seat-actions', () => ({
  performSeatClaim: () => mockSeatClaim(),
  leaveTable: jest.fn(async () => ({ seatNumber: 2, cashedOut: 0 })),
  syncWaitlist: jest.fn(),
}));
jest.mock('../../lib/shared/game-seats', () => ({
  ...jest.requireActual('../../lib/shared/game-seats'),
  loadPersistedRoomSeats: async (roomId: string) => {
    const seats = mockRooms.get(roomId)?.configuration?.seats || {};
    const out: Record<number, any> = {};
    for (let n = 1; n <= 9; n++) out[n] = seats[n] || null;
    return out;
  },
  tablesSeatedAt: async () => [],
}));
jest.mock('../../lib/poker/engine-persistence', () => ({ getOrRestoreEngine: async () => null }));
jest.mock('../../lib/api/rate-limit', () => ({ rateLimit: () => ({ allowed: true }) }));
jest.mock('../../lib/api/audit', () => ({ createSafeAudit: () => jest.fn() }));
const mockCreateRoom = jest.fn(async (input: any) => ({ id: 'NEWROOM1', ...input }));
jest.mock('../../lib/services/game-service', () => ({
  GameService: jest.fn(() => ({
    createRoom: mockCreateRoom,
    getRoomById: async (id: string) => {
      const r = mockRooms.get(id);
      return r && { id: r.id, name: r.name, maxPlayers: r.max_players, createdBy: r.created_by, configuration: r.configuration, blindLevels: r.blind_levels };
    },
  })),
}));
const mockChatSend = jest.fn(async (input: any) => ({ id: 'm1', ...input }));
jest.mock('../../lib/services/chat-service', () => ({
  ChatService: jest.fn(() => ({ send: mockChatSend, listRoom: async () => [] })),
}));

import createHandler from '../../../pages/api/games/rooms/create';
import joinHandler from '../../../pages/api/games/rooms/join';
import roomHandler from '../../../pages/api/games/rooms/[id]';
import lobbyHandler from '../../../pages/api/games/rooms/lobby';
import extrasHandler from '../../../pages/api/games/table-extras';
import claimHandler from '../../../pages/api/games/seats/claim';
import seatsStateHandler from '../../../pages/api/games/seats/state';
import stateHandler from '../../../pages/api/games/state';
import waitlistHandler from '../../../pages/api/games/waitlist';
import hostHandler from '../../../pages/api/games/host';
import chatSendHandler from '../../../pages/api/chat/send';
import chatListHandler from '../../../pages/api/chat/room/list';

async function call(handler: any, { method = 'GET', body, query = {} }: { method?: string; body?: any; query?: any } = {}) {
  const res: any = { setHeader: jest.fn() };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  const req = { method, body, query, headers: {}, cookies: {}, socket: {} } as unknown as NextApiRequest;
  await handler(req, res as NextApiResponse);
  return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}

function addRoom(id: string, configuration: any, createdBy = 'host', createdAt = new Date()) {
  mockRooms.set(id, {
    id, name: `Room ${id}`, created_by: createdBy, max_players: 6, blind_levels: { sb: 1, bb: 2 },
    status: 'waiting', created_at: createdAt, configuration,
  });
}

beforeEach(() => {
  mockRooms.clear();
  mockCaller.current = null;
  mockCreateRoom.mockClear();
  mockSeatClaim.mockClear();
  mockChatSend.mockClear();
  addRoom('PUBLIC01', { visibility: 'public', variant: 'texas-holdem', bettingMode: 'no-limit' });
  addRoom('PRIVATE1', { visibility: 'private', inviteCode: 'K7QM2XPAHR', members: ['member'], variant: 'omaha', bettingMode: 'pot-limit' });
});

describe('creating a room', () => {
  test('a private room gets an invite code; anything the client sent about access is ignored', async () => {
    signIn('host');
    const r = await call(createHandler, {
      method: 'POST',
      body: { visibility: 'private', name: 'x', configuration: { variant: 'omaha', inviteCode: 'MINE', members: ['friend'] } },
    });
    expect(r.status).toBe(201);
    const { configuration } = mockCreateRoom.mock.calls[0][0];
    expect(configuration.variant).toBe('omaha');
    expect(configuration.visibility).toBe('private');
    expect(configuration.inviteCode).toMatch(/^[2-9A-HJKMNP-Z]{10}$/);
    expect(configuration.members).toEqual([]);
  });

  test('rooms are public by default, even if the client slips visibility into the configuration', async () => {
    signIn('host');
    await call(createHandler, { method: 'POST', body: { configuration: { visibility: 'private', inviteCode: 'MINE' } } });
    expect(mockCreateRoom.mock.calls[0][0].configuration).toEqual({ visibility: 'public' });
  });

  test('a private room needs room.create_private', async () => {
    signIn('host', PLAYER.filter(p => p !== 'room.create_private'));
    const r = await call(createHandler, { method: 'POST', body: { visibility: 'private' } });
    expect(r.status).toBe(403);
    expect(mockCreateRoom).not.toHaveBeenCalled();
  });
});

describe('joining with an invite code', () => {
  test('makes the user a member, then they can open the table', async () => {
    signIn('friend');
    expect((await call(roomHandler, { query: { id: 'PRIVATE1' } })).status).toBe(403);

    const r = await call(joinHandler, { method: 'POST', body: { code: 'k7qm2-xpahr' } });
    expect(r).toEqual({ status: 200, body: { roomId: 'PRIVATE1', name: 'Room PRIVATE1' } });
    expect(mockRooms.get('PRIVATE1')!.configuration.members).toEqual(['member', 'friend']);
    expect((await call(roomHandler, { query: { id: 'PRIVATE1' } })).status).toBe(200);
  });

  test('needs a signed-in user and a current code', async () => {
    expect((await call(joinHandler, { method: 'POST', body: { code: 'K7QM2XPAHR' } })).status).toBe(401);
    signIn('friend');
    expect((await call(joinHandler, { method: 'POST', body: { code: 'K7QM2XPAHS' } })).body.code).toBe('INVITE_NOT_FOUND');
    expect((await call(joinHandler, { method: 'POST', body: { code: 'PRIVATE1' } })).status).toBe(404);
  });

  test('a public room\'s leftover code opens nothing', async () => {
    mockRooms.get('PRIVATE1')!.configuration.visibility = 'public';
    signIn('friend');
    expect((await call(joinHandler, { method: 'POST', body: { code: 'K7QM2XPAHR' } })).status).toBe(404);
  });
});

describe('who can see a private table', () => {
  const reads: Array<[string, any, any]> = [
    ['room details', roomHandler, { id: 'PRIVATE1' }],
    ['game state', stateHandler, { tableId: 'PRIVATE1' }],
    ['seats', seatsStateHandler, { tableId: 'PRIVATE1' }],
    ['table extras', extrasHandler, { tableId: 'PRIVATE1' }],
    ['chat history', chatListHandler, { roomId: 'PRIVATE1' }],
  ];

  test.each(reads)('%s: refused to visitors and other players', async (_name, handler, query) => {
    const visitor = await call(handler, { query });
    expect(visitor).toEqual({ status: 403, body: expect.objectContaining({ code: 'PRIVATE_TABLE' }) });
    signIn('stranger');
    expect((await call(handler, { query })).status).toBe(403);
  });

  test.each(reads)('%s: open to members and staff with table.view_private', async (_name, handler, query) => {
    signIn('member');
    expect((await call(handler, { query })).status).not.toBe(403);
    signIn('moderator', ['table.view_private']);
    expect((await call(handler, { query })).status).not.toBe(403);
  });

  test('public tables are unchanged for signed-out visitors', async () => {
    expect((await call(roomHandler, { query: { id: 'PUBLIC01' } })).status).toBe(200);
    expect((await call(seatsStateHandler, { query: { tableId: 'PUBLIC01' } })).status).toBe(200);
  });

  test('only the host sees the invite code and member list', async () => {
    signIn('member');
    const asMember = await call(roomHandler, { query: { id: 'PRIVATE1' } });
    expect(asMember.body.configuration).toEqual({ visibility: 'private', variant: 'omaha', bettingMode: 'pot-limit' });
    expect((await call(extrasHandler, { query: { tableId: 'PRIVATE1' } })).body).toMatchObject({ visibility: 'private', inviteCode: undefined });

    signIn('host');
    expect((await call(roomHandler, { query: { id: 'PRIVATE1' } })).body.configuration.inviteCode).toBe('K7QM2XPAHR');
    expect((await call(extrasHandler, { query: { tableId: 'PRIVATE1' } })).body.inviteCode).toBe('K7QM2-XPAHR');
  });
});

describe('playing at a private table', () => {
  const seat = { tableId: 'PRIVATE1', seatNumber: 1, playerName: 'Me' };

  test('members can sit; others are refused before anything happens', async () => {
    signIn('stranger');
    expect((await call(claimHandler, { method: 'POST', body: seat })).body.code).toBe('PRIVATE_TABLE');
    signIn('member');
    expect((await call(claimHandler, { method: 'POST', body: seat })).status).toBe(200);
    expect(mockSeatClaim).toHaveBeenCalledTimes(1);
  });

  test('an invited member sits without table.join_private, which is for staff without an invite', async () => {
    const noJoinPrivate = PLAYER.filter(p => p !== 'table.join_private');
    signIn('member', noJoinPrivate);
    expect((await call(claimHandler, { method: 'POST', body: seat })).status).toBe(200);
    signIn('moderator', [...noJoinPrivate, 'table.view_private']);
    const r = await call(claimHandler, { method: 'POST', body: seat });
    expect(r).toEqual({ status: 403, body: expect.objectContaining({ code: 'PERMISSION_DENIED' }) });
    signIn('moderator', [...PLAYER, 'table.view_private']);
    expect((await call(claimHandler, { method: 'POST', body: seat })).status).toBe(200);
  });

  test('the waitlist and table chat are for members', async () => {
    signIn('stranger');
    expect((await call(waitlistHandler, { method: 'POST', body: { tableId: 'PRIVATE1', join: true } })).status).toBe(403);
    expect((await call(chatSendHandler, { method: 'POST', body: { roomId: 'PRIVATE1', message: 'hi' } })).status).toBe(403);
    expect(mockChatSend).not.toHaveBeenCalled();

    signIn('member');
    expect((await call(waitlistHandler, { method: 'POST', body: { tableId: 'PRIVATE1', join: true } })).status).toBe(200);
    expect((await call(chatSendHandler, { method: 'POST', body: { roomId: 'PRIVATE1', message: 'hi' } })).status).toBe(201);
  });
});

describe('host controls', () => {
  const host = (body: any) => call(hostHandler, { method: 'POST', body: { tableId: 'PRIVATE1', ...body } });

  test('a new invite link replaces the old one', async () => {
    signIn('host');
    const r = await host({ action: 'new-invite-code' });
    expect(r.status).toBe(200);
    const code = mockRooms.get('PRIVATE1')!.configuration.inviteCode;
    expect(code).not.toBe('K7QM2XPAHR');
    expect(r.body.inviteCode).toBe(`${code.slice(0, 5)}-${code.slice(5)}`);

    signIn('friend');
    expect((await call(joinHandler, { method: 'POST', body: { code: 'K7QM2XPAHR' } })).status).toBe(404);
  });

  test('only the host can see or replace the link', async () => {
    signIn('member');
    expect((await host({ action: 'new-invite-code' })).status).toBe(403);
    expect(mockRooms.get('PRIVATE1')!.configuration.inviteCode).toBe('K7QM2XPAHR');
  });

  test('making a table private keeps everyone already there, and gives it a link', async () => {
    mockRooms.get('PUBLIC01')!.configuration = {
      visibility: 'public',
      seats: { 1: { playerId: 'host', playerName: 'H', chips: 100 }, 3: { playerId: 'seated', playerName: 'S', chips: 100 } },
      waitlist: [{ playerId: 'waiting', playerName: 'W', joinedAt: 1 }],
    };
    signIn('host');
    expect((await call(hostHandler, { method: 'POST', body: { tableId: 'PUBLIC01', action: 'set-visibility', private: true } })).status).toBe(200);
    const config = mockRooms.get('PUBLIC01')!.configuration;
    expect(config.visibility).toBe('private');
    expect(config.inviteCode).toMatch(/^[2-9A-HJKMNP-Z]{10}$/);
    expect(config.members.sort()).toEqual(['seated', 'waiting']);

    expect((await call(hostHandler, { method: 'POST', body: { tableId: 'PUBLIC01', action: 'set-visibility', private: false } })).status).toBe(200);
    expect(mockRooms.get('PUBLIC01')!.configuration.visibility).toBe('public');
  });

  test('making a table private needs room.create_private', async () => {
    signIn('host', PLAYER.filter(p => p !== 'room.create_private'));
    const r = await call(hostHandler, { method: 'POST', body: { tableId: 'PUBLIC01', action: 'set-visibility', private: true } });
    expect(r.status).toBe(403);
    expect(mockRooms.get('PUBLIC01')!.configuration.visibility).toBe('public');
  });

  test('removing a player from a private table takes away their membership', async () => {
    signIn('host');
    expect((await host({ action: 'kick', targetId: 'member' })).status).toBe(200);
    expect(mockRooms.get('PRIVATE1')!.configuration.members).toEqual([]);
    signIn('member');
    expect((await call(roomHandler, { query: { id: 'PRIVATE1' } })).status).toBe(403);
  });
});

describe('the dashboard lobby', () => {
  test('lists public tables for everyone, busiest first, and never private ones', async () => {
    addRoom('BUSY0001', { seats: { 1: { playerId: 'a' }, 2: { playerId: 'b' } } }, 'other', new Date(Date.now() - 3_600_000));
    const r = await call(lobbyHandler);
    expect(r.status).toBe(200);
    expect(r.body.open.map((t: any) => t.id)).toEqual(['BUSY0001', 'PUBLIC01']);
    expect(r.body.open[0]).toMatchObject({ seated: 2, maxPlayers: 6, host: 'other-name', game: 'Texas Hold\'em', smallBlind: 1, bigBlind: 2, isPrivate: false });
    expect(r.body.open[1].game).toBe('No Limit Texas Hold\'em');
    expect(r.body.mine).toEqual([]);
  });

  test('"mine" lists the private tables a user hosts or joined', async () => {
    signIn('member');
    const asMember = await call(lobbyHandler);
    expect(asMember.body.mine).toEqual([expect.objectContaining({ id: 'PRIVATE1', isPrivate: true, isHost: false, game: 'Pot Limit Omaha' })]);
    signIn('host');
    expect((await call(lobbyHandler)).body.mine[0].isHost).toBe(true);
    signIn('stranger');
    expect((await call(lobbyHandler)).body.mine).toEqual([]);
  });

  test('without lobby.view the public list is empty', async () => {
    signIn('member', ['table.join']);
    const r = await call(lobbyHandler);
    expect(r.body).toMatchObject({ open: [], canView: false });
    expect(r.body.mine).toHaveLength(1);
  });
});
