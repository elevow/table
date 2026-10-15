jest.mock('pg', () => ({ Pool: jest.fn() }));

jest.mock('../../../src/lib/realtime/publisher', () => ({
  publishGameStateUpdate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/lib/realtime/sequence', () => ({
  nextSeq: jest.fn().mockReturnValue(1),
}));

jest.mock('../../../src/lib/poker/run-it-twice-manager', () => ({
  enrichStateWithRunIt: jest.fn((_tableId: string, state: any) => state),
  maybeCreateRunItPrompt: jest.fn().mockReturnValue(null),
  isAutoRunoutEligible: jest.fn().mockReturnValue(false),
}));

jest.mock('../../../src/lib/poker/supabase-auto-runout', () => ({
  runSupabaseAutoRunoutSync: jest.fn().mockResolvedValue(true),
  clearSupabaseAutoRunout: jest.fn(),
}));

jest.mock('../../../src/lib/poker/state-sanitizer', () => ({
  sanitizeStateForBroadcast: jest.fn((state: any) => state),
  sanitizeStateForPlayer: jest.fn((state: any) => state),
}));

jest.mock('../../../src/lib/shared/feature-flags', () => ({
  RUN_IT_TWICE_DECISIONS_ENABLED: false,
}));

jest.mock('../../../src/lib/utils/post-hand-result', () => ({
  postHandResultToChat: jest.fn().mockResolvedValue(undefined),
}));

// Keep the real conflict error and response; mock only loading and saving
jest.mock('../../../src/lib/poker/engine-persistence', () => ({
  ...jest.requireActual('../../../src/lib/poker/engine-persistence'),
  getOrRestoreEngine: jest.fn(),
  persistEngineState: jest.fn(),
}));

// Simulate a signed-in caller whose session matches the playerId they send
const mockRequirePlayer = jest.fn(async (_req: any, _res: any, claimed?: unknown) => (claimed ? String(claimed) : 'a'));
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  requirePlayer: (...args: any[]) => mockRequirePlayer(...args),
}));

import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../../pages/api/games/action';
import * as enginePersistence from '../../../src/lib/poker/engine-persistence';
import * as publisher from '../../../src/lib/realtime/publisher';
import * as runItTwiceManager from '../../../src/lib/poker/run-it-twice-manager';
import * as autoRunout from '../../../src/lib/poker/supabase-auto-runout';

const { StaleGameStateError, STALE_STATE_RESPONSE } = enginePersistence;
const mockGetOrRestoreEngine = enginePersistence.getOrRestoreEngine as jest.Mock;
const mockPersistEngineState = enginePersistence.persistEngineState as jest.Mock;
const mockPublishGameStateUpdate = publisher.publishGameStateUpdate as jest.Mock;
const mockIsAutoRunoutEligible = runItTwiceManager.isAutoRunoutEligible as jest.Mock;
const mockRunAutoRunout = autoRunout.runSupabaseAutoRunoutSync as jest.Mock;

function createReq(body: any): NextApiRequest {
  return { method: 'POST', body, headers: {}, query: {} } as any;
}

function createRes(): NextApiResponse & { status: jest.Mock; json: jest.Mock } {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return res;
}

function createEngine() {
  const state: any = { stage: 'flop', communityCards: [], players: [{ id: 'a' }, { id: 'b' }], activePlayer: 'a' };
  return {
    getState: jest.fn(() => ({ ...state })),
    handleAction: jest.fn(),
    setRunItTwicePrompt: jest.fn(),
    setAutoRunoutProgress: jest.fn(),
  };
}

describe('/api/games/action saves', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAutoRunoutEligible.mockReturnValue(false);
  });

  it('applies, saves and broadcasts an action', async () => {
    const engine = createEngine();
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    mockPersistEngineState.mockResolvedValue('saved');
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a', action: 'check' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockPublishGameStateUpdate).toHaveBeenCalled();
  });

  it('returns 409 without broadcasting when another request saved first', async () => {
    const engine = createEngine();
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    mockPersistEngineState.mockResolvedValue('conflict');
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a', action: 'check' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(STALE_STATE_RESPONSE);
    expect(mockPublishGameStateUpdate).not.toHaveBeenCalled();
  });

  it('stops an auto-runout step whose save conflicts instead of broadcasting it', async () => {
    const engine = createEngine();
    mockGetOrRestoreEngine.mockResolvedValue(engine);
    mockIsAutoRunoutEligible.mockReturnValue(true);
    // The action and progress saves succeed; the first runout step's save conflicts
    mockPersistEngineState
      .mockResolvedValueOnce('saved')
      .mockResolvedValueOnce('saved')
      .mockResolvedValueOnce('conflict');
    let stepError: unknown;
    mockRunAutoRunout.mockImplementation(async (_tableId: string, _engine: any, step: any) => {
      try {
        await step(engine.getState(), { action: 'auto_runout_turn' });
      } catch (e) {
        stepError = e;
      }
      return false;
    });
    const res = createRes();
    await handler(createReq({ tableId: 't1', playerId: 'a', action: 'call' }), res);

    expect(stepError).toBeInstanceOf(StaleGameStateError);
    // Only the action's own state was broadcast, not the stale runout step
    expect(mockPublishGameStateUpdate).toHaveBeenCalledTimes(1);
    expect(mockPublishGameStateUpdate.mock.calls[0][1].lastAction).toMatchObject({ action: 'call' });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
