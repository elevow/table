import { StateManager } from './core';
import { StateManagerConfig } from './types';
import { TableState } from '../../types/poker';
import { StateDelta } from '../../types/state-sync';

// Mock dependencies
jest.mock('socket.io-client');
jest.mock('./sync');
jest.mock('./optimistic');
jest.mock('./delta');
jest.mock('./conflict');
jest.mock('crypto', () => ({
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('mockedHash123')
  })
}));

describe('StateManager (Core) - Integration Tests', () => {
  let stateManager: StateManager;
  let config: StateManagerConfig;
  let mockSocket: any;
  let mockSyncManager: any;
  let mockOptimisticManager: any;
  let mockDeltaManager: any;
  let mockConflictManager: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock socket
    mockSocket = {
      on: jest.fn(),
      emit: jest.fn().mockReturnThis(),
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    // Setup mock methods
    mockSyncManager = {
      startSyncInterval: jest.fn(),
      stopSyncInterval: jest.fn(),
      syncState: jest.fn().mockResolvedValue(undefined),
      handleSyncError: jest.fn(),
    };

    mockOptimisticManager = {
      applyOptimisticUpdate: jest.fn(),
      rollbackOptimisticUpdate: jest.fn(),
      handleUpdateRejection: jest.fn(),
    };

    mockDeltaManager = {
      calculateDelta: jest.fn().mockImplementation(() => ({
        changes: [{ 
          id: 'change1',
          type: 'update',
          path: ['pot'],
          value: 100,
          timestamp: Date.now(),
          source: 'client',
          oldValue: 0, 
          newValue: 100
        }],
        from: 0,
        to: 1,
      })),
      applyDelta: jest.fn().mockImplementation((state, delta) => {
        return { ...state, pot: 100 };
      }),
      findChangedPaths: jest.fn().mockReturnValue(['pot']),
      getValueAtPath: jest.fn(),
      setValueAtPath: jest.fn(),
    };

    mockConflictManager = {
      detectConflicts: jest.fn().mockReturnValue([]),
      resolveConflict: jest.fn(),
      handleConflict: jest.fn(),
      mergeValues: jest.fn(),
    };

    // Setup mock implementations for class constructors
    const SyncManagerMock = jest.requireMock('./sync').SyncManager;
    SyncManagerMock.mockImplementation(() => mockSyncManager);

    const OptimisticManagerMock = jest.requireMock('./optimistic').OptimisticManager;
    OptimisticManagerMock.mockImplementation(() => mockOptimisticManager);

    const DeltaManagerMock = jest.requireMock('./delta').DeltaManager;
    DeltaManagerMock.mockImplementation(() => mockDeltaManager);

    const ConflictManagerMock = jest.requireMock('./conflict').ConflictManager;
    ConflictManagerMock.mockImplementation(() => mockConflictManager);

    // Setup config
    config = {
      socket: mockSocket,
      syncInterval: 5000,
      retryDelay: 1000,
      retryAttempts: 3,
      batchSize: 10,
      optimisticUpdates: true,
      conflictResolution: 'merge'
    };

    // Create state manager instance
    stateManager = new StateManager(config);
  });

  afterEach(() => {
    stateManager.destroy();
  });

  describe('Integration with SyncManager', () => {
    it('should start sync interval on initialization', () => {
      expect(mockSyncManager.startSyncInterval).toHaveBeenCalledTimes(1);
    });

    it('should stop sync interval on destroy', () => {
      stateManager.destroy();
      expect(mockSyncManager.stopSyncInterval).toHaveBeenCalledTimes(1);
    });

    it('should call syncState when updating state', async () => {
      await stateManager.updateState({ pot: 100 });
      expect(mockSyncManager.syncState).toHaveBeenCalledTimes(1);
    });

    it('should handle syncState errors correctly', async () => {
      mockSyncManager.syncState.mockRejectedValueOnce(new Error('Sync error'));
      
      await expect(stateManager.updateState({ pot: 100 })).rejects.toThrow('Sync error');
    });
  });

  describe('Integration with OptimisticManager', () => {
    it('should apply optimistic update when enabled', async () => {
      config.optimisticUpdates = true;
      
      await stateManager.updateState({ pot: 100 });
      
      expect(mockOptimisticManager.applyOptimisticUpdate).toHaveBeenCalledTimes(1);
    });

    it('should rollback optimistic update on error', async () => {
      config.optimisticUpdates = true;
      mockSyncManager.syncState.mockRejectedValueOnce(new Error('Sync error'));
      
      await expect(stateManager.updateState({ pot: 100 })).rejects.toThrow('Sync error');
      
      expect(mockOptimisticManager.rollbackOptimisticUpdate).toHaveBeenCalledTimes(1);
    });

    it('should not apply optimistic update when disabled', async () => {
      // Create a new state manager with optimistic updates disabled
      config.optimisticUpdates = false;
      const newStateManager = new StateManager(config);
      
      await newStateManager.updateState({ pot: 100 });
      
      expect(mockOptimisticManager.applyOptimisticUpdate).not.toHaveBeenCalled();
      
      newStateManager.destroy();
    });
  });

  describe('Integration with DeltaManager', () => {
    it('should calculate delta when updating state', async () => {
      await stateManager.updateState({ pot: 100 });
      
      expect(mockDeltaManager.calculateDelta).toHaveBeenCalledWith({}, { pot: 100 });
    });

    it('should apply delta during rollback', async () => {
      config.optimisticUpdates = true;
      mockSyncManager.syncState.mockRejectedValueOnce(new Error('Sync error'));
      
      await expect(stateManager.updateState({ pot: 100 })).rejects.toThrow('Sync error');
      
      expect(mockDeltaManager.applyDelta).toHaveBeenCalled();
    });

    it('should correctly increment version based on delta', async () => {
      // Mock delta to increment from version 0 to 1
      mockDeltaManager.calculateDelta.mockReturnValueOnce({
        changes: [{ 
          id: 'change1',
          type: 'update',
          path: ['pot'],
          value: 100,
          timestamp: Date.now(),
          source: 'client',
          oldValue: 0, 
          newValue: 100
        }],
        from: 0,
        to: 1
      });
      
      await stateManager.updateState({ pot: 100 });
      expect(stateManager.getVersion()).toBe(1);
      
      // Mock delta to increment from version 1 to 2
      mockDeltaManager.calculateDelta.mockReturnValueOnce({
        changes: [{ 
          id: 'change2',
          type: 'update',
          path: ['currentBet'],
          value: 20,
          timestamp: Date.now(),
          source: 'client',
          oldValue: 0, 
          newValue: 20
        }],
        from: 1,
        to: 2
      });
      
      await stateManager.updateState({ currentBet: 20 });
      expect(stateManager.getVersion()).toBe(2);
    });
  });

  describe('Integration with ConflictManager', () => {
    it('should initialize ConflictManager with correct config', () => {
      // Create a new state manager to verify constructor args
      const ConflictManagerMock = jest.requireMock('./conflict').ConflictManager;
      ConflictManagerMock.mockClear();
      
      const newStateManager = new StateManager(config);
      
      expect(ConflictManagerMock).toHaveBeenCalledWith(expect.any(Object), config);
      
      newStateManager.destroy();
    });

    it('should handle conflicts during state updates', async () => {
      // Mock conflicts detection to simulate conflict
      const mockConflict = {
        clientVersion: 1,
        serverVersion: 1,
        conflictType: 'merge' as const,
        resolution: 'server' as const,
        path: 'pot',
        clientValue: 100,
        serverValue: 150,
        resolvedValue: 150
      };
      
      mockConflictManager.detectConflicts.mockReturnValueOnce([mockConflict]);
      mockConflictManager.resolveConflict.mockReturnValueOnce(150); // Resolve to remote value
      
      // Mock a server response with conflict
      const serverResponse: StateDelta = {
        changes: [
          { 
            id: 'change1',
            type: 'update',
            path: ['pot'],
            value: 150,
            timestamp: Date.now(),
            source: 'server',
            oldValue: 0, 
            newValue: 150
          }
        ],
        from: 0,
        to: 1
      };
      
      // Simulate sync response with server delta
      mockSyncManager.syncState.mockImplementationOnce(async () => {
        // Simulate receiving server response
        const syncHandler = (stateManager as any).handleServerSync;
        if (syncHandler) {
          syncHandler(serverResponse);
        }
        return Promise.resolve();
      });
      
      await stateManager.updateState({ pot: 100 });
      
      // Verify conflict detection was attempted
      expect(mockConflictManager.detectConflicts).toHaveBeenCalled();
    });
  });

  describe('Complex State Update Scenarios', () => {
    it('should handle complex nested state updates', async () => {
      // Create a complex update
      const complexUpdate: Partial<TableState> = {
        pot: 100,
        currentBet: 20,
        players: [
          {
            id: 'player1',
            name: 'Player 1',
            position: 0,
            stack: 1000,
            currentBet: 20,
            hasActed: true,
            isFolded: false,
            isAllIn: false,
            timeBank: 30
          }
        ]
      };
      
      // Mock delta calculation for complex update
      mockDeltaManager.calculateDelta.mockReturnValueOnce({
        changes: [
          { 
            id: 'change1',
            type: 'update',
            path: ['pot'],
            value: 100,
            timestamp: Date.now(),
            source: 'client',
            oldValue: 0, 
            newValue: 100
          },
          { 
            id: 'change2',
            type: 'update',
            path: ['currentBet'],
            value: 20,
            timestamp: Date.now(),
            source: 'client',
            oldValue: 0, 
            newValue: 20
          },
          { 
            id: 'change3',
            type: 'update',
            path: ['players'],
            value: complexUpdate.players,
            timestamp: Date.now(),
            source: 'client',
            oldValue: undefined, 
            newValue: complexUpdate.players
          }
        ],
        from: 0,
        to: 1
      });
      
      await stateManager.updateState(complexUpdate);
      
      expect(mockDeltaManager.calculateDelta).toHaveBeenCalledWith({}, complexUpdate);
      expect(mockSyncManager.syncState).toHaveBeenCalled();
    });

    it('should handle multiple consecutive updates', async () => {
      // First update
      await stateManager.updateState({ pot: 100 });
      
      // Mock current state after first update
      (stateManager as any).state.data = { pot: 100 };
      
      // Setup for second update
      mockDeltaManager.calculateDelta.mockReturnValueOnce({
        changes: [{ 
          id: 'change1',
          type: 'update',
          path: ['currentBet'],
          value: 20,
          timestamp: Date.now(),
          source: 'client',
          oldValue: 0, 
          newValue: 20
        }],
        from: 1,
        to: 2
      });
      
      // Second update
      await stateManager.updateState({ currentBet: 20 });
      
      // Mock current state after second update
      (stateManager as any).state.data = { pot: 100, currentBet: 20 };
      
      // Setup for third update
      mockDeltaManager.calculateDelta.mockReturnValueOnce({
        changes: [
          { 
            id: 'change1',
            type: 'update',
            path: ['players'],
            value: [{ id: 'player1', stack: 1000 }],
            timestamp: Date.now(),
            source: 'client',
            oldValue: undefined, 
            newValue: [{ id: 'player1', stack: 1000 }]
          }
        ],
        from: 2,
        to: 3
      });
      
      // Third update
      await stateManager.updateState({ 
        players: [{ 
          id: 'player1', 
          stack: 1000,
          name: 'Player 1',
          position: 0,
          currentBet: 0,
          hasActed: false,
          isFolded: false,
          isAllIn: false,
          timeBank: 30
        }] 
      });
      
      // Verify all updates were processed
      expect(mockDeltaManager.calculateDelta).toHaveBeenCalledTimes(3);
      expect(mockSyncManager.syncState).toHaveBeenCalledTimes(3);
    });
  });
});
