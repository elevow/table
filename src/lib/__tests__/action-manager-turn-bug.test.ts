/**
 * Test for the action-manager findNextActivePlayer bug fix.
 * 
 * This test verifies that when a player calls or bets during a betting round,
 * the next player is correctly identified only if they need to act
 * (haven't acted yet or need to call/raise).
 */

import { ActionManager } from '../action-manager';
import { StateManager } from '../state-manager';
import { NoopBroadcaster } from '../broadcaster';
import { PlayerAction, TableState, Player } from '../../types/poker';

const createMockStateManager = (tableState: Partial<TableState> | null = null) => {
  const states = new Map<string, TableState>();
  if (tableState) {
    states.set('table-1', tableState as TableState);
  }
  
  return {
    getState: jest.fn((tableId: string) => states.get(tableId) || null),
    updateState: jest.fn(async (tableId: string, update: Partial<TableState>) => {
      const current = states.get(tableId) || {};
      const newState = { ...current, ...update } as TableState;
      states.set(tableId, newState);
      return newState;
    }),
    addListener: jest.fn(),
    handleAction: jest.fn()
  } as unknown as StateManager;
};

describe('ActionManager - findNextActivePlayer bug fix', () => {
  let actionManager: ActionManager;
  let mockStateManager: ReturnType<typeof createMockStateManager>;
  let mockBroadcaster: NoopBroadcaster;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockBroadcaster = new NoopBroadcaster();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should not set next player to player who has already acted and matched the bet', async () => {
    // Scenario: 3 players, player 2 has folded, player 3 has already acted and matched bet, player 1 calls
    const initialState: TableState = {
      tableId: 'table-1',
      pot: 50,
      smallBlind: 10,
      bigBlind: 20,
      currentBet: 20,
      minRaise: 20,
      stage: 'preflop',
      activePlayer: 'player-1',
      communityCards: [],
      dealerPosition: 0,
      players: [
        {
          id: 'player-1',
          name: 'Player 1',
          stack: 980,
          currentBet: 0, // About to call
          hasActed: false,
          isFolded: false,
          isAllIn: false,
          position: 0,
          holeCards: []
        },
        {
          id: 'player-2',
          name: 'Player 2',
          stack: 990,
          currentBet: 10,
          hasActed: true,
          isFolded: true, // FOLDED
          isAllIn: false,
          position: 1,
          holeCards: []
        },
        {
          id: 'player-3',
          name: 'Player 3',
          stack: 980,
          currentBet: 20, // Already matched the bet
          hasActed: true, // Already acted
          isFolded: false,
          isAllIn: false,
          position: 2,
          holeCards: []
        }
      ] as Player[],
      variant: 'texas-holdem',
      bettingMode: 'no-limit'
    };

    mockStateManager = createMockStateManager(initialState);
    actionManager = new ActionManager(mockStateManager, mockBroadcaster);

    // Player 1 calls
    const action: PlayerAction = {
      type: 'call',
      playerId: 'player-1',
      tableId: 'table-1',
      timestamp: Date.now()
    };

    const result = await actionManager.handlePlayerAction(action);

    expect(result.success).toBe(true);
    
    // After player 1 calls, all players have acted and matched bets
    // activePlayer should be empty string (betting round complete) or move to next stage
    const finalState = mockStateManager.getState('table-1');
    
    // The key assertion: activePlayer should NOT be player-1 (who just acted)
    // and should NOT be player-2 (who is folded)
    // Since all active players have acted and matched bets, the round should be complete
    expect(finalState?.activePlayer).not.toBe('player-1');
    expect(finalState?.activePlayer).not.toBe('player-2');
    
    // The round should have advanced since all players acted and matched bets
    expect(finalState?.stage).toBe('flop');
  });

  it('should correctly identify next player who needs to call a raise', async () => {
    // Scenario: 3 players, player 1 raises, player 2 needs to call, player 3 has folded
    const initialState: TableState = {
      tableId: 'table-1',
      pot: 50,
      smallBlind: 10,
      bigBlind: 20,
      currentBet: 20,
      minRaise: 20,
      stage: 'preflop',
      activePlayer: 'player-1',
      communityCards: [],
      dealerPosition: 0,
      players: [
        {
          id: 'player-1',
          name: 'Player 1',
          stack: 900,
          currentBet: 0, // About to raise to 100
          hasActed: false,
          isFolded: false,
          isAllIn: false,
          position: 0,
          holeCards: []
        },
        {
          id: 'player-2',
          name: 'Player 2',
          stack: 980,
          currentBet: 20, // Has called BB but not the raise yet
          hasActed: true,
          isFolded: false,
          isAllIn: false,
          position: 1,
          holeCards: []
        },
        {
          id: 'player-3',
          name: 'Player 3',
          stack: 990,
          currentBet: 10,
          hasActed: true,
          isFolded: true, // FOLDED
          isAllIn: false,
          position: 2,
          holeCards: []
        }
      ] as Player[],
      variant: 'texas-holdem',
      bettingMode: 'no-limit'
    };

    mockStateManager = createMockStateManager(initialState);
    actionManager = new ActionManager(mockStateManager, mockBroadcaster);

    // Player 1 raises to 100
    const action: PlayerAction = {
      type: 'raise',
      playerId: 'player-1',
      tableId: 'table-1',
      amount: 100,
      timestamp: Date.now()
    };

    const result = await actionManager.handlePlayerAction(action);

    expect(result.success).toBe(true);
    
    // After player 1 raises, player 2 needs to act (call the raise)
    const finalState = mockStateManager.getState('table-1');
    
    // Next player should be player-2 (who needs to call the raise)
    expect(finalState?.activePlayer).toBe('player-2');
    expect(finalState?.currentBet).toBe(100);
  });

  it('should handle scenario where all remaining players are all-in', async () => {
    // Scenario: Player 1 bets, player 2 is all-in, player 3 has folded
    const initialState: TableState = {
      tableId: 'table-1',
      pot: 50,
      smallBlind: 10,
      bigBlind: 20,
      currentBet: 0,
      minRaise: 20,
      stage: 'flop',
      activePlayer: 'player-1',
      communityCards: [
        { suit: 'hearts', rank: 'A' },
        { suit: 'spades', rank: 'K' },
        { suit: 'diamonds', rank: 'Q' }
      ],
      dealerPosition: 0,
      players: [
        {
          id: 'player-1',
          name: 'Player 1',
          stack: 900,
          currentBet: 0,
          hasActed: false,
          isFolded: false,
          isAllIn: false,
          position: 0,
          holeCards: []
        },
        {
          id: 'player-2',
          name: 'Player 2',
          stack: 0,
          currentBet: 50,
          hasActed: true,
          isFolded: false,
          isAllIn: true, // ALL-IN
          position: 1,
          holeCards: []
        },
        {
          id: 'player-3',
          name: 'Player 3',
          stack: 990,
          currentBet: 0,
          hasActed: true,
          isFolded: true, // FOLDED
          isAllIn: false,
          position: 2,
          holeCards: []
        }
      ] as Player[],
      variant: 'texas-holdem',
      bettingMode: 'no-limit'
    };

    mockStateManager = createMockStateManager(initialState);
    actionManager = new ActionManager(mockStateManager, mockBroadcaster);

    // Player 1 bets 50 (matching the all-in)
    const action: PlayerAction = {
      type: 'bet',
      playerId: 'player-1',
      tableId: 'table-1',
      amount: 50,
      timestamp: Date.now()
    };

    const result = await actionManager.handlePlayerAction(action);

    expect(result.success).toBe(true);
    
    // After player 1 bets, only player 2 remains but is all-in
    // The round should complete and move to next stage
    const finalState = mockStateManager.getState('table-1');
    
    // Since only one non-all-in player remains and has acted, should move to next stage
    expect(finalState?.stage).toBe('turn');
  });
});
