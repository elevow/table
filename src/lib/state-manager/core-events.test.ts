import { StateManager } from './core';
import { StateManagerConfig, VersionedState } from './types';
import { TableState } from '../../types/poker';

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

describe('StateManager (Core) - State Update Tests', () => {
  let stateManager: StateManager;
  let config: StateManagerConfig;
  let mockSocket: any;
  let mockStartSyncInterval: jest.Mock;
  let mockSyncState: jest.Mock;
  let mockApplyOptimisticUpdate: jest.Mock;
  let mockCalculateDelta: jest.Mock;
  let mockApplyDelta: jest.Mock;

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

    // Setup mock methods for dependencies
    mockStartSyncInterval = jest.fn();
    mockSyncState = jest.fn().mockResolvedValue(undefined);
    mockApplyOptimisticUpdate = jest.fn();
    mockCalculateDelta = jest.fn().mockImplementation(() => ({
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
    }));
    mockApplyDelta = jest.fn().mockImplementation((state, delta) => {
      return { ...state, pot: 100 };
    });

    // Setup mock implementations for module imports
    const SyncManagerMock = jest.requireMock('./sync').SyncManager;
    SyncManagerMock.mockImplementation(() => ({
      startSyncInterval: mockStartSyncInterval,
      stopSyncInterval: jest.fn(),
      syncState: mockSyncState,
      handleSyncError: jest.fn(),
    }));

    const OptimisticManagerMock = jest.requireMock('./optimistic').OptimisticManager;
    OptimisticManagerMock.mockImplementation(() => ({
      applyOptimisticUpdate: mockApplyOptimisticUpdate,
      rollbackOptimisticUpdate: jest.fn(),
      handleUpdateRejection: jest.fn(),
    }));

    const DeltaManagerMock = jest.requireMock('./delta').DeltaManager;
    DeltaManagerMock.mockImplementation(() => ({
      calculateDelta: mockCalculateDelta,
      applyDelta: mockApplyDelta,
      findChangedPaths: jest.fn().mockReturnValue(['pot']),
      getValueAtPath: jest.fn(),
      setValueAtPath: jest.fn(),
    }));

    const ConflictManagerMock = jest.requireMock('./conflict').ConflictManager;
    ConflictManagerMock.mockImplementation(() => ({
      detectConflicts: jest.fn().mockReturnValue([]),
      resolveConflict: jest.fn(),
      handleConflict: jest.fn(),
      mergeValues: jest.fn(),
    }));

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

  describe('State Update Sequence', () => {
    it('should update state with correct version increments', async () => {
      // Initial state should have version 0
      expect(stateManager.getVersion()).toBe(0);
      
      // Update 1
      await stateManager.updateState({ pot: 100 });
      expect(stateManager.getVersion()).toBe(1);
      
      // Setup for second update
      mockCalculateDelta.mockReturnValueOnce({
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
        to: 2,
      });
      
      // Update 2
      await stateManager.updateState({ currentBet: 20 });
      expect(stateManager.getVersion()).toBe(2);
    });

    it('should maintain state history through multiple updates', async () => {
      // Update 1: Add pot
      await stateManager.updateState({ pot: 100 });
      
      // Get private state after first update
      const stateAfterUpdate1 = (stateManager as any).state.data;
      expect(stateAfterUpdate1).toEqual({ pot: 100 });
      
      // Setup for second update
      mockCalculateDelta.mockReturnValueOnce({
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
        to: 2,
      });
      
      // Mock the current state for the delta calculation
      (stateManager as any).state.data = { pot: 100 };
      
      // Update 2: Add currentBet
      await stateManager.updateState({ currentBet: 20 });
      
      // Update the mock implementation for the next state
      mockApplyDelta.mockReturnValueOnce({ pot: 100, currentBet: 20 });
      
      // Get private state after second update
      const stateAfterUpdate2 = (stateManager as any).state.data;
      
      // This now should include both updates
      expect(stateAfterUpdate2).toEqual({ pot: 100, currentBet: 20 });
    });
  });

  describe('Delta Calculation and Application', () => {
    it('should calculate deltas correctly between updates', async () => {
      // Update state
      await stateManager.updateState({ pot: 100 });
      
      // Verify delta calculation was called correctly
      expect(mockCalculateDelta).toHaveBeenCalledWith({}, { pot: 100 });
      
      // Setup for second update
      mockCalculateDelta.mockReturnValueOnce({
        changes: [{ 
          id: 'change1',
          type: 'update',
          path: ['pot'],
          value: 200,
          timestamp: Date.now(),
          source: 'client',
          oldValue: 100, 
          newValue: 200
        }],
        from: 1,
        to: 2,
      });
      
      // Mock current state
      (stateManager as any).state.data = { pot: 100 };
      
      // Second update
      await stateManager.updateState({ pot: 200 });
      
      // Verify delta calculation was called with correct states
      expect(mockCalculateDelta).toHaveBeenCalledWith({ pot: 100 }, { pot: 200 });
    });

    it('should apply deltas during rollback', async () => {
      // Mock syncState to throw error to trigger rollback
      mockSyncState.mockRejectedValueOnce(new Error('Network error'));
      
      // Enable optimistic updates
      config.optimisticUpdates = true;
      
      // Attempt update that will fail
      await expect(stateManager.updateState({ pot: 100 })).rejects.toThrow('Network error');
      
      // Verify delta was applied during rollback
      expect(mockApplyDelta).toHaveBeenCalled();
    });
  });

  describe('Optimistic Updates', () => {
    it('should not apply optimistic updates when disabled', async () => {
      // Disable optimistic updates
      config.optimisticUpdates = false;
      stateManager = new StateManager(config);
      
      // Update state
      await stateManager.updateState({ pot: 100 });
      
      // Verify optimistic update was not applied
      expect(mockApplyOptimisticUpdate).not.toHaveBeenCalled();
    });

    it('should apply optimistic updates when enabled', async () => {
      // Enable optimistic updates
      config.optimisticUpdates = true;
      
      // Update state
      await stateManager.updateState({ pot: 100 });
      
      // Verify optimistic update was applied
      expect(mockApplyOptimisticUpdate).toHaveBeenCalled();
    });
  });

  describe('State Checksum', () => {
    it('should calculate checksum after state updates', async () => {
      await stateManager.updateState({ pot: 100 });
      
      // Verify checksum was calculated
      const privateState = (stateManager as any).state;
      expect(privateState.checksum).toBe('mockedHash123');
      
      // Verify crypto hash was used correctly
      expect(require('crypto').createHash).toHaveBeenCalledWith('sha256');
      expect(require('crypto').createHash().update).toHaveBeenCalled();
      expect(require('crypto').createHash().digest).toHaveBeenCalledWith('hex');
    });
  });

  describe('Error Handling', () => {
    it('should throw errors from sync operations', async () => {
      // Mock syncState to throw error
      mockSyncState.mockRejectedValueOnce(new Error('Custom sync error'));
      
      // Verify error is thrown
      await expect(stateManager.updateState({ pot: 100 })).rejects.toThrow('Custom sync error');
    });

    it('should rollback state version on error', async () => {
      // Get initial version
      const initialVersion = stateManager.getVersion();
      
      // Mock syncState to throw error
      mockSyncState.mockRejectedValueOnce(new Error('Network error'));
      
      // Attempt update that will fail
      await expect(stateManager.updateState({ pot: 100 })).rejects.toThrow('Network error');
      
      // Verify version was rolled back
      expect(stateManager.getVersion()).toBe(initialVersion);
    });
  });

  describe('Complex State Updates', () => {
    it('should handle nested object updates', async () => {
      // Setup complex delta
      mockCalculateDelta.mockReturnValueOnce({
        changes: [
          { 
            id: 'change1',
            type: 'update',
            path: ['players', '0', 'stack'],
            value: 900,
            timestamp: Date.now(),
            source: 'client',
            oldValue: 1000, 
            newValue: 900
          },
          { 
            id: 'change2',
            type: 'update',
            path: ['players', '0', 'hasActed'],
            value: true,
            timestamp: Date.now(),
            source: 'client',
            oldValue: false, 
            newValue: true
          }
        ],
        from: 0,
        to: 1
      });
      
      // Update with nested object
      const update: Partial<TableState> = {
        players: [
          {
            id: 'player1',
            name: 'Player 1',
            position: 0,
            stack: 900,
            currentBet: 0,
            hasActed: true,
            isFolded: false,
            isAllIn: false,
            timeBank: 30
          }
        ]
      };
      
      await stateManager.updateState(update);
      
      // Verify delta was calculated correctly
      expect(mockCalculateDelta).toHaveBeenCalledWith({}, update);
    });
  });
});
