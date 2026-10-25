jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('../../../src/lib/poker/engine-persistence', () => ({
  persistEngineState: jest.fn().mockResolvedValue('saved'),
  StaleGameStateError: class extends Error {},
}));
jest.mock('../../../src/lib/realtime/publisher', () => ({ publishGameStateUpdate: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../src/lib/realtime/sequence', () => ({ nextSeq: jest.fn(() => 1) }));
jest.mock('../../../src/lib/poker/supabase-auto-runout', () => ({
  clearSupabaseAutoRunout: jest.fn(),
  runSupabaseAutoRunoutSync: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../src/lib/server/hand-records', () => ({ finishHand: jest.fn().mockResolvedValue(undefined) }));

import { PokerEngine } from '../../../src/lib/poker/poker-engine';
import { runGameAction } from '../../../src/lib/server/game-action-pipeline';
import { runSupabaseAutoRunoutSync } from '../../../src/lib/poker/supabase-auto-runout';

const mk = (id: string, position: number): any => ({
  id, name: id, position, stack: 100, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

/** Heads-up: the first player shoves, the second calls. Returns the engine after the call. */
async function allIn(allowRunItTwice: boolean) {
  const engine = new PokerEngine(`t-${allowRunItTwice}`, [mk('a', 1), mk('b', 2)], 1, 2);
  engine.setAllowRunItTwice(allowRunItTwice);
  engine.startNewHand();
  const res: any = {};
  const step = (type: 'raise' | 'call', amount?: number) => {
    const s = engine.getState();
    return runGameAction({
      tableId: s.tableId,
      engine,
      res,
      apply: () => engine.handleAction({ type, amount, playerId: s.activePlayer, tableId: s.tableId, timestamp: 0 }),
      lastAction: { action: type },
    });
  };
  await step('raise', 100);
  await step('call');
  return engine;
}

afterEach(() => {
  jest.clearAllMocks();
  delete (global as any).runItTwiceState;
});

describe('run it twice as a table option', () => {
  it('offers the decision after an all-in at a table that allows it', async () => {
    const engine = await allIn(true);
    expect(engine.getState().runItTwicePrompt).toBeTruthy();
    // The board waits for the decision
    expect(runSupabaseAutoRunoutSync).not.toHaveBeenCalled();
  });

  it('runs the board out straight away at a table that does not', async () => {
    const engine = await allIn(false);
    expect(engine.getState().runItTwicePrompt).toBeFalsy();
    expect(runSupabaseAutoRunoutSync).toHaveBeenCalled();
  });
});
