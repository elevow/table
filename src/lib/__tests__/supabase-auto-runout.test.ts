import { TableState, Player, Card } from '../../types/poker';
import { clearSupabaseAutoRunout, scheduleSupabaseAutoRunout } from '../poker/supabase-auto-runout';

describe('supabase-auto-runout', () => {
  const tableId = 'supabase-auto-runout-test';

  const makePlayer = (overrides: Partial<Player> = {}): Player => ({
    id: 'player',
    name: 'Player',
    position: 0,
    stack: 1_000,
    holeCards: [
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'clubs' },
    ],
    currentBet: 100,
    hasActed: true,
    isFolded: false,
    isAllIn: true,
    timeBank: 30_000,
    ...overrides,
  });

  const makeState = (overrides: Partial<TableState> = {}): TableState => ({
    tableId,
    stage: 'turn',
    players: [
      makePlayer({ id: 'p1' }),
      makePlayer({ id: 'p2', position: 1 }),
    ],
    activePlayer: 'p1',
    pot: 500,
    communityCards: [
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'diamonds' },
      { rank: 'Q', suit: 'clubs' },
    ],
    currentBet: 100,
    dealerPosition: 0,
    smallBlind: 5,
    bigBlind: 10,
    minRaise: 10,
    lastRaise: 0,
    variant: 'texas-holdem',
    runItTwice: { enabled: true, numberOfRuns: 2, boards: [], results: [], potDistribution: [], seeds: [] },
    runItTwicePrompt: null,
    ...overrides,
  });

  const makeEngine = (state: TableState) => {
    const upcoming: Record<'flop' | 'turn' | 'river', Card[]> = {
      flop: [
        { rank: '2', suit: 'hearts' },
        { rank: '3', suit: 'hearts' },
        { rank: '4', suit: 'hearts' },
      ],
      turn: [{ rank: '2', suit: 'clubs' }],
      river: [{ rank: '8', suit: 'clubs' }],
    };

    return {
      getState: jest.fn(() => state),
      previewRabbitHunt: jest.fn((street: 'flop' | 'turn' | 'river') => ({ cards: upcoming[street] })),
      runItTwiceNow: jest.fn(() => {
        state.stage = 'showdown';
      }),
      finalizeToShowdown: jest.fn(() => {
        state.stage = 'showdown';
      }),
      prepareRabbitPreview: jest.fn(),
    };
  };

  beforeEach(() => {
    clearSupabaseAutoRunout(tableId);
    jest.useFakeTimers();
  });

  afterEach(() => {
    clearSupabaseAutoRunout(tableId);
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('declines to schedule when the table state is not eligible', () => {
    const state = makeState();
    state.players[0].isAllIn = false;
    const engine = { getState: jest.fn(() => state) } as any;
    const broadcast = jest.fn().mockResolvedValue(undefined);

    const scheduled = scheduleSupabaseAutoRunout(tableId, engine, broadcast);
    expect(scheduled).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('reveals pending streets on a 5 second cadence and finalizes the hand', async () => {
    const state = makeState();
    const engine = makeEngine(state);
    const broadcast = jest.fn().mockResolvedValue(undefined);

    const scheduled = scheduleSupabaseAutoRunout(tableId, engine as any, broadcast);
    expect(scheduled).toBe(true);
    expect(engine.prepareRabbitPreview).toHaveBeenCalledTimes(1);
    const prepArgs = engine.prepareRabbitPreview.mock.calls[0][0];
    expect(prepArgs?.community).toEqual(state.communityCards);
    expect(prepArgs?.known).toEqual(expect.arrayContaining(state.players.flatMap((p) => p.holeCards || [])));

    await jest.advanceTimersByTimeAsync(5000);
    expect(broadcast).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ stage: 'turn', communityCards: expect.arrayContaining([{ rank: '2', suit: 'clubs' }]) }),
      { action: 'auto_runout_turn' },
    );
    expect(state.communityCards).toHaveLength(3);

    await jest.advanceTimersByTimeAsync(5000);
    expect(broadcast).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ stage: 'river', communityCards: expect.arrayContaining([{ rank: '8', suit: 'clubs' }]) }),
      { action: 'auto_runout_river' },
    );
    expect(state.communityCards).toHaveLength(3);

    await jest.advanceTimersByTimeAsync(5000);
    expect(engine.runItTwiceNow).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: 'showdown' }),
      { action: 'auto_runout_showdown' },
    );
  });

  it('clears all timers when clearSupabaseAutoRunout is invoked', async () => {
    const state = makeState();
    const engine = makeEngine(state);
    const broadcast = jest.fn().mockResolvedValue(undefined);

    const scheduled = scheduleSupabaseAutoRunout(tableId, engine as any, broadcast);
    expect(scheduled).toBe(true);

    clearSupabaseAutoRunout(tableId);
    await jest.advanceTimersByTimeAsync(15000);

    expect(broadcast).not.toHaveBeenCalled();
    expect(engine.previewRabbitHunt).not.toHaveBeenCalled();
    expect(engine.prepareRabbitPreview).toHaveBeenCalledTimes(1);
  });
});
