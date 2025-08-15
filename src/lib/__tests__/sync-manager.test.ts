import { SyncManager } from '../state-manager/sync';
import { StateManagerConfig } from '../state-manager/types';
import { VersionedState } from '../state-manager/types';
import { TableState } from '../../types/poker';

describe('SyncManager', () => {
  let syncManager: SyncManager;
  let config: StateManagerConfig;
  let state: VersionedState<TableState>;
  let mockEmit: jest.Mock;

  beforeEach(() => {
    config = {
      syncInterval: 1000,
      optimisticUpdates: true,
      retryAttempts: 3,
      retryDelay: 1000,
      batchSize: 10,
      socket: null as any,
      conflictResolution: 'server'
    };

    state = {
      version: 0,
      timestamp: Date.now(),
      checksum: '',
      data: {} as TableState,
      changes: [],
      lastSync: Date.now()
    };

    const mockSocket = {
      emit: jest.fn().mockReturnValue(Promise.resolve({ success: true })),
      on: jest.fn(),
      id: 'test',
      nsp: '/',
      io: {},
      connected: true
    };
    config.socket = mockSocket as any;
    mockEmit = mockSocket.emit;

    syncManager = new SyncManager(config, state);
  });

  afterEach(() => {
    syncManager.stopSyncInterval();
    jest.restoreAllMocks();
  });

  describe('syncState', () => {
    it('should send state to server', async () => {
      await syncManager.syncState();

      expect(mockEmit).toHaveBeenCalledWith(
        'sync_request',
        expect.objectContaining({
          version: expect.any(Number),
          checksum: expect.any(String),
          pendingUpdates: expect.any(Array)
        })
      );
    });

    it('should retry on failure up to configured attempts', async () => {
      const error = new Error('Network error');
      mockEmit.mockRejectedValue(error);

      try {
        await syncManager.syncState();
        fail('Expected syncState to throw an error');
      } catch (e) {
        expect(e).toEqual(error);
        // Filter out sync_request calls and only count sync_attempt
        const syncAttemptCalls = mockEmit.mock.calls.filter(call => call[0] === 'sync_attempt');
        expect(syncAttemptCalls.length).toBe(config.retryAttempts - 1);
      }
    });

    it('should update lastSync timestamp on successful sync', async () => {
      const beforeSync = state.lastSync;
      await syncManager.syncState();
      expect(state.lastSync).toBeGreaterThan(beforeSync);
    });
  });

  describe('startSyncInterval', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start periodic sync', () => {
      syncManager.startSyncInterval();
      
      jest.advanceTimersByTime(config.syncInterval);
      expect(mockEmit).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(config.syncInterval);
      expect(mockEmit).toHaveBeenCalledTimes(2);
    });

    it('should not start multiple intervals', () => {
      syncManager.startSyncInterval();
      syncManager.startSyncInterval();
      
      jest.advanceTimersByTime(config.syncInterval);
      expect(mockEmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopSyncInterval', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should stop periodic sync', () => {
      syncManager.startSyncInterval();
      syncManager.stopSyncInterval();
      
      jest.advanceTimersByTime(config.syncInterval * 2);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
