import { StateManager } from '../state-manager/core';
import { StateManagerConfig } from '../state-manager/types';
import { TableState } from '../../types/poker';

// Mock the dependencies
jest.mock('../state-manager/sync', () => ({
  SyncManager: jest.fn().mockImplementation(() => ({
    startSyncInterval: jest.fn(),
    stopSyncInterval: jest.fn(),
    syncState: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../state-manager/optimistic', () => ({
  OptimisticManager: jest.fn().mockImplementation(() => ({
    applyOptimisticUpdate: jest.fn(),
    rollbackOptimisticUpdate: jest.fn()
  }))
}));

jest.mock('../state-manager/delta', () => ({
  DeltaManager: jest.fn().mockImplementation(() => ({
    calculateDelta: jest.fn().mockReturnValue({
      changes: [],
      from: 0,
      to: 1
    }),
    applyDelta: jest.fn().mockImplementation((_state, _delta) => ({}))
  }))
}));

jest.mock('../state-manager/conflict', () => ({
  ConflictManager: jest.fn().mockImplementation(() => ({
    detectConflicts: jest.fn().mockReturnValue([]),
    resolveConflict: jest.fn().mockResolvedValue(undefined)
  }))
}));

describe('StateManager (Core)', () => {
  let stateManager: StateManager;
  let config: StateManagerConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    
    config = {
      syncInterval: 1000,
      optimisticUpdates: true,
      retryAttempts: 3,
      retryDelay: 1000,
      batchSize: 10,
      conflictResolution: 'merge'
    };

    stateManager = new StateManager(config);
  });

  afterEach(() => {
    stateManager.destroy();
  });

  describe('constructor', () => {
    it('should initialize with empty state', () => {
      const state = stateManager.getState();
      expect(state).toEqual({});
    });

    it('should initialize with version 0', () => {
      expect(stateManager.getVersion()).toBe(0);
    });
  });

  describe('getState()', () => {
    it('should return the current state', () => {
      const state = stateManager.getState();
      expect(state).toBeDefined();
    });

    it('should return an object', () => {
      const state = stateManager.getState();
      expect(typeof state).toBe('object');
    });
  });

  describe('getVersion()', () => {
    it('should return a number', () => {
      const version = stateManager.getVersion();
      expect(typeof version).toBe('number');
    });

    it('should return 0 initially', () => {
      expect(stateManager.getVersion()).toBe(0);
    });
  });

  describe('updateState()', () => {
    it('should update the state', async () => {
      await stateManager.updateState({ pot: 100 });
      const state = stateManager.getState();
      expect(state.pot).toBe(100);
    });

    it('should increment version', async () => {
      const initialVersion = stateManager.getVersion();
      await stateManager.updateState({ pot: 100 });
      expect(stateManager.getVersion()).toBe(initialVersion + 1);
    });

    it('should merge with existing state', async () => {
      await stateManager.updateState({ pot: 100 });
      await stateManager.updateState({ activePlayer: 'player1' });
      const state = stateManager.getState();
      expect(state.pot).toBe(100);
      expect(state.activePlayer).toBe('player1');
    });
  });

  describe('destroy()', () => {
    it('should not throw when called', () => {
      expect(() => stateManager.destroy()).not.toThrow();
    });

    it('should handle being called multiple times', () => {
      expect(() => {
        stateManager.destroy();
        stateManager.destroy();
      }).not.toThrow();
    });
  });
});
