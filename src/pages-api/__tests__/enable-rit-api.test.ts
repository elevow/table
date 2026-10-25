import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../../src/lib/server/hand-records', () => ({ finishHand: jest.fn().mockResolvedValue(undefined) }));

// The feature flag, switchable per test
let mockRitEnabled = true;
jest.mock('../../../src/lib/shared/feature-flags', () => ({
  get RUN_IT_TWICE_DECISIONS_ENABLED() { return mockRitEnabled; },
}));

jest.mock('../../../src/lib/poker/engine-persistence', () => ({
  getOrRestoreEngine: jest.fn(),
  persistEngineState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/lib/realtime/publisher', () => ({
  publishGameStateUpdate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/lib/realtime/sequence', () => ({
  nextSeq: jest.fn(() => 1),
}));

jest.mock('../../../src/lib/poker/supabase-auto-runout', () => ({
  clearSupabaseAutoRunout: jest.fn(),
  runSupabaseAutoRunoutSync: jest.fn(),
}));

// Simulate a signed-in caller whose session matches the playerId they send
const mockRequirePlayer = jest.fn(async (_req: any, _res: any, claimed?: unknown) => (claimed ? String(claimed) : 'player-1'));
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  requirePlayer: (...args: any[]) => mockRequirePlayer(...args),
}));

import handler from '../../../pages/api/games/enable-rit';
import { getOrRestoreEngine } from '../../../src/lib/poker/engine-persistence';

describe('/api/games/enable-rit', () => {
  afterEach(() => {
    jest.clearAllMocks();
    delete (global as any).runItTwiceState;
  });

  it('accepts a response using the prompt restored with the engine', async () => {
    const prompt = {
      playerId: 'player-1',
      reason: 'lowest-hand' as const,
      createdAt: Date.now(),
      boardCardsCount: 0,
      eligiblePlayerIds: ['player-1', 'player-2'],
    };
    const state: any = {
      tableId: 'table-1',
      stage: 'preflop',
      players: [
        { id: 'player-1', stack: 0, currentBet: 10, isAllIn: false, isFolded: false },
        { id: 'player-2', stack: 90, currentBet: 10, isAllIn: false, isFolded: false },
      ],
      activePlayer: 'player-1',
      pot: 20,
      communityCards: [],
      currentBet: 10,
      dealerPosition: 0,
      smallBlind: 5,
      bigBlind: 10,
      minRaise: 10,
      lastRaise: 0,
      runItTwicePrompt: prompt,
    };
    const engine = {
      getState: jest.fn(() => state),
      setRunItTwicePrompt: jest.fn((nextPrompt, disabled) => {
        state.runItTwicePrompt = nextPrompt;
        state.runItTwicePromptDisabled = disabled;
        state.activePlayer = '';
      }),
    };
    (getOrRestoreEngine as jest.Mock).mockResolvedValue(engine);
    (global as any).runItTwiceState = new Map([['table-1', { prompt: null, disabled: false }]]);

    const req = {
      method: 'POST',
      body: { tableId: 'table-1', playerId: 'player-1', runs: 1 },
    } as Partial<NextApiRequest>;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as Partial<NextApiResponse>;

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(engine.setRunItTwicePrompt).toHaveBeenCalledWith(null, true);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, runs: 1 }));
  });

  it('starts run it twice from the board shown when the decision was offered', async () => {
    const state: any = {
      tableId: 'table-1',
      stage: 'flop',
      players: [
        { id: 'player-1', isFolded: false },
        { id: 'player-2', isFolded: false },
      ],
      runItTwicePrompt: { playerId: 'player-1', boardCardsCount: 0 },
    };
    const engine = {
      getState: jest.fn(() => state),
      setRunItTwicePrompt: jest.fn(),
      startRunItTwice: jest.fn(),
    };
    (getOrRestoreEngine as jest.Mock).mockResolvedValue(engine);
    (global as any).runItTwiceState = new Map([['table-1', { prompt: null, disabled: false }]]);

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as Partial<NextApiResponse>;
    await handler({ method: 'POST', body: { tableId: 'table-1', playerId: 'player-1', runs: 2 } } as any, res as NextApiResponse);

    expect(engine.startRunItTwice).toHaveBeenCalledWith(2, 0);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('refuses more runs than there are cards for', async () => {
    const state: any = {
      tableId: 'table-1',
      stage: 'preflop',
      players: [{ id: 'player-1', isFolded: false }, { id: 'player-2', isFolded: false }],
      runItTwicePrompt: { playerId: 'player-1', boardCardsCount: 0 },
    };
    const engine = {
      getState: jest.fn(() => state),
      setRunItTwicePrompt: jest.fn(),
      startRunItTwice: jest.fn(() => { throw new Error('Not enough cards left to run it that many times'); }),
    };
    (getOrRestoreEngine as jest.Mock).mockResolvedValue(engine);
    (global as any).runItTwiceState = new Map([['table-1', { prompt: null, disabled: false }]]);

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as Partial<NextApiResponse>;
    await handler({ method: 'POST', body: { tableId: 'table-1', playerId: 'player-1', runs: 2 } } as any, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(engine.setRunItTwicePrompt).not.toHaveBeenCalled();
  });

  it('rejects multi-run requests while Run-It-Twice decisions are disabled', async () => {
    mockRitEnabled = false;
    const state: any = {
      tableId: 'table-1',
      stage: 'preflop',
      players: [
        { id: 'player-1', isFolded: false },
        { id: 'player-2', isFolded: false },
      ],
      runItTwicePrompt: { playerId: 'player-1' },
    };
    const engine = {
      getState: jest.fn(() => state),
      setRunItTwicePrompt: jest.fn(),
      enableRunItTwice: jest.fn(),
    };
    (getOrRestoreEngine as jest.Mock).mockResolvedValue(engine);
    (global as any).runItTwiceState = new Map([['table-1', { prompt: null, disabled: false }]]);

    const req = {
      method: 'POST',
      body: { tableId: 'table-1', playerId: 'player-1', runs: 2 },
    } as Partial<NextApiRequest>;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as Partial<NextApiResponse>;

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Run-It-Twice is temporarily disabled' });
    expect(engine.enableRunItTwice).not.toHaveBeenCalled();
    mockRitEnabled = true;
  });
});