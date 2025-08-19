import { StateManager } from '../core';
import { StateManagerConfig, VersionedState } from '../types';
import { Socket } from 'socket.io-client';
import { TableState } from '../../../types/poker';
import { StateDelta, StateConflict } from '../../../types/state-sync';

// Mock dependencies
jest.mock('socket.io-client');
jest.mock('../sync');
jest.mock('../optimistic');
jest.mock('../delta');
jest.mock('../conflict');
jest.mock('crypto', () => ({
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('mockedHash123')
  })
}));

describe('StateManager (Core) - Extended Tests', () => {
  let stateManager: StateManager;
  let config: StateManagerConfig;
  let mockSocket: jest.Mocked<typeof Socket>;
  let mockStartSyncInterval: jest.Mock;
  let mockStopSyncInterval: jest.Mock;
  let mockSyncState: jest.Mock;
  let mockApplyOptimisticUpdate: jest.Mock;
  let mockRollbackOptimisticUpdate: jest.Mock;
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
    } as any;

    // Setup mock methods for dependencies
    mockStartSyncInterval = jest.fn();
    mockStopSyncInterval = jest.fn();
    mockSyncState = jest.fn().mockResolvedValue(undefined);
    mockApplyOptimisticUpdate = jest.fn();
    mockRollbackOptimisticUpdate = jest.fn();
    mockCalculateDelta = jest.fn().mockImplementation(() => ({
      changes: [{ path: 'pot', oldValue: 0, newValue: 100, timestamp: Date.now() }],
      from: 0,
      to: 1,
    }));
    mockApplyDelta = jest.fn().mockImplementation((state, delta) => {
      return { ...state, pot: 100 };
    });

    // Setup mock implementations for module imports
    const SyncManagerMock = jest.requireMock('../sync').SyncManager;
    SyncManagerMock.mockImplementation(() => ({
      startSyncInterval: mockStartSyncInterval,
      stopSyncInterval: mockStopSyncInterval,
      syncState: mockSyncState,
      handleSyncError: jest.fn(),
    }));

    const OptimisticManagerMock = jest.requireMock('../optimistic').OptimisticManager;
    OptimisticManagerMock.mockImplementation(() => ({
      applyOptimisticUpdate: mockApplyOptimisticUpdate,
      rollbackOptimisticUpdate: mockRollbackOptimisticUpdate,
      handleUpdateRejection: jest.fn(),
    }));

    const DeltaManagerMock = jest.requireMock('../delta').DeltaManager;
    DeltaManagerMock.mockImplementation(() => ({
      calculateDelta: mockCalculateDelta,
      applyDelta: mockApplyDelta,
      findChangedPaths: jest.fn().mockReturnValue(['pot']),
      getValueAtPath: jest.fn(),
      setValueAtPath: jest.fn(),
    }));

    const ConflictManagerMock = jest.requireMock('../conflict').ConflictManager;
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

  describe('Initialization', () => {
    it('should initialize with correct dependencies', () => {
      expect(mockStartSyncInterval).toHaveBeenCalledTimes(1);
    });

    it('should initialize with empty state', () => {
      expect(stateManager.getState()).toEqual({});
      expect(stateManager.getVersion()).toBe(0);
    });

    it('should initialize with timestamp and checksum', () => {
      // Use reflection to access private property
      const privateState = (stateManager as any).state as VersionedState<TableState>;
      expect(privateState.timestamp).toBeDefined();
      expect(privateState.checksum).toBe('');
      expect(privateState.changes).toEqual([]);
      expect(privateState.lastSync).toBeDefined();
    });
  });

  describe('State Updates with Optimistic Updates', () => {
    beforeEach(() => {
      config.optimisticUpdates = true;
    });

    it('should calculate delta and apply optimistic update', async () => {
      const update: Partial<TableState> = { pot: 100 };
      
      await stateManager.updateState(update);
      
      expect(mockCalculateDelta).toHaveBeenCalledWith({}, { pot: 100 });
      expect(mockApplyOptimisticUpdate).toHaveBeenCalled();
      expect(mockSyncState).toHaveBeenCalled();
    });

    it('should update state version, timestamp, and checksum', async () => {
      const update: Partial<TableState> = { pot: 100 };
      const initialState = (stateManager as any).state;
      const initialVersion = initialState.version;
      const initialTimestamp = initialState.timestamp;
      
      await stateManager.updateState(update);
      
      const updatedState = (stateManager as any).state;
      expect(updatedState.version).toBe(initialVersion + 1);
      expect(updatedState.timestamp).toBeGreaterThanOrEqual(initialTimestamp);
      expect(updatedState.checksum).toBe('mockedHash123');
    });

    it('should rollback on error with optimistic updates enabled', async () => {
      const update: Partial<TableState> = { pot: 100 };
      mockSyncState.mockRejectedValueOnce(new Error('Network error'));
      
      await expect(stateManager.updateState(update)).rejects.toThrow('Network error');
      
      expect(mockRollbackOptimisticUpdate).toHaveBeenCalled();
      expect(mockApplyDelta).toHaveBeenCalled();
    });
  });

  describe('State Updates without Optimistic Updates', () => {
    beforeEach(() => {
      config.optimisticUpdates = false;
      stateManager = new StateManager(config);
    });

    it('should not apply optimistic update when disabled', async () => {
      const update: Partial<TableState> = { pot: 100 };
      
      await stateManager.updateState(update);
      
      expect(mockApplyOptimisticUpdate).not.toHaveBeenCalled();
      expect(mockSyncState).toHaveBeenCalled();
    });

    it('should not rollback on error when optimistic updates disabled', async () => {
      const update: Partial<TableState> = { pot: 100 };
      mockSyncState.mockRejectedValueOnce(new Error('Network error'));
      
      await expect(stateManager.updateState(update)).rejects.toThrow('Network error');
      
      expect(mockRollbackOptimisticUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Checksum Calculation', () => {
    it('should calculate checksum correctly', async () => {
      const update: Partial<TableState> = { pot: 100 };
      
      await stateManager.updateState(update);
      
      // Check that private calculateChecksum was called
      expect(require('crypto').createHash).toHaveBeenCalledWith('sha256');
      expect(require('crypto').createHash().update).toHaveBeenCalledWith(expect.any(String));
      expect(require('crypto').createHash().digest).toHaveBeenCalledWith('hex');
    });

    it('should store calculated checksum in state', async () => {
      const update: Partial<TableState> = { pot: 100 };
      
      await stateManager.updateState(update);
      
      const privateState = (stateManager as any).state as VersionedState<TableState>;
      expect(privateState.checksum).toBe('mockedHash123');
    });
  });

  describe('Cleanup and Resource Management', () => {
    it('should call stopSyncInterval on destroy', () => {
      stateManager.destroy();
      
      expect(mockStopSyncInterval).toHaveBeenCalledTimes(1);
    });

    it('should allow multiple destroy calls without errors', () => {
      stateManager.destroy();
      stateManager.destroy();
      
      expect(mockStopSyncInterval).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty updates', async () => {
      const emptyUpdate: Partial<TableState> = {};
      
      mockCalculateDelta.mockReturnValueOnce({
        changes: [],
        from: 0,
        to: 0
      });
      
      await stateManager.updateState(emptyUpdate);
      
      expect(mockCalculateDelta).toHaveBeenCalledWith({}, {});
      expect(mockApplyOptimisticUpdate).toHaveBeenCalled();
      expect(mockSyncState).toHaveBeenCalled();
    });

    it('should handle null/undefined values in updates', async () => {
      const nullUpdate: Partial<TableState> = {
        activePlayer: null as any
      };
      
      mockCalculateDelta.mockReturnValueOnce({
        changes: [
          { path: 'activePlayer', oldValue: '', newValue: null, timestamp: Date.now() }
        ],
        from: 0,
        to: 1
      });
      
      await stateManager.updateState(nullUpdate);
      
      expect(mockCalculateDelta).toHaveBeenCalledWith({}, nullUpdate);
      expect(mockApplyOptimisticUpdate).toHaveBeenCalled();
    });
    
    it('should handle updating the same property multiple times', async () => {
      // First update
      await stateManager.updateState({ pot: 100 });
      
      // Mock getting the current state
      (stateManager as any).state.data = { pot: 100 };
      
      // Setup delta for second update
      mockCalculateDelta.mockReturnValueOnce({
        changes: [
          { path: 'pot', oldValue: 100, newValue: 200, timestamp: Date.now() }
        ],
        from: 1,
        to: 2
      });
      
      // Second update to the same property
      await stateManager.updateState({ pot: 200 });
      
      expect(mockCalculateDelta).toHaveBeenCalledWith({ pot: 100 }, { pot: 200 });
      expect(mockApplyOptimisticUpdate).toHaveBeenCalledTimes(2);
    });
  });
});
