import { ClientStateManager } from '../client-state-manager';
import { TableState } from '../../types/poker';
import { StateUpdate, StateReconciliation } from '../../types/state-update';

// Mock socket interface
type MockSocket = {
  on: jest.Mock;
  emit: jest.Mock;
  connect: jest.Mock;
};

function createMockSocket(): MockSocket {
  return {
    on: jest.fn(),
    emit: jest.fn(),
    connect: jest.fn()
  };
}

describe('ClientStateManager', () => {
  let mockSocket: MockSocket;
  let onStateChange: jest.Mock;
  let clientStateManager: ClientStateManager;
  let socketHandlers: Map<string, Function>;

  beforeEach(() => {
    mockSocket = createMockSocket();
    onStateChange = jest.fn();
    socketHandlers = new Map();
    
    // Capture socket event handlers
    mockSocket.on.mockImplementation((event: string, handler: Function) => {
      socketHandlers.set(event, handler);
      return mockSocket;
    });

    clientStateManager = new ClientStateManager(mockSocket, onStateChange);
  });

  describe('constructor', () => {
    it('should setup socket handlers', () => {
      expect(mockSocket.on).toHaveBeenCalledWith('state_update', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('reconcile', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('connect_error', expect.any(Function));
    });
  });

  describe('getState()', () => {
    it('should return null initially', () => {
      expect(clientStateManager.getState()).toBeNull();
    });

    it('should return state after update', () => {
      const update: StateUpdate = {
        sequence: 1,
        payload: { pot: 100, tableId: 'table-1' } as Partial<TableState>
      };
      
      const handler = socketHandlers.get('state_update');
      handler?.(update);
      
      const state = clientStateManager.getState();
      expect(state?.pot).toBe(100);
    });
  });

  describe('getSequence()', () => {
    it('should return 0 initially', () => {
      expect(clientStateManager.getSequence()).toBe(0);
    });

    it('should return updated sequence after state update', () => {
      // Sequence must increment by 1 from current (0 -> 1)
      const update: StateUpdate = {
        sequence: 1,
        payload: { pot: 100 } as Partial<TableState>
      };
      
      const handler = socketHandlers.get('state_update');
      handler?.(update);
      
      expect(clientStateManager.getSequence()).toBe(1);
    });
  });

  describe('state_update handler', () => {
    it('should update state on valid update', () => {
      const update: StateUpdate = {
        sequence: 1,
        payload: { pot: 100 } as Partial<TableState>
      };
      
      const handler = socketHandlers.get('state_update');
      handler?.(update);
      
      expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ pot: 100 }));
    });

    it('should ignore old sequence updates', () => {
      // First, set up sequence to 5
      const firstUpdate: StateUpdate = {
        sequence: 5,
        payload: { pot: 100 } as Partial<TableState>
      };
      const handler = socketHandlers.get('state_update');
      handler?.(firstUpdate);
      
      onStateChange.mockClear();
      
      // Send an old update with lower sequence
      const oldUpdate: StateUpdate = {
        sequence: 3,
        payload: { pot: 200 } as Partial<TableState>
      };
      handler?.(oldUpdate);
      
      expect(onStateChange).not.toHaveBeenCalled();
    });

    it('should request reconciliation if sequence gap detected', () => {
      const update: StateUpdate = {
        sequence: 5, // Gap since we start at 0
        payload: { pot: 100 } as Partial<TableState>
      };
      
      const handler = socketHandlers.get('state_update');
      handler?.(update);
      
      expect(mockSocket.emit).toHaveBeenCalledWith('request_reconciliation', expect.any(Object));
    });
  });

  describe('reconcile handler', () => {
    it('should reset state from reconciliation', () => {
      const reconciliation: StateReconciliation = {
        fullState: { pot: 500, tableId: 'table-1' } as TableState,
        serverSequence: 10
      };
      
      const handler = socketHandlers.get('reconcile');
      handler?.(reconciliation);
      
      expect(clientStateManager.getState()?.pot).toBe(500);
      expect(clientStateManager.getSequence()).toBe(10);
    });
  });

  describe('connect handler', () => {
    it('should request reconciliation on connect', () => {
      // First set some state
      const update: StateUpdate = {
        sequence: 1,
        payload: { pot: 100, tableId: 'table-1' } as Partial<TableState>
      };
      const updateHandler = socketHandlers.get('state_update');
      updateHandler?.(update);
      
      mockSocket.emit.mockClear();
      
      const connectHandler = socketHandlers.get('connect');
      connectHandler?.();
      
      expect(mockSocket.emit).toHaveBeenCalledWith('request_reconciliation', expect.any(Object));
    });
  });

  describe('disconnect handler', () => {
    it('should attempt reconnect on disconnect', () => {
      jest.useFakeTimers();
      
      const handler = socketHandlers.get('disconnect');
      handler?.();
      
      jest.advanceTimersByTime(1000);
      
      expect(mockSocket.connect).toHaveBeenCalled();
      
      jest.useRealTimers();
    });
  });

  describe('connect_error handler', () => {
    it('should attempt reconnect on error', () => {
      const handler = socketHandlers.get('connect_error');
      handler?.(new Error('Connection failed'));
      
      expect(mockSocket.connect).toHaveBeenCalled();
    });

    it('should stop reconnecting after max attempts', () => {
      const handler = socketHandlers.get('connect_error');
      
      // Simulate multiple connection errors
      for (let i = 0; i < 6; i++) {
        handler?.(new Error('Connection failed'));
      }
      
      // After max attempts, should not try to reconnect again
      const connectCalls = mockSocket.connect.mock.calls.length;
      handler?.(new Error('Connection failed'));
      
      expect(mockSocket.connect.mock.calls.length).toBe(connectCalls);
    });
  });

  describe('optimisticUpdate()', () => {
    it('should apply optimistic update', () => {
      clientStateManager.optimisticUpdate({ pot: 100 });
      expect(clientStateManager.getState()?.pot).toBe(100);
    });

    it('should notify state change', () => {
      clientStateManager.optimisticUpdate({ pot: 100 });
      expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ pot: 100 }));
    });

    it('should merge with existing state', () => {
      clientStateManager.optimisticUpdate({ pot: 100 });
      clientStateManager.optimisticUpdate({ activePlayer: 'player-1' });
      
      const state = clientStateManager.getState();
      expect(state?.pot).toBe(100);
      expect(state?.activePlayer).toBe('player-1');
    });
  });
});
