import { StateManager } from '../state-manager';
import { Broadcaster, NoopBroadcaster } from '../broadcaster';
import { TableState, Player, PlayerAction } from '../../types/poker';

describe('StateManager (Server)', () => {
  let stateManager: StateManager;
  let mockBroadcaster: Broadcaster;
  let mockEmit: jest.Mock;
  let mockTo: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    mockEmit = jest.fn();
    mockTo = jest.fn(() => ({ emit: mockEmit }));
    mockBroadcaster = {
      emit: mockEmit,
      to: mockTo
    };
    
    stateManager = new StateManager(mockBroadcaster);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createBasicTableState = (overrides: Partial<TableState> = {}): Partial<TableState> => ({
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

  describe('constructor', () => {
    it('should create a StateManager instance', () => {
      expect(stateManager).toBeDefined();
    });
  });

  describe('updateState()', () => {
    it('should store state for a new table', () => {
      const result = stateManager.updateState('table-1', createBasicTableState());
      expect(result).toBe(true);
    });

    it('should return false if rate limited', () => {
      // Rapidly update to trigger rate limit
      for (let i = 0; i < 25; i++) {
        stateManager.updateState('table-1', { pot: 100 + i });
      }
      
      // After rate limit exceeded
      const result = stateManager.updateState('table-1', { pot: 999 });
      expect(result).toBe(false);
    });

    it('should broadcast state updates', () => {
      stateManager.updateState('table-1', createBasicTableState());
      
      expect(mockTo).toHaveBeenCalledWith('table-1');
      expect(mockEmit).toHaveBeenCalledWith('state_update', expect.any(Object));
    });

    it('should increment sequence on each update', () => {
      stateManager.updateState('table-1', { pot: 100 });
      const seq1 = stateManager.getSequence('table-1');
      
      stateManager.updateState('table-1', { pot: 200 });
      const seq2 = stateManager.getSequence('table-1');
      
      expect(seq2).toBe(seq1 + 1);
    });

    it('should merge updates with existing state', () => {
      stateManager.updateState('table-1', { pot: 100, activePlayer: 'player-1' });
      stateManager.updateState('table-1', { pot: 200 });
      
      const state = stateManager.getState('table-1');
      expect(state?.pot).toBe(200);
      expect(state?.activePlayer).toBe('player-1');
    });

    it('should reset runItTwicePrompt on stage transition to preflop', () => {
      stateManager.updateState('table-1', {
        stage: 'showdown',
        runItTwicePrompt: {
          playerId: 'player-1',
          reason: 'lowest-hand',
          createdAt: Date.now(),
          boardCardsCount: 3
        }
      });
      
      stateManager.updateState('table-1', { stage: 'preflop' });
      
      const state = stateManager.getState('table-1');
      expect(state?.runItTwicePrompt).toBeNull();
    });
  });

  describe('getState()', () => {
    it('should return undefined for unknown table', () => {
      const state = stateManager.getState('non-existent');
      expect(state).toBeUndefined();
    });

    it('should return state for known table', () => {
      stateManager.updateState('table-1', createBasicTableState());
      const state = stateManager.getState('table-1');
      expect(state).toBeDefined();
      expect(state?.tableId).toBe('table-1');
    });
  });

  describe('getSequence()', () => {
    it('should return 0 for unknown table', () => {
      const seq = stateManager.getSequence('non-existent');
      expect(seq).toBe(0);
    });

    it('should return current sequence for known table', () => {
      stateManager.updateState('table-1', { pot: 100 });
      const seq = stateManager.getSequence('table-1');
      expect(seq).toBeGreaterThan(0);
    });
  });

  describe('addListener()', () => {
    it('should register a listener', () => {
      const listener = jest.fn();
      stateManager.addListener(listener);
      
      stateManager.updateState('table-1', createBasicTableState());
      
      expect(listener).toHaveBeenCalled();
    });

    it('should call listener with tableId, state, and update', () => {
      const listener = jest.fn();
      stateManager.addListener(listener);
      
      const update = createBasicTableState();
      stateManager.updateState('table-1', update);
      
      expect(listener).toHaveBeenCalledWith(
        'table-1',
        expect.any(Object),
        update
      );
    });
  });

  describe('removeListener()', () => {
    it('should remove a listener', () => {
      const listener = jest.fn();
      stateManager.addListener(listener);
      stateManager.removeListener(listener);
      
      stateManager.updateState('table-1', createBasicTableState());
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('handleAction()', () => {
    it('should not throw for unknown table', () => {
      const action: PlayerAction = {
        type: 'fold',
        playerId: 'player-1',
        tableId: 'non-existent',
        timestamp: Date.now()
      };
      
      expect(() => stateManager.handleAction('non-existent', action)).not.toThrow();
    });

    it('should handle fold action', () => {
      stateManager.updateState('table-1', createBasicTableState());
      
      const action: PlayerAction = {
        type: 'fold',
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };
      
      stateManager.handleAction('table-1', action);
      
      const state = stateManager.getState('table-1');
      const player = state?.players.find(p => p.id === 'player-1');
      expect(player?.isFolded).toBe(true);
    });

    it('should broadcast action', () => {
      stateManager.updateState('table-1', createBasicTableState());
      jest.clearAllMocks();
      
      const action: PlayerAction = {
        type: 'fold',
        playerId: 'player-1',
        tableId: 'table-1',
        timestamp: Date.now()
      };
      
      stateManager.handleAction('table-1', action);
      
      expect(mockTo).toHaveBeenCalledWith('table-1');
      expect(mockEmit).toHaveBeenCalledWith('action', action);
    });
  });

  describe('rate limiting', () => {
    it('should allow updates within rate limit', () => {
      for (let i = 0; i < 15; i++) {
        const result = stateManager.updateState('table-1', { pot: i });
        expect(result).toBe(true);
      }
    });

    it('should clean up old rate limit timestamps', () => {
      // Fill up rate limit
      for (let i = 0; i < 20; i++) {
        stateManager.updateState('table-1', { pot: i });
      }
      
      // Advance time past the cleanup interval
      jest.advanceTimersByTime(2000);
      
      // Should be able to update again after cleanup
      const result = stateManager.updateState('table-1', { pot: 999 });
      expect(result).toBe(true);
    });
  });
});
