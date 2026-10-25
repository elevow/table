jest.mock('../../poker/run-it-twice-manager', () => ({
  disableRunItPrompt: jest.fn(),
  enrichStateWithRunIt: jest.fn((_tableId: string, state: any) => ({ ...state, enriched: true })),
  isAutoRunoutEligible: jest.fn(() => false),
}));
jest.mock('../../poker/supabase-auto-runout', () => ({
  clearSupabaseAutoRunout: jest.fn(),
  runSupabaseAutoRunoutSync: jest.fn(),
}));
jest.mock('../../poker/engine-persistence', () => {
  class StaleGameStateError extends Error {}
  return { persistEngineState: jest.fn(), StaleGameStateError };
});
jest.mock('../../poker/state-sanitizer', () => ({
  sanitizeStateForBroadcast: jest.fn((state: any) => state),
}));
jest.mock('../hand-records', () => ({ finishHand: jest.fn() }));
jest.mock('../game-action-pipeline', () => ({
  broadcastGameState: jest.fn(async (_tableId: string, _res: any, state: any) => state),
  getIo: jest.fn(),
}));

import { disableRunItPrompt, isAutoRunoutEligible } from '../../poker/run-it-twice-manager';
import { clearSupabaseAutoRunout, runSupabaseAutoRunoutSync } from '../../poker/supabase-auto-runout';
import { persistEngineState, StaleGameStateError } from '../../poker/engine-persistence';
import { finishHand } from '../hand-records';
import { broadcastGameState, getIo } from '../game-action-pipeline';
import { resolveRunItTwiceDecision } from '../run-it-twice-decision';

const makeEngine = (stateOverrides: Record<string, unknown> = {}, engineStateOverrides: Record<string, unknown> = {}) => {
  const state: any = {
    stage: 'flop',
    runItTwicePrompt: { playerId: 'p1', boardCardsCount: 3 },
    players: [
      { id: 'p1', holeCards: [] },
      { id: 'p2', holeCards: [{ rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'hearts' }] },
      { id: 'p3' },
    ],
    ...stateOverrides,
  };
  const engineState: any = {
    ...state,
    players: [
      { id: 'p1', holeCards: [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' }] },
      { id: 'p2', holeCards: [{ rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'hearts' }] },
    ],
    ...engineStateOverrides,
  };
  let calls = 0;
  return {
    // The first read is the state the decision was made on; later reads see the engine's cards
    getState: jest.fn(() => (calls++ === 0 ? state : engineState)),
    setRunItTwicePrompt: jest.fn(),
    startRunItTwice: jest.fn(),
  } as any;
};

const run = (engine: any, runs: number, reason?: string) =>
  resolveRunItTwiceDecision({ tableId: 't1', engine, res: {} as any, playerId: 'p1', runs, reason });

describe('resolveRunItTwiceDecision', () => {
  const emit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (persistEngineState as jest.Mock).mockResolvedValue('ok');
    (getIo as jest.Mock).mockReturnValue({ to: jest.fn(() => ({ emit })) });
    (isAutoRunoutEligible as jest.Mock).mockReturnValue(false);
    delete process.env.AUTO_RUNOUT_DEBUG;
  });

  it('declines: clears the prompt, reveals every hand and broadcasts', async () => {
    const engine = makeEngine();
    const result = await run(engine, 1);

    expect(clearSupabaseAutoRunout).toHaveBeenCalledWith('t1');
    expect(disableRunItPrompt).toHaveBeenCalledWith('t1', true);
    expect(engine.setRunItTwicePrompt).toHaveBeenCalledWith(null, true);
    expect(engine.startRunItTwice).not.toHaveBeenCalled();
    const [, , broadcastState, lastAction] = (broadcastGameState as jest.Mock).mock.calls[0];
    expect(lastAction).toEqual({ action: 'run_it_twice_declined', playerId: 'p1', runs: 1 });
    expect(broadcastState.runItTwicePrompt).toBeNull();
    expect(broadcastState.players[0].holeCards).toHaveLength(2);
    expect(broadcastState.players[2]).toEqual({ id: 'p3' });
    expect(emit).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'ok', state: { enriched: true } });
  });

  it('accepts: deals the runs from the board players saw and announces it', async () => {
    process.env.AUTO_RUNOUT_DEBUG = '1';
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const engine = makeEngine();
    await run(engine, 2, 'timeout');

    expect(engine.startRunItTwice).toHaveBeenCalledWith(2, 3);
    const [, , , lastAction] = (broadcastGameState as jest.Mock).mock.calls[0];
    expect(lastAction).toEqual({ action: 'run_it_twice_enabled', playerId: 'p1', runs: 2, reason: 'timeout' });
    expect(emit).toHaveBeenCalledWith('rit_enabled', expect.objectContaining({ tableId: 't1', runs: 2 }));
    expect(log).toHaveBeenCalled();

    log.mockClear();
    await run(makeEngine(), 1);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('passes no board count when the prompt has none', async () => {
    const engine = makeEngine({ runItTwicePrompt: null });
    await run(engine, 3);
    expect(engine.startRunItTwice).toHaveBeenCalledWith(3, undefined);
  });

  it('rejects a run count the engine refuses', async () => {
    const engine = makeEngine();
    engine.startRunItTwice.mockImplementationOnce(() => { throw new Error('Too many runs'); });
    await expect(run(engine, 9)).resolves.toEqual({ status: 'rejected', error: 'Too many runs' });

    engine.startRunItTwice.mockImplementationOnce(() => { throw {}; });
    await expect(run(makeEngine(), 9).then(() => run(engine, 9))).resolves.toEqual({
      status: 'rejected', error: 'Cannot run it that many times',
    });
    expect(persistEngineState).toHaveBeenCalledTimes(1);
  });

  it('reports a conflict when another request saved first', async () => {
    (persistEngineState as jest.Mock).mockResolvedValueOnce('conflict');
    await expect(run(makeEngine(), 2)).resolves.toEqual({ status: 'conflict' });
    expect(broadcastGameState).not.toHaveBeenCalled();
  });

  it('keeps going when the socket emit fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (getIo as jest.Mock).mockImplementation(() => { throw new Error('no io'); });
    await expect(run(makeEngine(), 2)).resolves.toMatchObject({ status: 'ok' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('leaves state alone when the engine cannot be read or has no players', async () => {
    const engine = makeEngine();
    engine.getState.mockReturnValueOnce(engine.getState()).mockReturnValueOnce(undefined);
    await run(engine, 1);
    expect((broadcastGameState as jest.Mock).mock.calls[0][2].players[0].holeCards).toEqual([]);

    (broadcastGameState as jest.Mock).mockClear();
    const noPlayers = makeEngine({ players: undefined }, { players: undefined });
    await run(noPlayers, 1);
    expect((broadcastGameState as jest.Mock).mock.calls[0][2].players).toBeUndefined();

    (broadcastGameState as jest.Mock).mockClear();
    const throwing = makeEngine();
    throwing.getState.mockReturnValueOnce(throwing.getState()).mockImplementationOnce(() => { throw new Error('boom'); });
    await run(throwing, 1);
    expect((broadcastGameState as jest.Mock).mock.calls[0][2].players[0].holeCards).toEqual([]);
  });

  it('runs the board out, saving each step and finishing the hand once', async () => {
    (isAutoRunoutEligible as jest.Mock).mockReturnValue(true);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (finishHand as jest.Mock).mockRejectedValueOnce(new Error('chat down'));
    (runSupabaseAutoRunoutSync as jest.Mock).mockImplementation(async (_t: string, _e: any, onStep: any) => {
      await onStep({ stage: 'turn' }, { action: 'deal' });
      await onStep({ stage: 'showdown' }, { action: 'showdown' });
      await onStep({ stage: 'showdown' }, { action: 'showdown' });
    });
    await run(makeEngine(), 2);
    expect(broadcastGameState).toHaveBeenCalledTimes(4);
    expect(finishHand).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stops the runout when another request replaced the game', async () => {
    (isAutoRunoutEligible as jest.Mock).mockReturnValue(true);
    (persistEngineState as jest.Mock).mockResolvedValueOnce('ok').mockResolvedValueOnce('conflict');
    let thrown: unknown;
    (runSupabaseAutoRunoutSync as jest.Mock).mockImplementation(async (_t: string, _e: any, onStep: any) => {
      try { await onStep({ stage: 'turn' }, {}); } catch (e) { thrown = e; }
    });
    await run(makeEngine(), 2);
    expect(thrown).toBeInstanceOf(StaleGameStateError);
    expect(broadcastGameState).toHaveBeenCalledTimes(1);
  });
});
