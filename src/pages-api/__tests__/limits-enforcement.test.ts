/**
 * @jest-environment node
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import type { UserAccess } from '../../lib/auth/access-control';

// The signed-in caller; each test sets their limits
const mockCaller: { current: UserAccess & { userId: string } } = { current: null as any };
jest.mock('../../lib/auth/access-control', () => ({
  ...jest.requireActual('../../lib/auth/access-control'),
  requirePlayerAccess: async () => mockCaller.current,
}));

// COUNT queries answer with mockCount; everything else returns no rows
const mockCount = { n: 0 };
const mockQuery = jest.fn(async (sql: string) => (sql.includes('COUNT(*)') ? { rows: [{ n: mockCount.n }] } : { rows: [] }));
jest.mock('../../lib/database/pool', () => ({ getPool: () => ({ query: (sql: string, params: unknown[]) => mockQuery(sql, params) }) }));

const mockSeatedAt = jest.fn(async (): Promise<string[]> => []);
jest.mock('../../lib/shared/game-seats', () => ({ tablesSeatedAt: () => mockSeatedAt() }));
const mockSeatClaim = jest.fn(async () => ({ status: 200, body: { ok: true } }));
jest.mock('../../lib/server/seat-actions', () => ({ performSeatClaim: () => mockSeatClaim() }));
jest.mock('../../lib/server/room-config', () => ({ loadRoom: async () => ({ createdBy: 'owner', configuration: {} }), updateRoomConfig: jest.fn() }));
jest.mock('../../lib/realtime/publisher', () => ({ publishTableEvent: jest.fn(), publishChatMessage: jest.fn() }));
const mockCreateRoom = jest.fn(async () => ({ id: 'r1' }));
jest.mock('../../lib/services/game-service', () => ({ GameService: jest.fn(() => ({ createRoom: mockCreateRoom })) }));
const mockSend = jest.fn(async () => ({ id: 'm1', roomId: 'r1' }));
jest.mock('../../lib/services/chat-service', () => ({ ChatService: jest.fn(() => ({ send: mockSend })) }));
jest.mock('../../lib/api/rate-limit', () => ({ rateLimit: () => ({ allowed: true }) }));
jest.mock('../../lib/api/audit', () => ({ createSafeAudit: () => jest.fn() }));

import createHandler from '../../../pages/api/games/rooms/create';
import claimHandler from '../../../pages/api/games/seats/claim';
import sendHandler from '../../../pages/api/chat/send';

function caller(limits: Record<string, number | null>): UserAccess & { userId: string } {
  return {
    userId: 'u1',
    email: null,
    roles: ['player'],
    rank: 10,
    permissions: new Set(['room.create', 'table.join', 'chat.send']),
    bootstrapAdmin: false,
    limits,
    sanction: null,
  };
}

async function call(handler: any, body: any) {
  const res: any = { setHeader: jest.fn() };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  await handler({ method: 'POST', body, query: {}, headers: {}, cookies: {}, socket: {} } as unknown as NextApiRequest, res as NextApiResponse);
  return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}

beforeEach(() => {
  mockQuery.mockClear();
  mockCreateRoom.mockClear();
  mockSeatClaim.mockClear();
  mockSend.mockClear();
  mockSeatedAt.mockReset().mockResolvedValue([]);
  mockCount.n = 0;
});

describe('rooms created per day', () => {
  const room = { name: 'T', gameType: 'poker', maxPlayers: 6, configuration: { variant: 'texas-holdem' } };

  test('counts the caller\'s rooms over the last 24 hours', async () => {
    mockCaller.current = caller({ 'rooms.per_day': 3 });
    mockCount.n = 2;
    expect((await call(createHandler, room)).status).toBe(201);
    const count = mockQuery.mock.calls.find(c => c[0].includes('COUNT(*)'))!;
    expect(count[0]).toMatch(/created_by = \$1 AND created_at > NOW\(\) - INTERVAL '24 hours'/);
    expect(count[1]).toEqual(['u1']);

    mockCount.n = 3;
    const r = await call(createHandler, room);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'You can create up to 3 rooms a day', code: 'LIMIT_REACHED', limit: 'rooms.per_day', max: 3 });
    expect(mockCreateRoom).toHaveBeenCalledTimes(1);
  });

  test('no limit skips the count', async () => {
    mockCaller.current = caller({ 'rooms.per_day': null });
    expect((await call(createHandler, room)).status).toBe(201);
    expect(mockQuery.mock.calls.some(c => c[0].includes('COUNT(*)'))).toBe(false);
  });
});

describe('tables at once', () => {
  const seat = { tableId: 't9', seatNumber: 1, playerName: 'Me' };

  test('refuses another table at the limit, naming the tables the player sits at', async () => {
    mockCaller.current = caller({ 'tables.max_seated': 2 });
    mockSeatedAt.mockResolvedValue(['Friday game', 'High stakes']);
    const r = await call(claimHandler, seat);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({
      code: 'LIMIT_REACHED',
      error: 'You can sit at up to 2 tables at once. You\'re seated at: Friday game, High stakes',
    });
    expect(mockSeatClaim).not.toHaveBeenCalled();

    mockSeatedAt.mockResolvedValue(['Friday game']);
    expect((await call(claimHandler, seat)).status).toBe(200);
  });

  test('no limit skips the lookup', async () => {
    mockCaller.current = caller({ 'tables.max_seated': null });
    expect((await call(claimHandler, seat)).status).toBe(200);
    expect(mockSeatedAt).not.toHaveBeenCalled();
  });
});

describe('chat messages per minute', () => {
  test('counts the sender\'s saved messages over the last minute', async () => {
    mockCaller.current = caller({ 'chat.per_minute': 5 });
    mockCount.n = 4;
    expect((await call(sendHandler, { roomId: 'r1', message: 'hi' })).status).toBe(201);
    mockCount.n = 5;
    const r = await call(sendHandler, { roomId: 'r1', message: 'hi' });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'LIMIT_REACHED', error: 'You can send up to 5 chat messages a minute' });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe('a suspended player', () => {
  test('is told about the suspension instead of a missing permission', async () => {
    mockCaller.current = {
      ...caller({}),
      permissions: new Set(['lobby.view', 'table.view', 'tournament.view']),
      sanction: { kind: 'suspend', until: '2026-11-02T14:00:00.000Z', reason: null },
    };
    const r = await call(claimHandler, { tableId: 't9', seatNumber: 1, playerName: 'Me' });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'PERMISSION_DENIED', error: 'Your account is suspended until 2026-11-02 14:00 UTC' });
  });
});
