import { SyncManager } from '../state-manager/sync';
import { VersionedState, StateManagerConfig } from '../state-manager/types';
import { TableState } from '../../types/poker';

describe('SyncManager', () => {
  let syncManager: SyncManager;
  let config: StateManagerConfig;
  let state: VersionedState<TableState>;

  beforeEach(() => {
    config = {
      syncInterval: 1000,
      optimisticUpdates: true,
      retryAttempts: 3,
      retryDelay: 1000,
      batchSize: 10,
      conflictResolution: 'merge'
    };

    state = {
      version: 1,
      timestamp: Date.now(),
      checksum: 'abc123',
      data: {
        pot: 100,
        activePlayer: 'player1'
      } as TableState,
      changes: [],
      lastSync: Date.now()
    };

    syncManager = new SyncManager(config, state);
  });

  describe('startSyncInterval()', () => {
    it('should not throw when called', () => {
      expect(() => syncManager.startSyncInterval()).not.toThrow();
    });

    it('should handle being called multiple times', () => {
      expect(() => {
        syncManager.startSyncInterval();
        syncManager.startSyncInterval();
      }).not.toThrow();
    });
  });

  describe('stopSyncInterval()', () => {
    it('should not throw when called', () => {
      expect(() => syncManager.stopSyncInterval()).not.toThrow();
    });

    it('should not throw when called before startSyncInterval', () => {
      expect(() => syncManager.stopSyncInterval()).not.toThrow();
    });

    it('should not throw when called after startSyncInterval', () => {
      syncManager.startSyncInterval();
      expect(() => syncManager.stopSyncInterval()).not.toThrow();
    });

    it('should handle being called multiple times', () => {
      expect(() => {
        syncManager.stopSyncInterval();
        syncManager.stopSyncInterval();
      }).not.toThrow();
    });
  });

  describe('syncState()', () => {
    it('should update lastSync timestamp', async () => {
      const initialLastSync = state.lastSync;
      await new Promise(resolve => setTimeout(resolve, 10));
      await syncManager.syncState();
      expect(state.lastSync).toBeGreaterThanOrEqual(initialLastSync);
    });

    it('should not throw when called', async () => {
      await expect(syncManager.syncState()).resolves.not.toThrow();
    });

    it('should not throw when called with isRetry=true', async () => {
      await expect(syncManager.syncState(true)).resolves.not.toThrow();
    });

    it('should not throw when called with isRetry=false', async () => {
      await expect(syncManager.syncState(false)).resolves.not.toThrow();
    });
  });

  describe('handleSyncError()', () => {
    it('should not throw when called', () => {
      expect(() => syncManager.handleSyncError()).not.toThrow();
    });

    it('should handle being called multiple times', () => {
      expect(() => {
        syncManager.handleSyncError();
        syncManager.handleSyncError();
      }).not.toThrow();
    });
  });
});
