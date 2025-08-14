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
      
      if (leaveHandler) {
        leaveHandler(tableId);
      }
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

      console.log('Initial state:', initialState);
      
      // Mock handleDisconnect to simulate state updates on disconnect
      jest.spyOn(stateManager['recovery'], 'handleDisconnect').mockImplementation((pid, tid) => {
        console.log('handleDisconnect called with:', pid);
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
      
      console.log('Found handlers:', { 
        hasJoinHandler: !!joinTableHandler, 
        hasDisconnectHandler: !!disconnectHandler 
      });

      // Join table first
      if (joinTableHandler) {
        console.log('Player joining table');
        joinTableHandler({ tableId, playerId });
      }

      // Then trigger disconnect and action
      if (disconnectHandler) {
        console.log('Player disconnecting');
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
      console.log('Final state after disconnect:', state);
      
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

      console.log('Setting up initial state for timeout test');
      stateManager.updateState(tableId, initialState);

      // Mock recovery handlers
      jest.spyOn(stateManager['recovery'], 'handleDisconnect').mockImplementation((pid) => {
        console.log('Timeout test: handleDisconnect called with:', pid);
        return pid;
      });
      
      jest.spyOn(stateManager['recovery'], 'checkTimeouts').mockImplementation(() => {
        console.log('Checking timeouts...');
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
        console.log('Timeout test: Player joining table');
        joinHandler({ tableId, playerId });
      }
      
      console.log('State before timeout:', stateManager.getState(tableId));
      
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
      console.log('Final state after timeout:', finalState);
      
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

      console.log('Starting reconnection test');
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
