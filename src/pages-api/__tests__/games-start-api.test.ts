jest.mock('pg', () => ({ Pool: jest.fn() }));

jest.mock('../../../src/lib/realtime/publisher', () => ({
  publishGameStateUpdate: jest.fn().mockResolvedValue(undefined),
  publishAwaitingDealerChoice: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/lib/realtime/sequence', () => ({
  nextSeq: jest.fn().mockReturnValue(1),
}));

jest.mock('../../../src/lib/poker/run-it-twice-manager', () => ({
  clearRunItState: jest.fn(),
  enrichStateWithRunIt: jest.fn((_tableId: string, state: any) => state),
}));

jest.mock('../../../src/lib/poker/state-sanitizer', () => ({
  sanitizeStateForBroadcast: jest.fn((state: any) => state),
  sanitizeStateForPlayer: jest.fn((state: any) => state),
}));

jest.mock('../../../src/lib/database/pool', () => ({
  getPool: jest.fn(() => ({})),
}));

const mockGetRoomById = jest.fn();
jest.mock('../../../src/lib/services/game-service', () => ({
  GameService: jest.fn().mockImplementation(() => ({
    startGame: jest.fn().mockResolvedValue(undefined),
    getRoomById: (...args: any[]) => mockGetRoomById(...args),
  })),
}));

jest.mock('../../../src/lib/poker/engine-persistence', () => ({
  getOrRestoreEngine: jest.fn(),
  getLastActionAt: jest.fn(),
  persistEngineState: jest.fn().mockResolvedValue(undefined),
}));

// No seats saved in the database, so the route uses the in-memory seat map
jest.mock('../../../src/lib/shared/game-seats', () => ({
  getRoomSeats: jest.fn(),
  setRoomSeats: jest.fn(),
  loadPersistedRoomSeats: jest.fn().mockResolvedValue(null),
  persistRoomSeats: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/lib/poker/poker-engine', () => ({
  PokerEngine: jest.fn().mockImplementation((tableId: string, players: any[]) => ({
    startNewHand: jest.fn(),
    getState: () => ({ tableId, stage: 'preflop', players, dealerPosition: 0, activePlayer: players[0]?.id, pot: 3 }),
  })),
}));

// Simulate a signed-in caller whose session matches the playerId they send
const mockRequirePlayer = jest.fn(async (_req: any, _res: any, claimed?: unknown) => (claimed ? String(claimed) : 'a'));
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  requirePlayer: (...args: any[]) => mockRequirePlayer(...args),
}));

import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../../pages/api/games/start';
import { PokerEngine } from '../../../src/lib/poker/poker-engine';
import * as enginePersistence from '../../../src/lib/poker/engine-persistence';
import * as GameSeats from '../../../src/lib/shared/game-seats';

const MockPokerEngine = PokerEngine as unknown as jest.Mock;
const mockGetOrRestoreEngine = enginePersistence.getOrRestoreEngine as jest.Mock;
const mockGetLastActionAt = enginePersistence.getLastActionAt as jest.Mock;
const mockGetRoomSeats = GameSeats.getRoomSeats as jest.Mock;

function createReq(body: any): NextApiRequest {
  return { method: 'POST', body, headers: {}, query: {} } as any;
}

function createRes(): NextApiResponse & { status: jest.Mock; json: jest.Mock } {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return res;
}

// Seat chips hold the room buy-in
const SEATS = {
  1: { playerId: 'a', playerName: 'A', chips: 100 },
  2: { playerId: 'b', playerName: 'B', chips: 100 },
  3: { playerId: 'c', playerName: 'C', chips: 100 },
};

function existingEngine(stage: string, stacks: Record<string, number>) {
  return {
    getState: () => ({
      stage,
      players: Object.entries(stacks).map(([id, stack]) => ({ id, stack })),
    }),
  };
}

function engineStacks(): number[] {
  const players = MockPokerEngine.mock.calls[0][1] as Array<{ stack: number }>;
  return players.map(p => p.stack);
}

describe('/api/games/start', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRoomSeats.mockReturnValue(SEATS);
    mockGetOrRestoreEngine.mockResolvedValue(null);
    mockGetLastActionAt.mockResolvedValue(null);
    mockGetRoomById.mockResolvedValue({ id: 't1', configuration: {}, blindLevels: { sb: 1, bb: 2 } });
    (global as any).activeGames = undefined;
    (global as any).roomConfigs = undefined;
  });

  it('starts a first game with the seat buy-ins', async () => {
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(engineStacks()).toEqual([100, 100, 100]);
  });

  it('refuses to replace a hand that is being played', async () => {
    mockGetOrRestoreEngine.mockResolvedValue(existingEngine('flop', { a: 80, b: 120 }));
    mockGetLastActionAt.mockResolvedValue(new Date(Date.now() - 30_000));
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(MockPokerEngine).not.toHaveBeenCalled();
  });

  it('treats an in-progress hand as live when its last action time is unknown', async () => {
    mockGetOrRestoreEngine.mockResolvedValue(existingEngine('turn', { a: 80, b: 120 }));
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(MockPokerEngine).not.toHaveBeenCalled();
  });

  it('allows replacing a hand that has been abandoned', async () => {
    mockGetOrRestoreEngine.mockResolvedValue(existingEngine('river', { a: 80, b: 120 }));
    mockGetLastActionAt.mockResolvedValue(new Date(Date.now() - 11 * 60 * 1000));
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('keeps existing stacks on restart and gives only new players the buy-in', async () => {
    mockGetOrRestoreEngine.mockResolvedValue(existingEngine('showdown', { a: 150, b: 50 }));
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(engineStacks()).toEqual([150, 50, 100]);
  });

  it('refuses to restart while a seated player from the current game is busted', async () => {
    mockGetOrRestoreEngine.mockResolvedValue(existingEngine('showdown', { a: 200, b: 0 }));
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(MockPokerEngine).not.toHaveBeenCalled();
  });

  it('uses the room game type and blinds and ignores those sent in the request', async () => {
    mockGetRoomById.mockResolvedValue({
      id: 't1',
      configuration: { variant: 'omaha', bettingMode: 'pot-limit' },
      blindLevels: { sb: 5, bb: 10 },
    });
    const res = createRes();
    await handler(createReq({
      tableId: 't1', playerId: 'a', variant: 'five-card-stud', bettingMode: 'no-limit', sb: 500, bb: 1000,
    }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    const [, , smallBlind, bigBlind, options] = MockPokerEngine.mock.calls[0];
    expect([smallBlind, bigBlind]).toEqual([5, 10]);
    expect(options).toEqual({ variant: 'omaha', bettingMode: 'pot-limit' });
    expect((global as any).roomConfigs.get('t1')).toMatchObject({ variant: 'omaha', smallBlind: 5, bigBlind: 10 });
  });

  it('cannot turn a fixed-game room into dealers choice from the request', async () => {
    mockGetRoomById.mockResolvedValue({ id: 't1', configuration: { variant: 'texas-holdem' }, blindLevels: {} });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a', variant: 'dealers-choice' }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    const [, , smallBlind, bigBlind, options] = MockPokerEngine.mock.calls[0];
    expect([smallBlind, bigBlind]).toEqual([1, 2]);
    expect(options.variant).toBe('texas-holdem');
    expect((global as any).roomConfigs.get('t1').mode).toBe('fixed');
  });

  it('returns 404 for a room that does not exist', async () => {
    mockGetRoomById.mockResolvedValue(null);
    const res = createRes();
    await handler(createReq({ tableId: 'missing', playerId: 'a' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(MockPokerEngine).not.toHaveBeenCalled();
  });

  it('refuses to start when the room settings cannot be loaded', async () => {
    mockGetRoomById.mockRejectedValue(new Error('connection refused'));
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a', variant: 'omaha', sb: 500, bb: 1000 }), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(MockPokerEngine).not.toHaveBeenCalled();
  });
});
