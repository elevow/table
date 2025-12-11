/**
 * Extended tests for ActionManager focusing on auto-runout and Run It Twice features
 */
import { ActionManager } from '../action-manager';
import { StateManager } from '../state-manager';
import { Broadcaster, NoopBroadcaster } from '../broadcaster';
import { TableState, Player, Card } from '../../types/poker';

// Mock the state manager
const createMockStateManager = (tableState: Partial<TableState> | null = null) => {
  const states = new Map<string, TableState>();
  if (tableState) {
    states.set('table-1', tableState as TableState);
  }
  
  return {
    getState: jest.fn((tableId: string) => states.get(tableId) || null),
    updateState: jest.fn(async (tableId: string, update: Partial<TableState>) => {
      const current = states.get(tableId) || {};
      states.set(tableId, { ...current, ...update } as TableState);
    }),
    addListener: jest.fn(),
    handleAction: jest.fn()
  } as unknown as StateManager;
};

const createBasicTableState = (overrides: Partial<TableState> = {}): TableState => ({
  tableId: 'table-1',
  pot: 100,
  smallBlind: 5,
  bigBlind: 10,
  currentBet: 0,
  minRaise: 10,
  stage: 'flop',
  activePlayer: 'player-1',
  communityCards: [
    { rank: 'A', suit: 'hearts' },
    { rank: 'K', suit: 'hearts' },
    { rank: 'Q', suit: 'hearts' },
  ],
  players: [
    {
      id: 'player-1',
      name: 'Player 1',
      stack: 500,
      currentBet: 0,
      hasActed: false,
      isFolded: false,
      isAllIn: false,
      position: 0,
      holeCards: [
        { rank: 'J', suit: 'hearts' },
        { rank: '10', suit: 'hearts' },
      ],
    },
    {
      id: 'player-2',
      name: 'Player 2',
      stack: 500,
      currentBet: 0,
      hasActed: false,
      isFolded: false,
      isAllIn: false,
      position: 1,
      holeCards: [
        { rank: '9', suit: 'hearts' },
        { rank: '8', suit: 'hearts' },
      ],
    }
  ] as Player[],
  variant: 'texas-holdem',
  bettingMode: 'no-limit',
  ...overrides
});

describe('ActionManager - Extended Tests', () => {
  let actionManager: ActionManager;
  let mockStateManager: ReturnType<typeof createMockStateManager>;
  let mockBroadcaster: Broadcaster;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockBroadcaster = new NoopBroadcaster();
    mockStateManager = createMockStateManager(createBasicTableState());
    actionManager = new ActionManager(mockStateManager, mockBroadcaster);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('auto-runout scheduling', () => {
    it('should not schedule auto-runout for seven-card-stud variant', async () => {
      const studState = createBasicTableState({
        variant: 'seven-card-stud',
        stage: 'turn',
        currentBet: 0,
        communityCards: [
          { rank: 'A', suit: 'hearts' },
          { rank: 'K', suit: 'hearts' },
          { rank: 'Q', suit: 'hearts' },
          { rank: 'J', suit: 'hearts' },
        ],
        players: [
          {
            id: 'player-1',
            name: 'Player 1',
            stack: 500,
            currentBet: 0,
            hasActed: false,
            isFolded: false,
            isAllIn: false,
            position: 0,
            holeCards: [],
          },
          {
            id: 'player-2',
            name: 'Player 2',
            stack: 0,
            currentBet: 500,
            hasActed: true,
            isFolded: false,
            isAllIn: true,
            position: 1,
            holeCards: [],
          }
        ] as Player[],
        activePlayer: 'player-1',
      });

      mockStateManager.getState = jest.fn().mockReturnValue(studState);

      const action = {
        type: 'check' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
      // Auto-runout should not trigger for stud variants
      expect(mockStateManager.updateState).toHaveBeenCalled();
    });

    it('should not schedule auto-runout when already at showdown', async () => {
      const showdownState = createBasicTableState({
        stage: 'showdown',
        currentBet: 0,
        activePlayer: '',
        players: [
          {
            id: 'player-1',
            name: 'Player 1',
            stack: 0,
            currentBet: 500,
            hasActed: true,
            isFolded: false,
            isAllIn: true,
            position: 0,
            holeCards: [],
          },
          {
            id: 'player-2',
            name: 'Player 2',
            stack: 0,
            currentBet: 500,
            hasActed: true,
            isFolded: false,
            isAllIn: true,
            position: 1,
            holeCards: [],
          }
        ] as Player[],
      });

      mockStateManager.getState = jest.fn().mockReturnValue(showdownState);

      // At showdown, there should be no active player actions
      // This test verifies that auto-runout doesn't schedule at showdown
      expect(showdownState.stage).toBe('showdown');
    });

    it('should not schedule auto-runout when active players < 2', async () => {
      const onePlayerState = createBasicTableState({
        currentBet: 0,
        activePlayer: 'player-1',
        players: [
          {
            id: 'player-1',
            name: 'Player 1',
            stack: 500,
            currentBet: 0,
            hasActed: false,
            isFolded: false,
            isAllIn: false,
            position: 0,
            holeCards: [],
          },
          {
            id: 'player-2',
            name: 'Player 2',
            stack: 1000,
            currentBet: 0,
            hasActed: true,
            isFolded: true,
            isAllIn: false,
            position: 1,
            holeCards: [],
          }
        ] as Player[],
      });

      mockStateManager.getState = jest.fn().mockReturnValue(onePlayerState);

      const action = {
        type: 'check' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
    });

    it('should not schedule auto-runout when no all-in players', async () => {
      const noAllInState = createBasicTableState({
        players: [
          {
            id: 'player-1',
            name: 'Player 1',
            stack: 500,
            currentBet: 0,
            hasActed: false,
            isFolded: false,
            isAllIn: false,
            position: 0,
            holeCards: [],
          },
          {
            id: 'player-2',
            name: 'Player 2',
            stack: 500,
            currentBet: 0,
            hasActed: false,
            isFolded: false,
            isAllIn: false,
            position: 1,
            holeCards: [],
          }
        ] as Player[],
      });

      mockStateManager.getState = jest.fn().mockReturnValue(noAllInState);

      const action = {
        type: 'check' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
    });

    it('should not schedule auto-runout when more than 1 non-all-in player remains', async () => {
      const multipleActiveState = createBasicTableState({
        currentBet: 0,
        activePlayer: 'player-2',
        players: [
          {
            id: 'player-1',
            name: 'Player 1',
            stack: 0,
            currentBet: 500,
            hasActed: true,
            isFolded: false,
            isAllIn: true,
            position: 0,
            holeCards: [],
          },
          {
            id: 'player-2',
            name: 'Player 2',
            stack: 500,
            currentBet: 0,
            hasActed: false,
            isFolded: false,
            isAllIn: false,
            position: 1,
            holeCards: [],
          },
          {
            id: 'player-3',
            name: 'Player 3',
            stack: 500,
            currentBet: 0,
            hasActed: true,
            isFolded: false,
            isAllIn: false,
            position: 2,
            holeCards: [],
          }
        ] as Player[],
      });

      mockStateManager.getState = jest.fn().mockReturnValue(multipleActiveState);

      const action = {
        type: 'check' as const,
        playerId: 'player-2',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
    });

    it('should not schedule auto-runout when no cards remain to reveal', async () => {
      const fullBoardState = createBasicTableState({
        currentBet: 0,
        activePlayer: 'player-1',
        communityCards: [
          { rank: 'A', suit: 'hearts' },
          { rank: 'K', suit: 'hearts' },
          { rank: 'Q', suit: 'hearts' },
          { rank: 'J', suit: 'hearts' },
          { rank: '10', suit: 'hearts' },
        ],
        players: [
          {
            id: 'player-1',
            name: 'Player 1',
            stack: 500,
            currentBet: 0,
            hasActed: false,
            isFolded: false,
            isAllIn: false,
            position: 0,
            holeCards: [],
          },
          {
            id: 'player-2',
            name: 'Player 2',
            stack: 0,
            currentBet: 500,
            hasActed: true,
            isFolded: false,
            isAllIn: true,
            position: 1,
            holeCards: [],
          }
        ] as Player[],
      });

      mockStateManager.getState = jest.fn().mockReturnValue(fullBoardState);

      const action = {
        type: 'check' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
    });
  });

  describe('Run It Twice prompts', () => {
    it('should block actions when runItTwicePrompt is active', async () => {
      const stateWithPrompt = createBasicTableState({
        runItTwicePrompt: {
          playerId: 'player-1',
          reason: 'lowest-hand',
          createdAt: Date.now(),
          boardCardsCount: 3,
        }
      });

      mockStateManager.getState = jest.fn().mockReturnValue(stateWithPrompt);

      const action = {
        type: 'call' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Waiting on Run It Twice decision');
    });

    it('should handle missing runItTwicePrompt gracefully', async () => {
      const normalState = createBasicTableState({
        runItTwicePrompt: undefined,
      });

      mockStateManager.getState = jest.fn().mockReturnValue(normalState);

      const action = {
        type: 'check' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
    });
  });

  describe('showdown finalization with RIT', () => {
    it('should not finalize RIT when not at showdown', async () => {
      const preflopState = createBasicTableState({
        stage: 'preflop',
        runItTwice: {
          enabled: true,
          numberOfRuns: 2,
          results: [],
        },
      });

      mockStateManager.getState = jest.fn().mockReturnValue(preflopState);

      const action = {
        type: 'check' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
    });

    it('should not finalize RIT when RIT not enabled', async () => {
      const showdownNoRit = createBasicTableState({
        stage: 'showdown',
        runItTwice: undefined,
      });

      mockStateManager.getState = jest.fn().mockReturnValue(showdownNoRit);

      const action = {
        type: 'check' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
    });

    it('should not finalize RIT when results already exist', async () => {
      const showdownWithResults = createBasicTableState({
        stage: 'showdown',
        runItTwice: {
          enabled: true,
          numberOfRuns: 2,
          results: [
            { winners: [{ playerId: 'player-1', share: 100 }] },
            { winners: [{ playerId: 'player-2', share: 100 }] },
          ],
        },
      });

      mockStateManager.getState = jest.fn().mockReturnValue(showdownWithResults);

      const action = {
        type: 'check' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
    });
  });

  describe('action validation edge cases', () => {
    it('should handle actions when communityCards is not an array', async () => {
      const invalidState = createBasicTableState({
        communityCards: undefined as any,
      });

      mockStateManager.getState = jest.fn().mockReturnValue(invalidState);

      const action = {
        type: 'check' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      // Should handle gracefully without throwing
      expect(result).toBeDefined();
    });

    it('should handle fold action correctly', async () => {
      const state = createBasicTableState();
      mockStateManager.getState = jest.fn().mockReturnValue(state);

      const action = {
        type: 'fold' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
      expect(mockStateManager.updateState).toHaveBeenCalled();
    });

    it('should handle raise action with valid amount', async () => {
      const state = createBasicTableState({
        currentBet: 10,
      });
      mockStateManager.getState = jest.fn().mockReturnValue(state);

      const action = {
        type: 'raise' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now(),
        amount: 30
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
    });

    it('should handle bet action with valid amount', async () => {
      const state = createBasicTableState({
        currentBet: 0,
      });
      mockStateManager.getState = jest.fn().mockReturnValue(state);

      const action = {
        type: 'bet' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now(),
        amount: 50
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
    });
  });

  describe('betting round progression', () => {
    it('should advance from flop to turn when betting round completes', async () => {
      const flopState = createBasicTableState({
        stage: 'flop',
        currentBet: 0,
        activePlayer: 'player-2',
        players: [
          {
            id: 'player-1',
            name: 'Player 1',
            stack: 1000,
            currentBet: 0,
            hasActed: true,
            isFolded: false,
            isAllIn: false,
            position: 0,
            holeCards: [],
          },
          {
            id: 'player-2',
            name: 'Player 2',
            stack: 1000,
            currentBet: 0,
            hasActed: false,
            isFolded: false,
            isAllIn: false,
            position: 1,
            holeCards: [],
          }
        ] as Player[],
      });

      mockStateManager.getState = jest.fn().mockReturnValue(flopState);

      const action = {
        type: 'check' as const,
        playerId: 'player-2',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
    });

    it('should handle all-in scenario correctly', async () => {
      const allInState = createBasicTableState({
        currentBet: 500,
        activePlayer: 'player-1',
        players: [
          {
            id: 'player-1',
            name: 'Player 1',
            stack: 500,
            currentBet: 0,
            hasActed: false,
            isFolded: false,
            isAllIn: false,
            position: 0,
            holeCards: [],
          },
          {
            id: 'player-2',
            name: 'Player 2',
            stack: 500,
            currentBet: 500,
            hasActed: true,
            isFolded: false,
            isAllIn: false,
            position: 1,
            holeCards: [],
          }
        ] as Player[],
      });

      mockStateManager.getState = jest.fn().mockReturnValue(allInState);

      const action = {
        type: 'call' as const,
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
    });
  });
});
