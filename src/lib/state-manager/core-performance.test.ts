import { StateManager } from './core';
import { StateManagerConfig, VersionedState } from './types';
import { Socket } from 'socket.io-client';
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

describe('StateManager (Core) - Performance Tests', () => {
  let stateManager: StateManager;
  let config: StateManagerConfig;
  let mockSocket: jest.Mocked<typeof Socket>;
  let mockSyncState: jest.Mock;
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
    const mockStartSyncInterval = jest.fn();
    mockSyncState = jest.fn().mockResolvedValue(undefined);
    const mockApplyOptimisticUpdate = jest.fn();
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

  describe('Performance for Large State Updates', () => {
    it('should handle large state objects efficiently', async () => {
      // Create a large state object
      const largeUpdate = {
        pot: 1000,
        players: Array(10).fill(0).map((_, i) => ({
          id: `player${i}`,
          name: `Player ${i}`,
          position: i,
          stack: 1000 - (i * 100),
          currentBet: i * 10,
          hasActed: i % 2 === 0,
          isFolded: i % 3 === 0,
          isAllIn: i % 5 === 0,
          timeBank: 30
        })),
        // Add more properties to make it large
        currentBet: 100,
        activePlayer: 'player1',
        dealer: 0,
        smallBlind: 10,
        bigBlind: 20,
        cards: ['As', 'Kd', '10c', '5h', '2s'],
        lastAction: {
          player: 'player1',
          action: 'bet',
          amount: 100
        }
      } as any;
      
      // Setup mock for large update
      mockCalculateDelta.mockReturnValueOnce({
        changes: [
          { 
            id: 'change1',
            type: 'update',
            path: ['pot'],
            value: 1000,
            timestamp: Date.now(),
            source: 'client',
            oldValue: 0, 
            newValue: 1000
          },
          { 
            id: 'change2',
            type: 'update',
            path: ['players'],
            value: largeUpdate.players,
            timestamp: Date.now(),
            source: 'client',
            oldValue: [], 
            newValue: largeUpdate.players
          },
          // More changes for other properties
          { 
            id: 'change3',
            type: 'update',
            path: ['roundName'],
            value: 'flop',
            timestamp: Date.now(),
            source: 'client',
            oldValue: '', 
            newValue: 'flop'
          }
        ],
        from: 0,
        to: 1
      });
      
      // Measure performance
      const startTime = performance.now();
      await stateManager.updateState(largeUpdate);
      const endTime = performance.now();
      
      // Performance assertions - these are not strict but help identify major regressions
      expect(endTime - startTime).toBeLessThan(500); // Should be very fast in a test environment
      
      // Verify the update was processed correctly
      expect(mockCalculateDelta).toHaveBeenCalledWith({}, largeUpdate);
    });

    it('should handle multiple rapid updates efficiently', async () => {
      // Setup for batch of updates
      const updates = Array(5).fill(0).map((_, i) => ({ 
        pot: 100 * (i + 1),
        currentBet: 20 * (i + 1)
      }));
      
      // Setup mocks for each update
      updates.forEach((_, index) => {
        mockCalculateDelta.mockReturnValueOnce({
          changes: [
            { 
              id: `change${index}1`,
              type: 'update',
              path: ['pot'],
              value: 100 * (index + 1),
              timestamp: Date.now(),
              source: 'client',
              oldValue: index === 0 ? 0 : 100 * index, 
              newValue: 100 * (index + 1)
            },
            { 
              id: `change${index}2`,
              type: 'update',
              path: ['currentBet'],
              value: 20 * (index + 1),
              timestamp: Date.now(),
              source: 'client',
              oldValue: index === 0 ? 0 : 20 * index, 
              newValue: 20 * (index + 1)
            }
          ],
          from: index,
          to: index + 1
        });
      });
      
      // Measure performance for batch of updates
      const startTime = performance.now();
      
      // Process updates in sequence
      for (const update of updates) {
        await stateManager.updateState(update);
      }
      
      const endTime = performance.now();
      
      // Performance assertions
      const averageTimePerUpdate = (endTime - startTime) / updates.length;
      expect(averageTimePerUpdate).toBeLessThan(100); // Each update should be fast
      
      // Verify all updates were processed
      expect(mockCalculateDelta).toHaveBeenCalledTimes(updates.length);
      expect(mockSyncState).toHaveBeenCalledTimes(updates.length);
    });
  });

  describe('Memory Usage', () => {
    it('should not accumulate reference cycles', async () => {
      // Make multiple updates to simulate potential memory leaks
      for (let i = 0; i < 10; i++) {
        mockCalculateDelta.mockReturnValueOnce({
          changes: [
            { 
              id: `change${i}`,
              type: 'update',
              path: ['pot'],
              value: i,
              timestamp: Date.now(),
              source: 'client',
              oldValue: i - 1, 
              newValue: i
            }
          ],
          from: i,
          to: i + 1
        });
        
        await stateManager.updateState({ pot: i } as any);
      }
      
      // While we can't easily test for memory leaks in Jest,
      // we can verify that the state is updated correctly and
      // that the version increments as expected
      expect(stateManager.getVersion()).toBe(10);
      
      // We can also verify that syncState is called the correct number of times
      expect(mockSyncState).toHaveBeenCalledTimes(10);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from temporary network issues', async () => {
      // First update - success
      await stateManager.updateState({ pot: 100 });
      expect(stateManager.getVersion()).toBe(1);
      
      // Mock the next sync to fail
      mockSyncState.mockRejectedValueOnce(new Error('Network error'));
      
      // Second update - should fail
      await expect(stateManager.updateState({ pot: 200 })).rejects.toThrow('Network error');
      expect(stateManager.getVersion()).toBe(1); // Version should not have incremented
      
      // Third update - should succeed again
      mockCalculateDelta.mockReturnValueOnce({
        changes: [
          { 
            id: 'change1',
            type: 'update',
            path: ['pot'],
            value: 300,
            timestamp: Date.now(),
            source: 'client',
            oldValue: 100, 
            newValue: 300
          }
        ],
        from: 1,
        to: 2
      });
      
      // Mock current state
      (stateManager as any).state.data = { pot: 100 };
      
      await stateManager.updateState({ pot: 300 });
      expect(stateManager.getVersion()).toBe(2);
      
      // Verify correct number of sync attempts
      expect(mockSyncState).toHaveBeenCalledTimes(3);
    });
  });
});
