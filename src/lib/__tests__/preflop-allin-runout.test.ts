import { TableState, Player, Card } from '../../types/poker';
import { scheduleSupabaseAutoRunout, clearSupabaseAutoRunout } from '../poker/supabase-auto-runout';

describe('Preflop all-in auto-runout', () => {
  const tableId = 'preflop-allin-test';

  const makePlayer = (overrides: Partial<Player> = {}): Player => ({
    id: 'player',
    name: 'Player',
    position: 0,
    stack: 0,
    holeCards: [
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'clubs' },
    ],
    currentBet: 1000,
    hasActed: true,
    isFolded: false,
    isAllIn: true,
    timeBank: 30_000,
    ...overrides,
  });

  const makePreflopState = (overrides: Partial<TableState> = {}): TableState => ({
    tableId,
    stage: 'preflop',
    players: [
      makePlayer({ id: 'p1', position: 0 }),
      makePlayer({ id: 'p2', position: 1 }),
    ],
    activePlayer: '',
    pot: 2000,
    communityCards: [], // No community cards at preflop
    currentBet: 1000,
    dealerPosition: 0,
    smallBlind: 5,
    bigBlind: 10,
    minRaise: 10,
    lastRaise: 0,
    variant: 'texas-holdem',
    ...overrides,
  });

  const makeEngine = (state: TableState) => {
    const upcoming: Record<'flop' | 'turn' | 'river', Card[]> = {
      flop: [
        { rank: '2', suit: 'hearts' },
        { rank: '3', suit: 'hearts' },
        { rank: '4', suit: 'hearts' },
      ],
      turn: [{ rank: '5', suit: 'clubs' }],
      river: [{ rank: '8', suit: 'diamonds' }],
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

  it('reveals flop, turn, and river when all-in is called preflop', async () => {
    const state = makePreflopState();
    const engine = makeEngine(state);
    const broadcast = jest.fn().mockResolvedValue(undefined);

    const scheduled = scheduleSupabaseAutoRunout(tableId, engine as any, broadcast);
    expect(scheduled).toBe(true);

    // Verify that prepareRabbitPreview was called
    expect(engine.prepareRabbitPreview).toHaveBeenCalledTimes(1);

    // Advance 5 seconds - flop should be revealed
    await jest.advanceTimersByTimeAsync(5000);
    expect(broadcast).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ 
        stage: 'flop', 
        communityCards: expect.arrayContaining([
          { rank: '2', suit: 'hearts' },
          { rank: '3', suit: 'hearts' },
          { rank: '4', suit: 'hearts' },
        ]) 
      }),
      { action: 'auto_runout_flop' },
    );

    // Advance another 5 seconds - turn should be revealed
    await jest.advanceTimersByTimeAsync(5000);
    expect(broadcast).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ 
        stage: 'turn',
        communityCards: expect.arrayContaining([
          { rank: '2', suit: 'hearts' },
          { rank: '3', suit: 'hearts' },
          { rank: '4', suit: 'hearts' },
          { rank: '5', suit: 'clubs' }
        ])
      }),
      { action: 'auto_runout_turn' },
    );

    // Advance another 5 seconds - river should be revealed
    await jest.advanceTimersByTimeAsync(5000);
    expect(broadcast).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ 
        stage: 'river',
        communityCards: expect.arrayContaining([
          { rank: '2', suit: 'hearts' },
          { rank: '3', suit: 'hearts' },
          { rank: '4', suit: 'hearts' },
          { rank: '5', suit: 'clubs' },
          { rank: '8', suit: 'diamonds' }
        ])
      }),
      { action: 'auto_runout_river' },
    );

    // Advance another 5 seconds - showdown should happen
    await jest.advanceTimersByTimeAsync(5000);
    expect(broadcast).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ stage: 'showdown' }),
      { action: 'auto_runout_showdown' },
    );
  });

  it('ensures turn happens exactly 5 seconds after flop, not immediately', async () => {
    const state = makePreflopState();
    const engine = makeEngine(state);
    const broadcast = jest.fn().mockResolvedValue(undefined);

    scheduleSupabaseAutoRunout(tableId, engine as any, broadcast);

    // After flop reveal at 5s, turn should NOT have happened yet
    await jest.advanceTimersByTimeAsync(5000);
    expect(broadcast).toHaveBeenCalledTimes(1); // Only flop

    // Advance by 4.9 more seconds - turn still should not have happened
    await jest.advanceTimersByTimeAsync(4900);
    expect(broadcast).toHaveBeenCalledTimes(1); // Still only flop

    // Advance final 0.1 seconds - now turn should happen
    await jest.advanceTimersByTimeAsync(100);
    expect(broadcast).toHaveBeenCalledTimes(2); // Flop + Turn
    expect(broadcast).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ stage: 'turn' }),
      { action: 'auto_runout_turn' },
    );
  });
});
