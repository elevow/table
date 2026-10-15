jest.mock('pg', () => ({ Pool: jest.fn() }));

jest.mock('../../../src/lib/realtime/publisher', () => ({
  publishRebuyResult: jest.fn().mockResolvedValue(undefined),
  publishSeatState: jest.fn().mockResolvedValue(undefined),
  publishSeatVacated: jest.fn().mockResolvedValue(undefined),
  publishGameStateUpdate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/lib/server/rebuy-state', () => ({
  BASE_REBUY_CHIPS: 20,
  clearPendingRebuy: jest.fn(),
  getRebuyAvailability: jest.fn().mockResolvedValue({ canRebuy: true, rebuysUsed: 0, rebuyLimit: 'unlimited', remaining: 'unlimited' }),
  pendingRebuyCount: jest.fn().mockReturnValue(1),
}));

jest.mock('../../../src/lib/shared/rebuy-limit', () => ({
  fetchRoomRebuyAmount: jest.fn().mockResolvedValue(100),
}));

jest.mock('../../../src/lib/shared/rebuy-tracker', () => ({
  recordBuyin: jest.fn().mockReturnValue({ rebuys: 1 }),
}));

jest.mock('../../../src/lib/shared/game-seats', () => ({
  getRoomSeats: jest.fn().mockReturnValue({}),
  setRoomSeats: jest.fn(),
  loadPersistedRoomSeats: jest.fn().mockResolvedValue(null),
  persistRoomSeats: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/lib/realtime/sequence', () => ({
  nextSeq: jest.fn().mockReturnValue(1),
}));

jest.mock('../../../src/lib/poker/run-it-twice-manager', () => ({
  clearRunItState: jest.fn(),
  enrichStateWithRunIt: jest.fn((_tableId: string, state: any) => state),
}));

jest.mock('../../../src/lib/poker/engine-persistence', () => ({
  ...jest.requireActual('../../../src/lib/poker/engine-persistence'),
  getOrRestoreEngine: jest.fn(),
  persistEngineState: jest.fn().mockResolvedValue('saved'),
}));

// Simulate a signed-in caller whose session matches the playerId they send
const mockRequirePlayer = jest.fn(async (_req: any, _res: any, claimed?: unknown) => (claimed ? String(claimed) : 'a'));
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  requirePlayer: (...args: any[]) => mockRequirePlayer(...args),
}));

import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../../pages/api/games/rebuy-decision';
import * as enginePersistence from '../../../src/lib/poker/engine-persistence';
import * as rebuyTracker from '../../../src/lib/shared/rebuy-tracker';

const mockGetOrRestoreEngine = enginePersistence.getOrRestoreEngine as jest.Mock;
const mockPersistEngineState = enginePersistence.persistEngineState as jest.Mock;
const mockRecordBuyin = rebuyTracker.recordBuyin as jest.Mock;

function createReq(body: any): NextApiRequest {
  return { method: 'POST', body, headers: {}, query: {} } as any;
}

function createRes(): NextApiResponse & { status: jest.Mock; json: jest.Mock } {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return res;
}

function createEngine(stage: string, stacks: Record<string, number>, folded: string[] = []) {
  const state: any = {
    stage,
    players: Object.entries(stacks).map(([id, stack]) => ({ id, stack, isFolded: folded.includes(id), currentBet: 0 })),
  };
  return { state, getState: jest.fn(() => ({ ...state })), startNewHand: jest.fn() };
}

const stackOf = (engine: ReturnType<typeof createEngine>, id: string) =>
  engine.state.players.find((p: any) => p.id === id).stack;

describe('/api/games/rebuy-decision', () => {
  beforeEach(() => jest.clearAllMocks());

  it('gives a busted player a rebuy after the hand is over', async () => {
    const engine = createEngine('showdown', { a: 0, b: 300 });
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a', decision: 'yes' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(stackOf(engine, 'a')).toBe(100);
    expect(mockRecordBuyin).toHaveBeenCalledWith('t1', 'a');
  });

  it('does not count a rebuy whose save conflicts with another request', async () => {
    mockGetOrRestoreEngine.mockResolvedValue(createEngine('showdown', { a: 0, b: 300 }));
    mockPersistEngineState.mockResolvedValueOnce('conflict');
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a', decision: 'yes' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockRecordBuyin).not.toHaveBeenCalled();
  });

  it('refuses a rebuy during a hand, even for a player who folded', async () => {
    const engine = createEngine('turn', { a: 0, b: 300, c: 200 }, ['a']);
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a', decision: 'yes' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(engine.state.players.find((p: any) => p.id === 'a')).toMatchObject({ stack: 0, isFolded: true });
    expect(mockRecordBuyin).not.toHaveBeenCalled();
  });

  it('refuses a rebuy for a player who still has chips', async () => {
    const engine = createEngine('showdown', { a: 40, b: 300 });
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a', decision: 'yes' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(stackOf(engine, 'a')).toBe(40);
    expect(mockRecordBuyin).not.toHaveBeenCalled();
  });

  it('refuses a rebuy for a player who is not in the game', async () => {
    mockGetOrRestoreEngine.mockResolvedValue(createEngine('showdown', { a: 0, b: 300 }));
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'z', decision: 'yes' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockRecordBuyin).not.toHaveBeenCalled();
  });

  it('refuses a rebuy when there is no game', async () => {
    mockGetOrRestoreEngine.mockResolvedValue(null);
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a', decision: 'yes' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockRecordBuyin).not.toHaveBeenCalled();
  });

  it('refuses a second rebuy once the first has restored the stack', async () => {
    const engine = createEngine('showdown', { a: 0, b: 300 });
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    await handler(createReq({ tableId: 't1', playerId: 'a', decision: 'yes' }), createRes());
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a', decision: 'yes' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockRecordBuyin).toHaveBeenCalledTimes(1);
  });
});
