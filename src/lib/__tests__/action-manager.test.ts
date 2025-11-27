import { ActionManager } from '../action-manager';
import { StateManager } from '../state-manager';
import { Broadcaster, NoopBroadcaster } from '../broadcaster';
import { PlayerAction, TableState, Player } from '../../types/poker';

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
  currentBet: 10,
  minRaise: 10,
  stage: 'preflop',
  activePlayer: 'player-1',
  communityCards: [],
  players: [
    {
      id: 'player-1',
      name: 'Player 1',
      stack: 1000,
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
      stack: 1000,
      currentBet: 10,
      hasActed: true,
      isFolded: false,
      isAllIn: false,
      position: 1,
      holeCards: []
    }
  ] as Player[],
  variant: 'texas-holdem',
  bettingMode: 'no-limit',
  ...overrides
});

describe('ActionManager', () => {
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

  describe('handlePlayerAction()', () => {
    it('should return error if table not found', async () => {
      mockStateManager.getState = jest.fn().mockReturnValue(null);
      
      const action: PlayerAction = {
        type: 'call',
        playerId: 'player-1',
        tableId: 'non-existent',
        timestamp: Date.now()
      };
      
      const result = await actionManager.handlePlayerAction(action);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Table not found');
    });

    it('should return error if player not found', async () => {
      const action: PlayerAction = {
        type: 'call',
        playerId: 'non-existent',
        tableId: 'table-1',
        timestamp: Date.now()
      };
      
      const result = await actionManager.handlePlayerAction(action);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Player not found');
    });

    it('should return error if waiting on Run It Twice decision', async () => {
      const stateWithPrompt = createBasicTableState({
        runItTwicePrompt: {
          playerId: 'player-1',
          reason: 'lowest-hand',
          createdAt: Date.now(),
          boardCardsCount: 3
        }
      });
      mockStateManager.getState = jest.fn().mockReturnValue(stateWithPrompt);
      
      const action: PlayerAction = {
        type: 'call',
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };
      
      const result = await actionManager.handlePlayerAction(action);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Waiting on Run It Twice decision');
    });

    it('should handle fold action', async () => {
      const action: PlayerAction = {
        type: 'fold',
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };
      
      const result = await actionManager.handlePlayerAction(action);
      expect(result.success).toBe(true);
      expect(mockStateManager.updateState).toHaveBeenCalled();
    });

    it('should handle check action', async () => {
      const stateWithZeroBet = createBasicTableState({
        currentBet: 0,
        players: [
          {
            id: 'player-1',
            name: 'Player 1',
            stack: 1000,
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
            stack: 1000,
            currentBet: 0,
            hasActed: true,
            isFolded: false,
            isAllIn: false,
            position: 1,
            holeCards: []
          }
        ] as Player[]
      });
      mockStateManager.getState = jest.fn().mockReturnValue(stateWithZeroBet);
      
      const action: PlayerAction = {
        type: 'check',
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };
      
      const result = await actionManager.handlePlayerAction(action);
      expect(result.success).toBe(true);
    });

    it('should handle call action', async () => {
      const action: PlayerAction = {
        type: 'call',
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };
      
      const result = await actionManager.handlePlayerAction(action);
      expect(result.success).toBe(true);
    });

    it('should handle bet action', async () => {
      const stateWithZeroBet = createBasicTableState({
        currentBet: 0
      });
      mockStateManager.getState = jest.fn().mockReturnValue(stateWithZeroBet);
      
      const action: PlayerAction = {
        type: 'bet',
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now(),
        amount: 50
      };
      
      const result = await actionManager.handlePlayerAction(action);
      expect(result.success).toBe(true);
    });

    it('should handle raise action', async () => {
      const action: PlayerAction = {
        type: 'raise',
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now(),
        amount: 30
      };
      
      const result = await actionManager.handlePlayerAction(action);
      expect(result.success).toBe(true);
    });
  });

  describe('all-in locking', () => {
    it('should block actions when hand is locked for auto-runout', async () => {
      const allInState = createBasicTableState({
        stage: 'turn',
        communityCards: [
          { rank: 'A', suit: 'hearts' },
          { rank: 'K', suit: 'hearts' },
          { rank: 'Q', suit: 'hearts' },
          { rank: 'J', suit: 'hearts' }
        ],
        players: [
          {
            id: 'player-1',
            name: 'Player 1',
            stack: 0,
            currentBet: 1000,
            hasActed: true,
            isFolded: false,
            isAllIn: true,
            position: 0,
            holeCards: []
          },
          {
            id: 'player-2',
            name: 'Player 2',
            stack: 0,
            currentBet: 1000,
            hasActed: true,
            isFolded: false,
            isAllIn: true,
            position: 1,
            holeCards: []
          }
        ] as Player[]
      });
      
      mockStateManager.getState = jest.fn().mockReturnValue(allInState);
      
      const action: PlayerAction = {
        type: 'check',
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };
      
      const result = await actionManager.handlePlayerAction(action);
      expect(result.success).toBe(false);
      expect(result.error).toContain('locked');
    });
  });

  describe('betting round completion', () => {
    it('should advance stage when betting round completes', async () => {
      const preflopDoneState = createBasicTableState({
        stage: 'preflop',
        currentBet: 10,
        players: [
          {
            id: 'player-1',
            name: 'Player 1',
            stack: 990,
            currentBet: 10,
            hasActed: true,
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
            hasActed: false,
            isFolded: false,
            isAllIn: false,
            position: 1,
            holeCards: []
          }
        ] as Player[],
        activePlayer: 'player-2'
      });
      
      mockStateManager.getState = jest.fn().mockReturnValue(preflopDoneState);
      
      const action: PlayerAction = {
        type: 'check',
        playerId: 'player-2',
        tableId: 'table-1',
        timestamp: Date.now()
      };
      
      const result = await actionManager.handlePlayerAction(action);
      expect(result.success).toBe(true);
    });
  });
});
