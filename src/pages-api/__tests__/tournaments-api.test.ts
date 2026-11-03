import type { NextApiRequest, NextApiResponse } from 'next';

import createHandler from '../../../pages/api/tournaments/create';
import registerHandler from '../../../pages/api/tournaments/register';
import startHandler from '../../../pages/api/tournaments/start';
import advanceHandler from '../../../pages/api/tournaments/advance-level';
import endBreakHandler from '../../../pages/api/tournaments/end-break';
import pauseHandler from '../../../pages/api/tournaments/pause';
import resumeHandler from '../../../pages/api/tournaments/resume';
import payoutsHandler from '../../../pages/api/tournaments/payouts';
import getHandler from '../../../pages/api/tournaments/get';
import reportHandler from '../../../pages/api/tournaments/report';
import rebuyHandler from '../../../pages/api/tournaments/rebuy';
import addOnHandler from '../../../pages/api/tournaments/add-on';
import eliminateHandler from '../../../pages/api/tournaments/eliminate';
import viewHandler from '../../../pages/api/tournaments/view';
import listHandler from '../../../pages/api/tournaments/list';
import unregisterHandler from '../../../pages/api/tournaments/unregister';
import undoHandler from '../../../pages/api/tournaments/undo-elimination';
import removePlayerHandler from '../../../pages/api/tournaments/remove-player';
import editHandler from '../../../pages/api/tournaments/edit';
import cancelHandler from '../../../pages/api/tournaments/cancel';
import reenterHandler from '../../../pages/api/tournaments/reenter';

import { createDefaultFreezeoutConfig } from '../../../src/lib/tournament/tournament-utils';

// Signed-in organizer for organizer actions; players act as the userId they send
const mockRequirePermission = jest.fn(async (_req: any, _res: any, _permission: string): Promise<any> => ({ userId: 'admin-1', permissions: new Set<string>() }));
// Access of the caller on routes guests may use; signed-out visitors hold tournament.view
const mockRequestAccess = jest.fn(async (_req: any): Promise<any> => ({ userId: null, permissions: new Set(['tournament.view']) }));
jest.mock('../../../src/lib/auth/access-control', () => ({
  requirePermission: (...args: [any, any, string]) => mockRequirePermission(...args),
  getRequestAccess: (req: any) => mockRequestAccess(req),
  hasPermission: (access: any, permission: string) => access.permissions.has(permission),
  sendPermissionDenied: (res: any, permission: string) => res.status(403).json({ code: 'PERMISSION_DENIED', permission }),
}));
// Tournaments in memory instead of Postgres
jest.mock('../../../src/lib/tournament/manager-instance', () => {
  const { TournamentManager } = jest.requireActual('../../../src/lib/tournament/tournament-manager');
  const { MemoryTournamentStore } = jest.requireActual('../../../src/lib/tournament/tournament-store');
  return { tournamentManager: new TournamentManager(new MemoryTournamentStore()) };
});
const mockRequirePlayer = jest.fn(async (_req: any, _res: any, claimed?: unknown) => (claimed ? String(claimed) : 'u1'));
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  requirePlayer: (...args: any[]) => mockRequirePlayer(...args),
}));

// Tables play in game rooms; the room side is tested on its own
const mockSyncRooms = jest.fn(async (_id: string) => {});
jest.mock('../../../src/lib/tournament/table-rooms', () => ({
  syncTournamentRooms: (id: string) => mockSyncRooms(id),
  keepTablesMoving: (id: string) => mockKeepTablesMoving(id),
}));
const mockKeepTablesMoving = jest.fn(async (_id: string) => {});

// Usernames come from the users table
const mockLoadPlayerNames = jest.fn(async (_ids: string[]) => ({ p1: 'Player One' }) as Record<string, string>);
jest.mock('../../../src/lib/tournament/pg-tournament-store', () => ({
  loadPlayerNames: (ids: string[]) => mockLoadPlayerNames(ids),
}));

// Mock rate limiter
jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 })
}));

function createRes() {
  const res: Partial<NextApiResponse> & { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  } as any;
  return res;
}

function createReq(method: string, body?: any, query?: any): Partial<NextApiRequest> {
  return {
    method,
    body,
    query,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' } as any
  } as any;
}

describe('Tournaments API routes (US-058)', () => {
  test('end-to-end lifecycle via API', async () => {
    const cfg = createDefaultFreezeoutConfig();
    // Create
    const res1 = createRes();
    await createHandler(createReq('POST', { name: 'Weekly', config: cfg }) as any, res1 as any);
    expect(res1.status).toHaveBeenCalledWith(201);
    const created = res1.json.mock.calls[0][0];
    expect(created.status).toBe('setup');

    // Register
    const res2 = createRes();
    await registerHandler(createReq('POST', { tournamentId: created.id, userId: 'u1' }) as any, res2 as any);
    expect(res2.status).toHaveBeenCalledWith(200);

    const res3 = createRes();
    await registerHandler(createReq('POST', { tournamentId: created.id, userId: 'u2' }) as any, res3 as any);
    expect(res3.status).toHaveBeenCalledWith(200);

    // Start
    const res4 = createRes();
    await startHandler(createReq('POST', { tournamentId: created.id }) as any, res4 as any);
    expect(res4.status).toHaveBeenCalledWith(200);
    const started = res4.json.mock.calls[0][0];
    expect(started.status).toBe('running');

    // Advance level then hit break
    const res5 = createRes();
    await advanceHandler(createReq('POST', { tournamentId: created.id }) as any, res5 as any);
    expect(res5.status).toHaveBeenCalledWith(200);
    const afterAdv1 = res5.json.mock.calls[0][0];
    expect(afterAdv1.status).toBe('running');

    const res6 = createRes();
    await advanceHandler(createReq('POST', { tournamentId: created.id }) as any, res6 as any);
    expect(res6.status).toHaveBeenCalledWith(200);
    const onBreak = res6.json.mock.calls[0][0];
    expect(onBreak.status).toBe('on-break');

    // End break
    const res7 = createRes();
    await endBreakHandler(createReq('POST', { tournamentId: created.id }) as any, res7 as any);
    expect(res7.status).toHaveBeenCalledWith(200);

    // Pause/Resume
    const res8 = createRes();
    await pauseHandler(createReq('POST', { tournamentId: created.id }) as any, res8 as any);
    expect(res8.status).toHaveBeenCalledWith(200);
    const paused = res8.json.mock.calls[0][0];
    expect(paused.status).toBe('paused');

    const res9 = createRes();
    await resumeHandler(createReq('POST', { tournamentId: created.id }) as any, res9 as any);
    expect(res9.status).toHaveBeenCalledWith(200);

    // Payouts
    const res10 = createRes();
    await payoutsHandler(createReq('GET', undefined, { tournamentId: created.id }) as any, res10 as any);
    expect(res10.status).toHaveBeenCalledWith(200);
    // The default freezeout is free, so there's nothing in the pool; two entrants means two paid places
    const payouts = res10.json.mock.calls[0][0];
    expect(payouts.prizePool).toBe(0);
    expect(payouts.payouts.map((p: any) => p.place)).toEqual([1, 2]);

    // Get current state
    const res11 = createRes();
    await getHandler(createReq('GET', undefined, { tournamentId: created.id }) as any, res11 as any);
    expect(res11.status).toHaveBeenCalledWith(200);

  // Rebuy (should be allowed if config supports; default freezeout does not, expect error)
  const resRebuy = createRes();
  await rebuyHandler(createReq('POST', { tournamentId: created.id, userId: 'u1' }) as any, resRebuy as any);
  // For freezeout, expect 400
  expect(resRebuy.status).toHaveBeenCalledWith(400);

  // Create a rebuy tournament and exercise add-on
  const resA = createRes();
  const { createRebuyAddOnConfig } = await import('../../../src/lib/tournament/tournament-utils');
  await createHandler(createReq('POST', { name: 'Rebuy', config: createRebuyAddOnConfig() }) as any, resA as any);
  const createdRebuy = resA.json.mock.calls[0][0];
  const resB = createRes();
  await registerHandler(createReq('POST', { tournamentId: createdRebuy.id, userId: 'u3' }) as any, resB as any);
  const resC = createRes();
  await registerHandler(createReq('POST', { tournamentId: createdRebuy.id, userId: 'u4' }) as any, resC as any);
  const resD = createRes();
  await startHandler(createReq('POST', { tournamentId: createdRebuy.id }) as any, resD as any);
  // Rebuy should succeed
  const resE = createRes();
  await rebuyHandler(createReq('POST', { tournamentId: createdRebuy.id, userId: 'u3' }) as any, resE as any);
  expect(resE.status).toHaveBeenCalledWith(200);
  // Advance to break and do add-on
  const resF1 = createRes();
  await advanceHandler(createReq('POST', { tournamentId: createdRebuy.id }) as any, resF1 as any);
  const resF2 = createRes();
  await advanceHandler(createReq('POST', { tournamentId: createdRebuy.id }) as any, resF2 as any);
  const resF3 = createRes();
  await advanceHandler(createReq('POST', { tournamentId: createdRebuy.id }) as any, resF3 as any);
  const resG = createRes();
  await addOnHandler(createReq('POST', { tournamentId: createdRebuy.id, userId: 'u3' }) as any, resG as any);
  expect(resG.status).toHaveBeenCalledWith(200);

  // Report
  const res12 = createRes();
  await reportHandler(createReq('GET', undefined, { tournamentId: created.id, prizePool: '1000' }) as any, res12 as any);
  expect(res12.status).toHaveBeenCalledWith(200);
  const report = res12.json.mock.calls[0][0];
  expect(report.registration.total).toBeGreaterThanOrEqual(2);
  });

  test('the view shows the tournament with names, and the knockout is recorded', async () => {
    const created = createRes();
    const config = { ...createDefaultFreezeoutConfig(), buyIn: 10, bounty: { amount: 2, type: 'standard' as const } };
    await createHandler(createReq('POST', { name: 'KO', config }) as any, created as any);
    const { id } = created.json.mock.calls[0][0];
    for (const userId of ['p1', 'p2', 'p3']) await registerHandler(createReq('POST', { tournamentId: id, userId }) as any, createRes() as any);
    await startHandler(createReq('POST', { tournamentId: id }) as any, createRes() as any);

    const missingKnocker = createRes();
    await eliminateHandler(createReq('POST', { tournamentId: id, userId: 'p3' }) as any, missingKnocker as any);
    expect(missingKnocker.status).toHaveBeenCalledWith(400);
    const knockedOut = createRes();
    await eliminateHandler(createReq('POST', { tournamentId: id, userId: 'p3', eliminatedBy: 'p1' }) as any, knockedOut as any);
    expect(knockedOut.status).toHaveBeenCalledWith(200);

    mockRequestAccess.mockResolvedValueOnce({ userId: 'p1', permissions: new Set(['tournament.view']) });
    const res = createRes();
    await viewHandler(createReq('GET', undefined, { tournamentId: id }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const view = res.json.mock.calls[0][0];
    expect(mockLoadPlayerNames).toHaveBeenCalledWith(['p1', 'p2', 'p3']);
    expect(view.prizePool).toBe(30);
    expect(view.players).toMatchObject({ entrants: 3, remaining: 2 });
    expect(view.bounty.board[0]).toMatchObject({ userId: 'p1', name: 'Player One', won: 2 });
    expect(view.you).toMatchObject({ bountyWon: 2, bounty: 2 });
    expect(view.finishers).toEqual([expect.objectContaining({ place: 3, userId: 'p3', eliminatedBy: 'p1' })]);
  });

  test('the view needs tournament.view and an existing tournament', async () => {
    mockRequestAccess.mockResolvedValueOnce({ userId: null, permissions: new Set() });
    const denied = createRes();
    await viewHandler(createReq('GET', undefined, { tournamentId: 'x' }) as any, denied as any);
    expect(denied.status).toHaveBeenCalledWith(403);

    const missing = createRes();
    await viewHandler(createReq('GET', undefined, { tournamentId: 'nope' }) as any, missing as any);
    expect(missing.status).toHaveBeenCalledWith(404);
  });

  describe('directors', () => {
    async function runningTournament() {
      const created = createRes();
      await createHandler(createReq('POST', { name: 'Owned', config: createDefaultFreezeoutConfig() }) as any, created as any);
      const { id } = created.json.mock.calls[0][0];
      for (const userId of ['p1', 'p2', 'p3']) await registerHandler(createReq('POST', { tournamentId: id, userId }) as any, createRes() as any);
      return id as string;
    }
    const asDirector = (userId: string, permissions: string[] = []) =>
      mockRequirePermission.mockResolvedValueOnce({ userId, permissions: new Set(permissions) });

    test('only the director who created a tournament can run it', async () => {
      const id = await runningTournament();
      asDirector('other-td');
      const res = createRes();
      await startHandler(createReq('POST', { tournamentId: id }) as any, res as any);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_ORGANIZER' }));

      const own = createRes();
      await startHandler(createReq('POST', { tournamentId: id }) as any, own as any);
      expect(own.status).toHaveBeenCalledWith(200);

      asDirector('other-td');
      const elim = createRes();
      await eliminateHandler(createReq('POST', { tournamentId: id, userId: 'p3' }) as any, elim as any);
      expect(elim.status).toHaveBeenCalledWith(403);
    });

    test('tournament.manage_any can run any tournament', async () => {
      const id = await runningTournament();
      asDirector('staff-1', ['tournament.manage_any']);
      const res = createRes();
      await startHandler(createReq('POST', { tournamentId: id }) as any, res as any);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('organizer routes check the permission first, then the tournament', async () => {
      const missing = createRes();
      await pauseHandler(createReq('POST', {}) as any, missing as any);
      expect(missing.status).toHaveBeenCalledWith(400);
      const unknown = createRes();
      await pauseHandler(createReq('POST', { tournamentId: 'nope' }) as any, unknown as any);
      expect(unknown.status).toHaveBeenCalledWith(404);
    });

    test('the director can record a rebuy for a player at the desk; others cannot', async () => {
      const created = createRes();
      const { createRebuyAddOnConfig } = await import('../../../src/lib/tournament/tournament-utils');
      await createHandler(createReq('POST', { name: 'Desk', config: createRebuyAddOnConfig() }) as any, created as any);
      const { id } = created.json.mock.calls[0][0];
      for (const userId of ['p1', 'p2']) await registerHandler(createReq('POST', { tournamentId: id, userId }) as any, createRes() as any);
      await startHandler(createReq('POST', { tournamentId: id }) as any, createRes() as any);

      const res = createRes();
      await rebuyHandler(createReq('POST', { tournamentId: id, forPlayer: 'p2' }) as any, res as any);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].registrationTimeline).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'rebuy', userId: 'p2' })]));

      asDirector('other-td');
      const denied = createRes();
      await rebuyHandler(createReq('POST', { tournamentId: id, forPlayer: 'p2' }) as any, denied as any);
      expect(denied.status).toHaveBeenCalledWith(403);
    });
  });

  describe('director tools', () => {
    async function started(players = ['p1', 'p2', 'p3']) {
      const created = createRes();
      await createHandler(createReq('POST', { name: 'Tools', config: createDefaultFreezeoutConfig() }) as any, created as any);
      const { id } = created.json.mock.calls[0][0];
      for (const userId of players) await registerHandler(createReq('POST', { tournamentId: id, userId }) as any, createRes() as any);
      return id as string;
    }
    const call = async (handler: any, body: any) => {
      const res = createRes();
      await handler(createReq('POST', body) as any, res as any);
      return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
    };

    test('edit changes the structure before the start', async () => {
      const id = await started();
      const r = await call(editHandler, { tournamentId: id, name: 'Renamed', config: { ...createDefaultFreezeoutConfig(), startingStack: 5000 } });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ name: 'Renamed', config: { startingStack: 5000 } });
    });

    test('eliminate, undo and remove, with get leaving out the undo copy', async () => {
      const id = await started();
      await call(startHandler, { tournamentId: id });
      expect((await call(eliminateHandler, { tournamentId: id, userId: 'p3' })).status).toBe(200);

      const got = createRes();
      await getHandler(createReq('GET', undefined, { tournamentId: id }) as any, got as any);
      expect(got.json.mock.calls[0][0]).not.toHaveProperty('lastElimination');

      const undone = await call(undoHandler, { tournamentId: id });
      expect(undone.status).toBe(200);
      expect(undone.body.eliminatedPlayers).toEqual([]);
      const again = await call(undoHandler, { tournamentId: id });
      expect(again.status).toBe(400);

      const removed = await call(removePlayerHandler, { tournamentId: id, userId: 'p2' });
      expect(removed.body.eliminationRecords).toEqual([expect.objectContaining({ userId: 'p2', removed: true })]);
      expect((await call(removePlayerHandler, { tournamentId: id })).status).toBe(400);
    });

    test('cancel records the reason', async () => {
      const id = await started();
      const r = await call(cancelHandler, { tournamentId: id, reason: 'Venue closed' });
      expect(r.body).toMatchObject({ status: 'cancelled', cancelReason: 'Venue closed' });
    });

    test('only the director who created the tournament can use them', async () => {
      const id = await started();
      for (const [handler, body] of [
        [editHandler, { tournamentId: id, name: 'X' }],
        [cancelHandler, { tournamentId: id }],
        [undoHandler, { tournamentId: id }],
        [removePlayerHandler, { tournamentId: id, userId: 'p1' }],
      ] as const) {
        mockRequirePermission.mockResolvedValueOnce({ userId: 'someone-else', permissions: new Set() });
        expect((await call(handler, body)).status).toBe(403);
      }
    });
  });

  test('a busted player re-enters, or the director records it at the desk', async () => {
    const created = createRes();
    const config = { ...createDefaultFreezeoutConfig(), buyIn: 10, reentry: { enabled: true } };
    await createHandler(createReq('POST', { name: 'Re-entry', config }) as any, created as any);
    const { id } = created.json.mock.calls[0][0];
    for (const userId of ['r1', 'r2', 'r3']) await registerHandler(createReq('POST', { tournamentId: id, userId }) as any, createRes() as any);
    await startHandler(createReq('POST', { tournamentId: id }) as any, createRes() as any);
    await eliminateHandler(createReq('POST', { tournamentId: id, userId: 'r3' }) as any, createRes() as any);

    mockSyncRooms.mockClear();
    const res = createRes();
    await reenterHandler(createReq('POST', { tournamentId: id, userId: 'r3' }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockRequirePlayer).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'r3', 'tournament.register');
    expect(mockSyncRooms).toHaveBeenCalledWith(id);

    const desk = createRes();
    await reenterHandler(createReq('POST', { tournamentId: id, forPlayer: 'r3' }) as any, desk as any);
    expect(desk.status).toHaveBeenCalledWith(400); // r3 is back in, so there's nothing to re-enter
  });

  test('viewing a tournament whose start time has come starts it and opens its tables', async () => {
    const created = createRes();
    const config = { ...createDefaultFreezeoutConfig(), startsAt: Date.now() + 200 };
    await createHandler(createReq('POST', { name: 'Scheduled', config }) as any, created as any);
    const { id } = created.json.mock.calls[0][0];
    for (const userId of ['s1', 's2']) await registerHandler(createReq('POST', { tournamentId: id, userId }) as any, createRes() as any);
    await new Promise(resolve => setTimeout(resolve, 250));

    mockSyncRooms.mockClear();
    const res = createRes();
    await viewHandler(createReq('GET', undefined, { tournamentId: id }) as any, res as any);
    expect(res.json.mock.calls[0][0].status).toBe('running');
    expect(mockSyncRooms).toHaveBeenCalledWith(id);

    // Already running: nothing more to start
    mockSyncRooms.mockClear();
    await viewHandler(createReq('GET', undefined, { tournamentId: id }) as any, createRes() as any);
    expect(mockSyncRooms).not.toHaveBeenCalled();
  });

  test('players can unregister before the start', async () => {
    const created = createRes();
    await createHandler(createReq('POST', { name: 'Leaving', config: createDefaultFreezeoutConfig() }) as any, created as any);
    const { id } = created.json.mock.calls[0][0];
    await registerHandler(createReq('POST', { tournamentId: id, userId: 'u9' }) as any, createRes() as any);
    const res = createRes();
    await unregisterHandler(createReq('POST', { tournamentId: id, userId: 'u9' }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].registeredPlayers).toEqual([]);
    expect(mockRequirePlayer).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'u9', 'tournament.register');
  });

  test('the lobby lists tournaments by filter with what the viewer can do', async () => {
    const created = createRes();
    await createHandler(createReq('POST', { name: 'Lobby test', config: { ...createDefaultFreezeoutConfig(), buyIn: 20 } }) as any, created as any);
    const { id } = created.json.mock.calls[0][0];
    await registerHandler(createReq('POST', { tournamentId: id, userId: 'lobby-user' }) as any, createRes() as any);

    mockRequestAccess.mockResolvedValueOnce({ userId: 'lobby-user', permissions: new Set(['tournament.view']) });
    const res = createRes();
    await listHandler(createReq('GET', undefined, { filter: 'upcoming' }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const mine = res.json.mock.calls[0][0].tournaments.find((t: any) => t.id === id);
    expect(mine).toMatchObject({
      name: 'Lobby test', status: 'setup', entrants: 1, registrationOpen: true,
      costs: { entry: 20, rebuy: null, addOn: null }, you: { registered: true, eliminated: false }, canManage: false,
    });

    const finished = createRes();
    await listHandler(createReq('GET', undefined, { filter: 'finished' }) as any, finished as any);
    expect(finished.json.mock.calls[0][0].tournaments.some((t: any) => t.id === id)).toBe(false);

    const bad = createRes();
    await listHandler(createReq('GET', undefined, { filter: 'someday' }) as any, bad as any);
    expect(bad.status).toHaveBeenCalledWith(400);
  });

  test('create records who made the tournament', async () => {
    const res = createRes();
    await createHandler(createReq('POST', { name: 'Mine', config: createDefaultFreezeoutConfig() }) as any, res as any);
    expect(res.json.mock.calls[0][0].createdBy).toBe('admin-1');
  });

  test('viewing needs tournament.view, which guests have', async () => {
    const created = createRes();
    await createHandler(createReq('POST', { name: 'Open', config: createDefaultFreezeoutConfig() }) as any, created as any);
    const { id } = created.json.mock.calls[0][0];

    const asGuest = createRes();
    await getHandler(createReq('GET', undefined, { tournamentId: id }) as any, asGuest as any);
    expect(asGuest.status).toHaveBeenCalledWith(200);

    for (const [handler, query] of [[getHandler, { tournamentId: id }], [payoutsHandler, { tournamentId: id, prizePool: '100' }]] as const) {
      mockRequestAccess.mockResolvedValueOnce({ userId: 'u1', permissions: new Set() });
      const res = createRes();
      await handler(createReq('GET', undefined, query) as any, res as any);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ permission: 'tournament.view' }));
    }
  });

  test('reports need tournament.report', async () => {
    mockRequirePermission.mockImplementationOnce(async (_req: any, res: any) => {
      res.status(403).json({ error: 'Permission required' });
      return null;
    });
    const res = createRes();
    await reportHandler(createReq('GET', undefined, { tournamentId: 'x', prizePool: '100' }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockRequirePermission).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'tournament.report');
  });

  test('organizer actions are rejected for non-admins', async () => {
    mockRequirePermission.mockImplementationOnce(async (_req: any, res: any) => {
      res.status(403).json({ error: 'Permission required' });
      return null;
    });
    const res = createRes();
    await createHandler(createReq('POST', { name: 'Sneaky', config: createDefaultFreezeoutConfig() }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.status).not.toHaveBeenCalledWith(201);
  });

  test('players cannot register someone else', async () => {
    const created = createRes();
    await createHandler(createReq('POST', { name: 'Solo', config: createDefaultFreezeoutConfig() }) as any, created as any);
    const tournament = created.json.mock.calls[0][0];

    mockRequirePlayer.mockImplementationOnce(async (_req: any, res: any) => {
      res.status(403).json({ error: 'playerId does not match the authenticated user' });
      return null;
    });
    const res = createRes();
    await registerHandler(createReq('POST', { tournamentId: tournament.id, userId: 'someone-else' }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403);

    const fetched = createRes();
    await getHandler(createReq('GET', undefined, { tournamentId: tournament.id }) as any, fetched as any);
    expect(JSON.stringify(fetched.json.mock.calls[0][0])).not.toContain('someone-else');
  });
});
