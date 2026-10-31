/**
 * @jest-environment node
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { canOnTable, tableHostPermissions } from '../../lib/auth/table-access';
import type { UserAccess } from '../../lib/auth/access-control';

// The signed-in caller; each test sets who they are and what they hold
const mockCaller: { current: UserAccess & { userId: string } } = { current: null as any };
const mockLog = jest.fn();
jest.mock('../../lib/auth/access-control', () => {
  const actual = jest.requireActual('../../lib/auth/access-control');
  return {
    ...actual,
    requirePlayerAccess: async () => mockCaller.current,
    getUserAccess: async () => mockCaller.current,
    logAdminAction: (...args: any[]) => mockLog(...args),
  };
});
jest.mock('../../lib/auth/auth-utils', () => ({
  getSessionUser: async () => (mockCaller.current ? { id: mockCaller.current.userId, email: null } : null),
}));

const mockRoom = { createdBy: 'owner', maxPlayers: 6, configuration: { seatRequests: [{ playerId: 'p9', playerName: 'Nine', seatNumber: 2, requestedAt: 1 }] } };
const mockUpdateRoomConfig = jest.fn();
jest.mock('../../lib/server/room-config', () => ({
  loadRoom: async () => mockRoom,
  updateRoomConfig: (...args: any[]) => mockUpdateRoomConfig(...args),
  advanceSeatOffer: () => ({ changed: false, waitlist: [], seatOffer: null }),
  freeSeatNumbers: () => [],
}));
jest.mock('../../lib/realtime/publisher', () => ({ publishTableEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../lib/poker/engine-persistence', () => ({ getOrRestoreEngine: jest.fn().mockResolvedValue(null) }));
jest.mock('../../lib/server/game-action-pipeline', () => ({ broadcastGameState: jest.fn() }));
jest.mock('../../lib/server/seat-actions', () => ({
  leaveTable: jest.fn().mockResolvedValue({ seatNumber: 3, cashedOut: 100 }),
  performSeatClaim: jest.fn(),
  syncWaitlist: jest.fn(),
}));
jest.mock('../../lib/shared/game-seats', () => ({ loadPersistedRoomSeats: async () => ({}), getRoomSeats: () => ({}) }));
jest.mock('../../lib/server/chip-ledger', () => ({
  loadLedger: async () => [],
  summarizeLedger: () => [],
  settlementPayments: () => [],
  ledgerToCsv: () => '',
}));
const mockCreateRoom = jest.fn();
jest.mock('../../lib/services/game-service', () => ({ GameService: jest.fn(() => ({ createRoom: mockCreateRoom })) }));
jest.mock('../../lib/api/rate-limit', () => ({ rateLimit: () => ({ allowed: true }) }));
jest.mock('../../lib/api/audit', () => ({ createSafeAudit: () => jest.fn() }));
jest.mock('../../lib/database/pool', () => ({ getPool: () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }) }));

import hostHandler from '../../../pages/api/games/host';
import extrasHandler from '../../../pages/api/games/table-extras';
import ledgerHandler from '../../../pages/api/games/ledger';
import createHandler from '../../../pages/api/games/rooms/create';

function caller(userId: string, permissions: string[]): UserAccess & { userId: string } {
  return { userId, email: null, roles: [], rank: 0, permissions: new Set(permissions), bootstrapAdmin: false, limits: {}, sanction: null };
}

async function call(handler: any, method: string, body?: any, query: Record<string, string> = {}) {
  const res: any = { setHeader: jest.fn(), send: jest.fn() };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  await handler({ method, body, query, headers: {}, cookies: {}, socket: {} } as unknown as NextApiRequest, res as NextApiResponse);
  return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}

beforeEach(() => {
  mockLog.mockReset();
  mockUpdateRoomConfig.mockReset();
  mockCreateRoom.mockReset();
});

describe('canOnTable', () => {
  const room = { createdBy: 'owner' };
  test('owners use host permissions they hold on their own table', () => {
    expect(canOnTable(caller('owner', ['room.configure']), room, 'room.configure')).toEqual({ allowed: true, asAdmin: false });
    expect(canOnTable(caller('owner', []), room, 'room.configure').allowed).toBe(false);
  });
  test('host permissions do nothing at someone else\'s table', () => {
    expect(canOnTable(caller('other', ['room.configure']), room, 'room.configure').allowed).toBe(false);
  });
  test('admin.rooms.manage allows every host control anywhere, flagged as an admin action', () => {
    expect(canOnTable(caller('staff', ['admin.rooms.manage']), room, 'room.kick_player')).toEqual({ allowed: true, asAdmin: true });
    expect(tableHostPermissions(caller('staff', ['admin.rooms.manage']), room)).toHaveLength(5);
  });
  test('tableHostPermissions lists only what the owner holds', () => {
    expect(tableHostPermissions(caller('owner', ['room.start', 'room.kick_player', 'chat.send']), room)).toEqual(['room.start', 'room.kick_player']);
  });
});

describe('POST /api/games/host', () => {
  test('the owner with the permission can act', async () => {
    mockCaller.current = caller('owner', ['room.approve_seat']);
    const r = await call(hostHandler, 'POST', { tableId: 't1', action: 'require-approval', required: true });
    expect(r.status).toBe(200);
    expect(mockUpdateRoomConfig).toHaveBeenCalledWith('t1', { requireSeatApproval: true });
    expect(mockLog).not.toHaveBeenCalled();
  });

  test('the owner without the permission is told which one is missing', async () => {
    mockCaller.current = caller('owner', ['room.configure']);
    const r = await call(hostHandler, 'POST', { tableId: 't1', action: 'kick', targetId: 'p2' });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'room.kick_player' });
  });

  test('a player at someone else\'s table is refused, whatever they hold', async () => {
    mockCaller.current = caller('other', ['room.approve_seat']);
    const r = await call(hostHandler, 'POST', { tableId: 't1', action: 'require-approval', required: true });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'Only the host can do that' });
    expect(mockUpdateRoomConfig).not.toHaveBeenCalled();
  });

  test('staff with admin.rooms.manage can act on any table, and it is audited', async () => {
    mockCaller.current = caller('staff', ['admin.rooms.manage']);
    const r = await call(hostHandler, 'POST', { tableId: 't1', playerId: 'staff', action: 'kick', targetId: 'p2' });
    expect(r.status).toBe(200);
    expect(mockLog).toHaveBeenCalledWith('staff', 'table.kick', 'room', 't1', { action: 'kick', targetId: 'p2' });
  });

  test('unknown actions are rejected before any permission check', async () => {
    mockCaller.current = caller('owner', []);
    const r = await call(hostHandler, 'POST', { tableId: 't1', action: 'explode' });
    expect(r.status).toBe(400);
  });
});

describe('GET /api/games/table-extras', () => {
  test('reports the host controls the viewer can use, and seat requests only to approvers', async () => {
    mockCaller.current = caller('owner', ['room.configure', 'room.start']);
    const owner = await call(extrasHandler, 'GET', undefined, { tableId: 't1' });
    expect(owner.body.isHost).toBe(true);
    expect(owner.body.hostPermissions).toEqual(['room.start', 'room.configure']);
    expect(owner.body.seatRequests).toBeUndefined();

    mockCaller.current = caller('staff', ['admin.rooms.manage']);
    const staff = await call(extrasHandler, 'GET', undefined, { tableId: 't1' });
    expect(staff.body.isHost).toBe(false);
    expect(staff.body.hostPermissions).toContain('room.approve_seat');
    expect(staff.body.seatRequests).toHaveLength(1);

    mockCaller.current = caller('other', ['room.approve_seat']);
    const other = await call(extrasHandler, 'GET', undefined, { tableId: 't1' });
    expect(other.body.hostPermissions).toEqual([]);
  });
});

describe('GET /api/games/ledger', () => {
  test('the host needs room.view_ledger; staff who see all rooms always can', async () => {
    mockCaller.current = caller('owner', []);
    expect((await call(ledgerHandler, 'GET', undefined, { tableId: 't1' })).status).toBe(403);

    mockCaller.current = caller('owner', ['room.view_ledger']);
    expect((await call(ledgerHandler, 'GET', undefined, { tableId: 't1' })).status).toBe(200);

    mockCaller.current = caller('staff', ['admin.rooms.view']);
    expect((await call(ledgerHandler, 'GET', undefined, { tableId: 't1' })).status).toBe(200);

    mockCaller.current = caller('other', ['room.view_ledger']);
    expect((await call(ledgerHandler, 'GET', undefined, { tableId: 't1' })).status).toBe(403);
  });
});

describe('POST /api/games/rooms/create', () => {
  const room = (variant: string) => ({ name: 'T', gameType: 'poker', maxPlayers: 6, configuration: { variant } });

  test('needs room.create', async () => {
    mockCaller.current = caller('u1', []);
    const r = await call(createHandler, 'POST', room('texas-holdem'));
    expect(r.body).toMatchObject({ permission: 'room.create' });
    expect(mockCreateRoom).not.toHaveBeenCalled();
  });

  test('dealer\'s choice and mixed games also need room.choose_variant', async () => {
    mockCaller.current = caller('u1', ['room.create']);
    for (const variant of ['dealers-choice', 'mixed']) {
      const r = await call(createHandler, 'POST', room(variant));
      expect(r.body).toMatchObject({ permission: 'room.choose_variant' });
    }
    expect(mockCreateRoom).not.toHaveBeenCalled();

    mockCreateRoom.mockResolvedValue({ id: 'r1' });
    expect((await call(createHandler, 'POST', room('texas-holdem'))).status).toBe(201);
    mockCaller.current = caller('u1', ['room.create', 'room.choose_variant']);
    expect((await call(createHandler, 'POST', room('mixed'))).status).toBe(201);
    expect(mockCreateRoom.mock.calls[1][0].createdBy).toBe('u1');
  });
});
