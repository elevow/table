// Mock pg module to avoid TextEncoder issues in jsdom
jest.mock('pg', () => ({
  Pool: jest.fn(),
}));

// Mock supabase and publisher before any imports that transitively load them
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    channel: jest.fn(() => ({ send: jest.fn().mockResolvedValue(undefined) })),
  })),
}));

jest.mock('../../../src/lib/realtime/publisher', () => ({
  publishGameStateUpdate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/lib/poker/engine-persistence', () => ({
  getOrRestoreEngine: jest.fn(),
  persistEngineState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/lib/poker/run-it-twice-manager', () => ({
  clearRunItState: jest.fn(),
  enrichStateWithRunIt: jest.fn((_tableId: string, state: any) => state),
}));

jest.mock('../../../src/lib/poker/state-sanitizer', () => ({
  sanitizeStateForBroadcast: jest.fn((state: any) => state),
  sanitizeStateForPlayer: jest.fn((state: any, _playerId: string) => state),
}));

jest.mock('../../../src/lib/realtime/sequence', () => ({
  nextSeq: jest.fn().mockReturnValue(1),
}));

jest.mock('../../../src/lib/game/variant-mapping', () => ({
  defaultBettingModeForVariant: jest.fn().mockReturnValue('no-limit'),
}));

import { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../../pages/api/games/choose-variant';
import * as enginePersistence from '../../../src/lib/poker/engine-persistence';
import * as publisher from '../../../src/lib/realtime/publisher';
import * as runItTwiceManager from '../../../src/lib/poker/run-it-twice-manager';
import * as stateSanitizer from '../../../src/lib/poker/state-sanitizer';

const mockGetOrRestoreEngine = enginePersistence.getOrRestoreEngine as jest.Mock;
const mockPersistEngineState = enginePersistence.persistEngineState as jest.Mock;
const mockPublishGameStateUpdate = publisher.publishGameStateUpdate as jest.Mock;
const mockClearRunItState = runItTwiceManager.clearRunItState as jest.Mock;
const mockEnrichStateWithRunIt = runItTwiceManager.enrichStateWithRunIt as jest.Mock;
const mockSanitizeStateForPlayer = stateSanitizer.sanitizeStateForPlayer as jest.Mock;

function createReq(method: string, body?: any): Partial<NextApiRequest> {
  return { method, body } as any;
}

function createRes(): { status: jest.Mock; json: jest.Mock } & Partial<NextApiResponse> {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return res;
}

const AWAITING_STATE = {
  stage: 'awaiting-dealer-choice',
  players: [],
  pot: 0,
  communityCards: [],
  dealerPosition: 0,
  activePlayer: '',
};

const PREFLOP_STATE = {
  stage: 'preflop',
  players: [{ id: 'p1', holeCards: [{ rank: 'A', suit: 'spades' }] }],
  pot: 0,
  communityCards: [],
  dealerPosition: 0,
  activePlayer: 'p1',
};

describe('/api/games/choose-variant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPersistEngineState.mockResolvedValue(undefined);
    mockPublishGameStateUpdate.mockResolvedValue(undefined);
    mockEnrichStateWithRunIt.mockImplementation((_tableId: string, state: any) => state);
    // Reset global room configs
    (global as any).roomConfigs = undefined;
  });

  it('should return 405 for non-POST requests', async () => {
    const req = createReq('GET');
    const res = createRes();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
  });

  it('should return 400 when tableId is missing', async () => {
    const req = createReq('POST', { playerId: 'p1', variant: 'texas-holdem' });
    const res = createRes();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing tableId or playerId' });
  });

  it('should return 400 when playerId is missing', async () => {
    const req = createReq('POST', { tableId: 'table-1', variant: 'texas-holdem' });
    const res = createRes();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing tableId or playerId' });
  });

  it('should return 400 for an invalid variant', async () => {
    const req = createReq('POST', { tableId: 'table-1', playerId: 'p1', variant: 'fake-game' });
    const res = createRes();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Invalid variant') })
    );
  });

  it('should return 400 when variant is missing', async () => {
    const req = createReq('POST', { tableId: 'table-1', playerId: 'p1' });
    const res = createRes();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Invalid variant') })
    );
  });

  it('should return 404 when no active game is found', async () => {
    mockGetOrRestoreEngine.mockResolvedValue(null);
    const req = createReq('POST', { tableId: 'table-1', playerId: 'p1', variant: 'texas-holdem' });
    const res = createRes();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'No active game found for this table' });
  });

  it('should return 404 when engine lacks getState', async () => {
    mockGetOrRestoreEngine.mockResolvedValue({});
    const req = createReq('POST', { tableId: 'table-1', playerId: 'p1', variant: 'texas-holdem' });
    const res = createRes();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'No active game found for this table' });
  });

  it('should return 409 when stage is not awaiting-dealer-choice', async () => {
    const engine = { getState: jest.fn().mockReturnValue(PREFLOP_STATE) };
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    const req = createReq('POST', { tableId: 'table-1', playerId: 'p1', variant: 'texas-holdem' });
    const res = createRes();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Game is not waiting for a dealer variant choice' })
    );
  });

  it('should apply variant, start hand, persist, broadcast and return 200', async () => {
    const engine = {
      getState: jest.fn()
        .mockReturnValueOnce(AWAITING_STATE)  // initial check
        .mockReturnValueOnce(PREFLOP_STATE),  // after startNewHand
      setVariant: jest.fn(),
      setBettingMode: jest.fn(),
      startNewHand: jest.fn(),
    };
    mockGetOrRestoreEngine.mockResolvedValue(engine);

    const req = createReq('POST', { tableId: 'table-1', playerId: 'p1', variant: 'omaha' });
    const res = createRes();
    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(engine.setVariant).toHaveBeenCalledWith('omaha');
    expect(engine.setBettingMode).toHaveBeenCalledWith('no-limit');
    expect(mockClearRunItState).toHaveBeenCalledWith('table-1');
    expect(engine.startNewHand).toHaveBeenCalled();
    expect(mockPersistEngineState).toHaveBeenCalledWith('table-1', engine);
    expect(mockPublishGameStateUpdate).toHaveBeenCalled();
    expect(mockSanitizeStateForPlayer).toHaveBeenCalledWith(PREFLOP_STATE, 'p1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, gameState: PREFLOP_STATE });
  });

  it('should succeed even when Supabase publish fails', async () => {
    const engine = {
      getState: jest.fn()
        .mockReturnValueOnce(AWAITING_STATE)
        .mockReturnValueOnce(PREFLOP_STATE),
      setVariant: jest.fn(),
      setBettingMode: jest.fn(),
      startNewHand: jest.fn(),
    };
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    mockPublishGameStateUpdate.mockRejectedValue(new Error('Supabase unavailable'));

    const req = createReq('POST', { tableId: 'table-1', playerId: 'p1', variant: 'texas-holdem' });
    const res = createRes();
    await handler(req as NextApiRequest, res as NextApiResponse);

    // Hand was started and state was persisted despite publish failure
    expect(engine.startNewHand).toHaveBeenCalled();
    expect(mockPersistEngineState).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, gameState: PREFLOP_STATE });
  });

  it('should update roomConfigs when present in global', async () => {
    const engine = {
      getState: jest.fn()
        .mockReturnValueOnce(AWAITING_STATE)
        .mockReturnValueOnce(PREFLOP_STATE),
      setVariant: jest.fn(),
      setBettingMode: jest.fn(),
      startNewHand: jest.fn(),
    };
    mockGetOrRestoreEngine.mockResolvedValue(engine);

    const roomConfig = { chosenVariant: 'texas-holdem', dcStepCount: 2 };
    const roomConfigs = new Map([['table-1', roomConfig]]);
    (global as any).roomConfigs = roomConfigs;

    const req = createReq('POST', { tableId: 'table-1', playerId: 'p1', variant: 'five-card-stud' });
    const res = createRes();
    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(roomConfig.chosenVariant).toBe('five-card-stud');
    expect(roomConfig.dcStepCount).toBe(0);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should return 500 on unexpected error', async () => {
    mockGetOrRestoreEngine.mockRejectedValue(new Error('DB crash'));
    const req = createReq('POST', { tableId: 'table-1', playerId: 'p1', variant: 'texas-holdem' });
    const res = createRes();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'DB crash' });
  });

  it('should return 500 with generic message for non-Error exceptions', async () => {
    mockGetOrRestoreEngine.mockRejectedValue('plain string error');
    const req = createReq('POST', { tableId: 'table-1', playerId: 'p1', variant: 'texas-holdem' });
    const res = createRes();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });
});
