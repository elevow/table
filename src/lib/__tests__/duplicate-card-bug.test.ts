import { TableState, Player, Card } from '../../types/poker';
import { scheduleSupabaseAutoRunout, clearSupabaseAutoRunout } from '../poker/supabase-auto-runout';

describe('Duplicate community card bug test', () => {
  const tableId = 'duplicate-card-test';

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
        { rank: '4', suit: 'hearts' },
        { rank: '6', suit: 'hearts' },
      ],
      turn: [{ rank: '8', suit: 'hearts' }],
      river: [{ rank: 'T', suit: 'diamonds' }],
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

  it('should NOT have duplicate cards in turn stage - exact length check', async () => {
    const state = makePreflopState();
    const engine = makeEngine(state);
    const broadcast = jest.fn().mockResolvedValue(undefined);

    const scheduled = scheduleSupabaseAutoRunout(tableId, engine, broadcast);
    expect(scheduled).toBe(true);

    // Advance 5 seconds - flop should be revealed (3 cards)
    await jest.advanceTimersByTimeAsync(5000);
    const flopCall = broadcast.mock.calls[0][0];
    expect(flopCall.stage).toBe('flop');
    expect(flopCall.communityCards).toHaveLength(3);
    console.log('Flop communityCards:', flopCall.communityCards);

    // Advance another 5 seconds - turn should be revealed (4 cards total, NOT 5!)
    await jest.advanceTimersByTimeAsync(5000);
    const turnCall = broadcast.mock.calls[1][0];
    expect(turnCall.stage).toBe('turn');
    expect(turnCall.communityCards).toHaveLength(4); // SHOULD BE 4, not 5
    console.log('Turn communityCards:', turnCall.communityCards);
    
    // Check exact cards - no duplicates
    expect(turnCall.communityCards).toEqual([
      { rank: '2', suit: 'hearts' },
      { rank: '4', suit: 'hearts' },
      { rank: '6', suit: 'hearts' },
      { rank: '8', suit: 'hearts' },
    ]);

    // Advance another 5 seconds - river should be revealed (5 cards total)
    await jest.advanceTimersByTimeAsync(5000);
    const riverCall = broadcast.mock.calls[2][0];
    expect(riverCall.stage).toBe('river');
    expect(riverCall.communityCards).toHaveLength(5); // SHOULD BE 5, not 6
    console.log('River communityCards:', riverCall.communityCards);
    
    // Check exact cards - no duplicates
    expect(riverCall.communityCards).toEqual([
      { rank: '2', suit: 'hearts' },
      { rank: '4', suit: 'hearts' },
      { rank: '6', suit: 'hearts' },
      { rank: '8', suit: 'hearts' },
      { rank: 'T', suit: 'diamonds' },
    ]);
  });
});
