import type { NextApiRequest, NextApiResponse } from 'next';

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
});