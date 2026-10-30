jest.mock('pg', () => ({ Pool: jest.fn() }));

jest.mock('../../../src/lib/realtime/publisher', () => ({
  publishGameStateUpdate: jest.fn().mockResolvedValue(undefined),
  publishAwaitingDealerChoice: jest.fn().mockResolvedValue(undefined),
  publishRebuyPrompt: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../../../src/lib/shared/rebuy-limit', () => ({
  fetchRoomRebuyLimit: jest.fn().mockResolvedValue('unlimited'),
  fetchRoomRebuyAmount: jest.fn().mockResolvedValue(100),
}));

jest.mock('../../../src/lib/shared/rebuy-tracker', () => ({
  getPlayerRebuyInfo: jest.fn().mockReturnValue(undefined),
}));

jest.mock('../../../src/lib/server/rebuy-state', () => ({
  clearPendingRebuy: jest.fn(),
  hasPendingRebuy: jest.fn().mockReturnValue(false),
  pendingRebuyCount: jest.fn().mockReturnValue(0),
  setPendingRebuy: jest.fn(),
}));

jest.mock('../../../src/lib/server/rebuy-actions', () => ({
  autoStandPlayer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/lib/poker/engine-persistence', () => ({
  ...jest.requireActual('../../../src/lib/poker/engine-persistence'),
  getOrRestoreEngine: jest.fn(),
  persistEngineState: jest.fn().mockResolvedValue('saved'),
}));

// Players who chose to leave after the hand
const mockStandUpLeavers = jest.fn().mockResolvedValue([]);
jest.mock('../../../src/lib/server/seat-actions', () => ({
  standUpPlayersLeavingAfterHand: (...args: any[]) => mockStandUpLeavers(...args),
}));

// Saved seats, which the route brings into the game before each hand
const mockLoadSeats = jest.fn().mockResolvedValue(null);
jest.mock('../../../src/lib/shared/game-seats', () => ({
  loadPersistedRoomSeats: (...args: any[]) => mockLoadSeats(...args),
  getRoomSeats: jest.fn(() => ({})),
}));

jest.mock('../../../src/lib/database/pool', () => ({
  getPool: jest.fn(() => ({})),
}));

// The room row the route rebuilds its config from when server memory has none
const mockGetRoomById = jest.fn().mockResolvedValue(null);
jest.mock('../../../src/lib/services/game-service', () => ({
  GameService: jest.fn().mockImplementation(() => ({ getRoomById: (...args: any[]) => mockGetRoomById(...args) })),
}));

// Simulate a signed-in caller whose session matches the playerId they send
const mockRequirePlayer = jest.fn(async (_req: any, _res: any, claimed?: unknown) => (claimed ? String(claimed) : 'a'));
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  requirePlayer: (...args: any[]) => mockRequirePlayer(...args),
}));

import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../../pages/api/games/next-hand';
import * as enginePersistence from '../../../src/lib/poker/engine-persistence';
import * as publisher from '../../../src/lib/realtime/publisher';

const mockGetOrRestoreEngine = enginePersistence.getOrRestoreEngine as jest.Mock;
const mockPersistEngineState = enginePersistence.persistEngineState as jest.Mock;
const mockPublishAwaitingDealerChoice = publisher.publishAwaitingDealerChoice as jest.Mock;
const mockPublishGameStateUpdate = publisher.publishGameStateUpdate as jest.Mock;

function createReq(body: any): NextApiRequest {
  return { method: 'POST', body, headers: {}, query: {} } as any;
}

function createRes(): NextApiResponse & { status: jest.Mock; json: jest.Mock } {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return res;
}

// With the button on index 0, player b is the dealer's-choice chooser.
// dealersChoiceHandCount is the number of hands started since the last variant choice.
function createEngine(stage: string, dealersChoiceHandCount = 0) {
  const state: any = {
    stage,
    dealerPosition: 0,
    dealersChoiceHandCount,
    players: [{ id: 'a', name: 'A', stack: 100 }, { id: 'b', name: 'B', stack: 100 }],
  };
  return {
    getState: jest.fn(() => ({ ...state })),
    setVariant: jest.fn(),
    setBettingMode: jest.fn(),
    startNewHand: jest.fn(),
    pauseForDealerChoice: jest.fn(() => {
      state.stage = 'awaiting-dealer-choice';
      return { ...state };
    }),
  };
}

function setRoomConfig(config: any) {
  (global as any).roomConfigs = new Map([['t1', config]]);
}

const DEALERS_CHOICE_CONFIG = {
  variant: 'dealers-choice',
  mode: 'dealers-choice',
  bettingMode: 'no-limit',
  chosenVariant: 'texas-holdem',
};

describe('/api/games/next-hand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).__NEXT_HAND_LOCKS__ = undefined;
  });

  it('rejects a caller who is not a player at the table', async () => {
    const engine = createEngine('showdown');
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    setRoomConfig({ variant: 'texas-holdem', mode: 'fixed' });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'outsider' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(engine.startNewHand).not.toHaveBeenCalled();
  });

  it('brings players who sat down between hands into the game before starting it', async () => {
    const engine: any = createEngine('showdown');
    engine.syncSeatedPlayers = jest.fn();
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    mockLoadSeats.mockResolvedValueOnce({
      1: { playerId: 'a', playerName: 'A', chips: 100 },
      2: null,
      4: { playerId: 'b', playerName: 'B', chips: 200 },
    });
    setRoomConfig({ variant: 'texas-holdem', mode: 'fixed' });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(engine.syncSeatedPlayers).toHaveBeenCalledWith([
      { id: 'a', name: 'A', seatNumber: 1, chips: 100 },
      { id: 'b', name: 'B', seatNumber: 4, chips: 200 },
    ]);
    expect(engine.syncSeatedPlayers.mock.invocationCallOrder[0]).toBeLessThan(engine.startNewHand.mock.invocationCallOrder[0]);
  });

  it('stands up players leaving after the hand before loading the game for the next one', async () => {
    const engine: any = createEngine('showdown');
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    setRoomConfig({ variant: 'texas-holdem', mode: 'fixed' });
    await handler(createReq({ tableId: 't1', playerId: 'a' }), createRes());
    expect(mockStandUpLeavers).toHaveBeenCalledWith('t1', expect.anything());
    expect(mockStandUpLeavers.mock.invocationCallOrder[0]).toBeLessThan(mockGetOrRestoreEngine.mock.invocationCallOrder[0]);
  });

  it('says who the table is waiting on to rebuy, with what their prompt shows', async () => {
    const engine = createEngine('showdown');
    engine.getState.mockReturnValue({
      stage: 'showdown',
      dealerPosition: 0,
      players: [{ id: 'a', name: 'A', stack: 200 }, { id: 'b', name: 'B', stack: 0 }],
    });
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    setRoomConfig({ variant: 'texas-holdem', mode: 'fixed' });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      awaitingRebuyDecisions: true,
      waitingFor: [expect.objectContaining({ playerId: 'b', playerName: 'B', baseChips: 100, remaining: 'unlimited' })],
    }));
    expect(publisher.publishRebuyPrompt).toHaveBeenCalledTimes(1);
    expect(engine.startNewHand).not.toHaveBeenCalled();
  });

  it('keeps listing a player who was already prompted, without prompting again', async () => {
    const rebuyState = jest.requireMock('../../../src/lib/server/rebuy-state');
    rebuyState.hasPendingRebuy.mockReturnValueOnce(true);
    rebuyState.pendingRebuyCount.mockReturnValueOnce(1).mockReturnValueOnce(1);
    const engine = createEngine('showdown');
    engine.getState.mockReturnValue({
      stage: 'showdown',
      dealerPosition: 0,
      players: [{ id: 'a', name: 'A', stack: 200 }, { id: 'b', name: 'B', stack: 0 }],
    });
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    setRoomConfig({ variant: 'texas-holdem', mode: 'fixed' });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'b' }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      awaitingRebuyDecisions: true,
      waitingFor: [expect.objectContaining({ playerId: 'b' })],
    }));
    expect(publisher.publishRebuyPrompt).not.toHaveBeenCalled();
  });

  it('starts the next hand for a player at the table', async () => {
    const engine = createEngine('showdown');
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    setRoomConfig({ variant: 'texas-holdem', mode: 'fixed' });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(engine.startNewHand).toHaveBeenCalled();
  });

  it('returns 409 without broadcasting when the new hand cannot be saved', async () => {
    const engine = createEngine('showdown');
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    mockPersistEngineState.mockResolvedValueOnce('conflict');
    setRoomConfig({ variant: 'texas-holdem', mode: 'fixed' });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockPublishGameStateUpdate).not.toHaveBeenCalled();
  });

  it("rejects a dealer's-choice variant from a player who is not the chooser", async () => {
    const engine = createEngine('awaiting-dealer-choice');
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    setRoomConfig({ ...DEALERS_CHOICE_CONFIG });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a', variant: 'omaha' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(engine.setVariant).not.toHaveBeenCalled();
    expect(engine.startNewHand).not.toHaveBeenCalled();
  });

  it("rejects a dealer's-choice variant when the game is not waiting for one", async () => {
    const engine = createEngine('showdown');
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    setRoomConfig({ ...DEALERS_CHOICE_CONFIG });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'b', variant: 'omaha' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(engine.setVariant).not.toHaveBeenCalled();
  });

  it("applies the chooser's variant and starts the hand", async () => {
    const engine = createEngine('awaiting-dealer-choice');
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    setRoomConfig({ ...DEALERS_CHOICE_CONFIG });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'b', variant: 'omaha' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(engine.setVariant).toHaveBeenCalledWith('omaha');
    expect(engine.startNewHand).toHaveBeenCalled();
  });

  it("plays a dealer's-choice razz hand with fixed-limit betting and 5-card Omaha with pot limit", async () => {
    for (const [variant, mode] of [['razz', 'fixed-limit'], ['omaha-5', 'pot-limit'], ['seven-card-stud', 'no-limit']] as const) {
      jest.clearAllMocks();
      (global as any).__NEXT_HAND_LOCKS__ = undefined;
      const engine = createEngine('awaiting-dealer-choice');
      mockGetOrRestoreEngine.mockResolvedValue(engine);
      setRoomConfig({ ...DEALERS_CHOICE_CONFIG });
      const res = createRes();
      await handler(createReq({ tableId: 't1', playerId: 'b', variant }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(engine.setVariant).toHaveBeenCalledWith(variant);
      expect(engine.setBettingMode).toHaveBeenCalledWith(mode);
    }
  });

  it('a mixed-game room just starts the next hand; the engine moves the rotation on', async () => {
    const engine = createEngine('showdown');
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    setRoomConfig({ variant: 'mixed', mode: 'fixed' });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(engine.startNewHand).toHaveBeenCalled();
    expect(engine.setVariant).not.toHaveBeenCalled();
    expect(engine.pauseForDealerChoice).not.toHaveBeenCalled();
  });

  it('starts another hand of the chosen game until the round is complete', async () => {
    // Two players: a round is three hands
    const engine = createEngine('showdown', 2);
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    setRoomConfig({ ...DEALERS_CHOICE_CONFIG });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(engine.startNewHand).toHaveBeenCalled();
    expect(engine.pauseForDealerChoice).not.toHaveBeenCalled();
  });

  it('ends the round using the saved hand count when server memory has no room config', async () => {
    // Another server instance played the round; this one rebuilds the config from the room row
    (global as any).roomConfigs = undefined;
    mockGetRoomById.mockResolvedValueOnce({ configuration: { variant: 'dealers-choice' }, blindLevels: { sb: 1, bb: 2 } });
    const engine = createEngine('showdown', 3);
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(engine.pauseForDealerChoice).toHaveBeenCalled();
    expect(engine.startNewHand).not.toHaveBeenCalled();
    expect(mockPublishAwaitingDealerChoice).toHaveBeenCalledWith('t1', expect.objectContaining({ dealerId: 'b' }));
  });

  it('persists the dealer-choice pause and announces the chooser', async () => {
    // Two players: the round is complete after three hands
    const engine = createEngine('showdown', 3);
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    setRoomConfig({ ...DEALERS_CHOICE_CONFIG });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a' }), res);
    expect(res.json).toHaveBeenCalledWith({ success: true, awaitingChoice: true });
    expect(engine.pauseForDealerChoice).toHaveBeenCalled();
    expect(mockPersistEngineState).toHaveBeenCalledWith('t1', engine);
    expect(mockPublishAwaitingDealerChoice).toHaveBeenCalledWith('t1', expect.objectContaining({ dealerId: 'b' }));
  });
});
