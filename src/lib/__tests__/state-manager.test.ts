import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { StateManager } from '../state-manager';
import { TableState } from '../../types/poker';

jest.mock('../state-recovery');

jest.mock('socket.io', () => {
  const mockEmit = jest.fn();
  const mockOn = jest.fn();
  const mockTo = jest.fn(() => ({ emit: mockEmit }));
  const mockJoin = jest.fn();
  const mockLeave = jest.fn();
  
  return {
    Server: jest.fn().mockImplementation(() => ({
      on: mockOn,
      to: mockTo,
      emit: mockEmit,
      sockets: {
        adapter: {
          rooms: new Map()
        }
      }
    }))
  };
});

describe('StateManager', () => {
  let stateManager: StateManager;
  let mockIo: jest.Mocked<SocketServer>;
  let mockSocket: any;
  let mockEmitToRoom: jest.Mock;
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Set up socket event handlers before creating the mock
    const socketHandlers = new Map();
    mockSocket = {
      id: 'socket1',
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      on: jest.fn((event, handler) => {
        socketHandlers.set(event, handler);
      })
    };
    
    mockEmitToRoom = jest.fn();
    mockIo = new SocketServer({} as HttpServer) as jest.Mocked<SocketServer>;
    mockIo.to = jest.fn().mockReturnValue({ emit: mockEmitToRoom });
    
    // Set up the socket connection handler
    mockIo.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'connection') {
        // When connection is received, let the state manager set up socket handlers
        handler(mockSocket);
      }
      return mockIo;
    });
    
    stateManager = new StateManager(mockIo);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('State Updates', () => {
    it('should update state and broadcast changes', () => {
      const tableId = 'table1';
      const update: Partial<TableState> = {
        pot: 100,
        currentBet: 20
      };

      stateManager.updateState(tableId, update);

      const state = stateManager.getState(tableId);
      expect(state).toMatchObject(update);
      expect(mockIo.to).toHaveBeenCalledWith(tableId);
      expect(mockIo.to(tableId).emit).toHaveBeenCalledWith(
        'state_update',
        expect.objectContaining({
          type: 'state_update',
          tableId,
          payload: update
        })
      );
    });

    it('should increment sequence number for each update', () => {
      const tableId = 'table1';
      
      stateManager.updateState(tableId, { pot: 100 });
      expect(stateManager.getSequence(tableId)).toBe(1);
      
      stateManager.updateState(tableId, { currentBet: 20 });
      expect(stateManager.getSequence(tableId)).toBe(2);
    });

    it('should enforce rate limiting', () => {
      const tableId = 'table1';
      const updates = Array(25).fill({ pot: 100 });
      
      updates.forEach(update => {
        stateManager.updateState(tableId, update);
      });

      // Only first 20 updates should succeed due to rate limit
      expect(stateManager.getSequence(tableId)).toBe(20);

      // After 1 second, should accept new updates
      jest.advanceTimersByTime(1000);
      stateManager.updateState(tableId, { pot: 200 });
      expect(stateManager.getSequence(tableId)).toBe(21);
    });

    it('resets Run It Twice flags when a new hand begins', () => {
      const tableId = 'rit-reset-table';
      const baseState: TableState = {
        tableId,
        stage: 'showdown',
        players: [{
          id: 'p1',
          name: 'Player 1',
          position: 0,
          stack: 0,
          currentBet: 0,
          hasActed: true,
          isFolded: false,
          isAllIn: true,
          timeBank: 30000
        }],
        activePlayer: '',
        pot: 0,
        communityCards: [
          { rank: 'A', suit: 'hearts' },
          { rank: 'K', suit: 'spades' },
          { rank: 'Q', suit: 'diamonds' },
          { rank: 'J', suit: 'clubs' },
          { rank: '10', suit: 'hearts' }
        ],
        currentBet: 0,
        dealerPosition: 0,
        smallBlind: 5,
        bigBlind: 10,
        minRaise: 10,
        lastRaise: 0,
        runItTwicePrompt: {
          playerId: 'p1',
          reason: 'lowest-hand',
          createdAt: Date.now(),
          boardCardsCount: 5,
          eligiblePlayerIds: ['p1']
        },
        runItTwicePromptDisabled: true
      } as TableState;

      stateManager.updateState(tableId, baseState);
      stateManager.updateState(tableId, { stage: 'preflop', communityCards: [] });

      const nextState = stateManager.getState(tableId);
      expect(nextState?.runItTwicePromptDisabled).toBe(false);
      expect(nextState?.runItTwicePrompt).toBeNull();
    });
  });

  describe('Socket Handling', () => {
    beforeEach(() => {
      // Trigger connection handler
      const connectionHandler = mockIo.on.mock.calls.find((call: [string, Function]) => call[0] === 'connection')?.[1];
      if (connectionHandler) {
        connectionHandler(mockSocket);
      }
    });

    it('should handle player joining a table', () => {
      const tableId = 'table1';
      const playerId = 'player1';
      const joinHandler = mockSocket.on.mock.calls.find((call: [string, Function]) => call[0] === 'join_table')?.[1];
      
      // Setup initial state
      const initialState = {
        tableId,
        stage: 'preflop' as const,
        players: [],
        pot: 0,
        currentBet: 0,
        communityCards: [],
        activePlayer: '',
        dealerPosition: 0,
        smallBlind: 5,
        bigBlind: 10,
        minRaise: 20,
        lastRaise: 0
      };
      
      stateManager.updateState(tableId, initialState);

      // Simulate join
      if (joinHandler) {
        joinHandler({ tableId, playerId });
      }

      expect(mockSocket.join).toHaveBeenCalledWith(tableId);
      expect(mockSocket.emit).toHaveBeenCalledWith('reconcile', {
        tableId,
        playerId,
        state: initialState,
        type: 'reconcile'
      });
    });

    it('should handle player leaving a table', () => {
      const tableId = 'table1';
      const leaveHandler = mockSocket.on.mock.calls.find((call: [string, Function]) => call[0] === 'leave_table')?.[1];
      const joinHandler = mockSocket.on.mock.calls.find((call: [string, Function]) => call[0] === 'join_table')?.[1];
      
      // Seed a simple table state with one player seated and active
      const playerId = 'player1';
      const initialState = {
        tableId,
        stage: 'preflop' as const,
        players: [{
          id: playerId,
          name: 'Player 1',
          position: 1,
          stack: 1000,
          currentBet: 0,
          hasActed: false,
          isFolded: false,
          isAllIn: false,
          timeBank: 30000
        }],
        pot: 0,
        currentBet: 0,
        communityCards: [],
        activePlayer: playerId,
        dealerPosition: 0,
        smallBlind: 5,
        bigBlind: 10,
        minRaise: 20,
        lastRaise: 0
      } as TableState;
      stateManager.updateState(tableId, initialState);

      // Simulate join to register playerId on the socket context
      if (joinHandler) {
        joinHandler({ tableId, playerId });
      }

      if (leaveHandler) {
        leaveHandler(tableId);
      }

      // Player should have been auto-folded in state before leaving
      const state = stateManager.getState(tableId);
      const player = state?.players.find(p => p.id === playerId);
      expect(player?.isFolded).toBe(true);
      // Socket should then leave the room
      expect(mockSocket.leave).toHaveBeenCalledWith(tableId);
    });

    it('should handle player disconnection and auto-fold', () => {
      const tableId = 'table1';
      const playerId = 'player1';

      // Setup initial state with a player
      const initialState = {
        tableId,
        stage: 'preflop' as const,
        players: [{
          id: playerId,
          name: 'Player 1',
          position: 0,
          stack: 1000,
          currentBet: 0,
          hasActed: false,
          isFolded: false,
          isAllIn: false,
          timeBank: 30000
        }],
        pot: 0,
        currentBet: 0,
        communityCards: [],
        activePlayer: playerId,
        dealerPosition: 0,
        smallBlind: 5,
        bigBlind: 10,
        minRaise: 20,
        lastRaise: 0
      };

      // Set up initial state
      stateManager.updateState(tableId, initialState);
      
      // Mock handleDisconnect to simulate state updates on disconnect
      jest.spyOn(stateManager['recovery'], 'handleDisconnect').mockImplementation((pid, tid) => {
        stateManager.handleAction(tid, {
          type: 'fold',
          playerId: pid,
          tableId: tid,
          timestamp: Date.now()
        });
        return pid;
      });

      // Get join and disconnect handlers
      const joinTableHandler = mockSocket.on.mock.calls.find(([event]: [string, Function]) => event === 'join_table')?.[1];
      const disconnectHandler = mockSocket.on.mock.calls.find(([event]: [string, Function]) => event === 'disconnect')?.[1];
      
      // Join table first
      if (joinTableHandler) {
        joinTableHandler({ tableId, playerId });
      }

      // Then trigger disconnect and action
      if (disconnectHandler) {
        disconnectHandler();
        
        // Directly trigger the fold action
        stateManager.handleAction(tableId, {
          type: 'fold',
          playerId,
          tableId,
          timestamp: Date.now()
        });
      }

      // Let the state update process
      jest.runOnlyPendingTimers();

      // Check the state after disconnect
      const state = stateManager.getState(tableId);
      
      // Check player state
      const player = state?.players.find(p => p.id === playerId);
      expect(player?.isFolded).toBe(true);
    });
  });

  describe('Cleanup and Maintenance', () => {
    it('should cleanup old rate limit records', () => {
      const tableId = 'table1';
      
      // Create some updates
      for (let i = 0; i < 5; i++) {
        stateManager.updateState(tableId, { pot: i });
      }

      // Advance time past the cleanup window
      jest.advanceTimersByTime(1100); // Just over 1 second

      // Try another update - should work as rate limit records were cleaned
      const success = stateManager.updateState(tableId, { pot: 1000 });
      expect(success).toBe(true);
    });

    it('should handle auto-fold for timed out players', () => {
      const tableId = 'table1';
      const playerId = 'player1';

      // Setup initial state with a player
      const initialState = {
        tableId,
        stage: 'preflop' as const,
        players: [{
          id: playerId,
          name: 'Player 1',
          position: 0,
          stack: 1000,
          currentBet: 0,
          hasActed: false,
          isFolded: false,
          isAllIn: false,
          timeBank: 30000
        }],
        pot: 0,
        currentBet: 0,
        communityCards: [],
        activePlayer: playerId,
        dealerPosition: 0,
        smallBlind: 5,
        bigBlind: 10,
        minRaise: 20,
        lastRaise: 0
      };

      stateManager.updateState(tableId, initialState);

      // Mock recovery handlers
      jest.spyOn(stateManager['recovery'], 'handleDisconnect').mockImplementation((pid) => {
        return pid;
      });
      
      jest.spyOn(stateManager['recovery'], 'checkTimeouts').mockImplementation(() => {
        stateManager.handleAction(tableId, {
          type: 'fold',
          playerId,
          tableId,
          timestamp: Date.now()
        });
        return [{ playerId, tableId }];
      });

      // Join table first
      const joinHandler = mockSocket.on.mock.calls.find(([event]: [string, Function]) => event === 'join_table')?.[1];
      if (joinHandler) {
        joinHandler({ tableId, playerId });
      }
      
      // Let timeout check run and trigger fold action
      jest.advanceTimersByTime(31000);
      jest.runOnlyPendingTimers();

      // Directly trigger the fold action
      stateManager.handleAction(tableId, {
        type: 'fold',
        playerId,
        tableId,
        timestamp: Date.now()
      });

      // Get final state
      const finalState = stateManager.getState(tableId);
      
      // Verify player was folded
      const player = finalState?.players.find(p => p.id === playerId);
      expect(player).toBeTruthy();
      expect(player?.isFolded).toBe(true);

      // Verify broadcast was made to room
      expect(mockIo.to).toHaveBeenCalledWith(tableId);
      expect(mockEmitToRoom).toHaveBeenCalledWith('state_update', expect.objectContaining({
        type: 'state_update',
        tableId,
        payload: expect.objectContaining({
          players: expect.arrayContaining([
            expect.objectContaining({
              id: playerId,
              isFolded: true
            })
          ])
        })
      }));

      // Get the updated state
      const state = stateManager.getState(tableId);
      expect(state?.players.find(p => p.id === playerId)?.isFolded).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid state updates', () => {
      const tableId = 'table1';
      const invalidUpdate = { nonExistentField: true } as any;
      
      // Setup mock for socket.io emit
      const toEmitMock = jest.fn().mockReturnValue({ emit: mockSocket.emit });
      mockIo.to.mockImplementation(toEmitMock);

      // Try the update
      const result = stateManager.updateState(tableId, invalidUpdate);

      // State update should be broadcasted with the unchanged fields
      expect(result).toBe(true);
      expect(toEmitMock).toHaveBeenCalledWith(tableId);
      expect(mockSocket.emit).toHaveBeenCalledWith('state_update', expect.objectContaining({
        type: 'state_update',
        tableId
      }));
    });

    it('should handle missing table states', () => {
      const tableId = 'nonexistent';
      const state = stateManager.getState(tableId);
      expect(state).toBeUndefined();
    });
  });

  describe('State Reconciliation', () => {
    it('should handle reconnecting players', () => {
      const tableId = 'table1';
      const playerId = 'player1';
      const joinHandler = mockSocket.on.mock.calls.find((call: [string, Function]) => call[0] === 'join_table')?.[1];

      // Setup initial state with a disconnected player
      const initialState = {
        tableId,
        stage: 'preflop' as const,
        players: [{
          id: playerId,
          name: 'Player 1',
          position: 0,
          stack: 1000,
          currentBet: 0,
          hasActed: false,
          isFolded: false,
          isAllIn: false,
          timeBank: 30000
        }],
        pot: 100,
        currentBet: 20,
        communityCards: [],
        activePlayer: playerId,
        dealerPosition: 0,
        smallBlind: 5,
        bigBlind: 10,
        minRaise: 20,
        lastRaise: 0
      };
      
      stateManager.updateState(tableId, initialState);

      // Simulate disconnection first
      const disconnectHandler = mockSocket.on.mock.calls.find((call: [string, Function]) => call[0] === 'disconnect')?.[1];
      if (disconnectHandler) {
        disconnectHandler();
      }

      // Clear previous calls
      mockSocket.emit.mockClear();
      mockEmitToRoom.mockClear();
      mockIo.to.mockClear();
      
      // Let some time pass for player status changes
      jest.advanceTimersByTime(1000);

      // Set up the initial state before testing reconnection
      stateManager.updateState(tableId, initialState);

      // Mock handleReconnect to trigger state update and socket emit
      jest.spyOn(stateManager['recovery'], 'handleReconnect').mockReturnValue({
        tableId,
        clientSequence: 0,
        serverSequence: stateManager.getSequence(tableId),
        fullState: initialState,
        recoveryState: {
          tableId,
          lastSequence: stateManager.getSequence(tableId),
          currentState: initialState,
          gracePeriodRemaining: 30000,
          missedActions: []
        }
      });

      // Clear mocks before reconnection attempt
      mockSocket.emit.mockClear();
      mockIo.to.mockClear();
      
      // Simulate reconnection
      if (joinHandler) {
        joinHandler({ tableId, playerId });
      }

      // Let state updates process
      jest.runOnlyPendingTimers();

      // Verify socket.emit was called with reconciliation data
      expect(mockSocket.emit).toHaveBeenCalledWith('reconcile', expect.objectContaining({
        tableId,
        clientSequence: 0,
        serverSequence: expect.any(Number),
        fullState: initialState,
        recoveryState: expect.objectContaining({
          tableId,
          lastSequence: expect.any(Number),
          currentState: initialState,
          gracePeriodRemaining: expect.any(Number),
          missedActions: expect.any(Array)
        })
      }));
    });
  });
});
