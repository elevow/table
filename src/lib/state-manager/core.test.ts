import { StateManager } from './core';
import { StateManagerConfig } from './types';
import { Socket } from 'socket.io-client';
import { TableState } from '../../types/poker';

jest.mock('socket.io-client');

describe('StateManager', () => {
  let stateManager: StateManager;
  let config: StateManagerConfig;
  let mockSocket: jest.Mocked<typeof Socket>;

  beforeEach(() => {
    mockSocket = {
      on: jest.fn(),
      emit: jest.fn().mockReturnThis(),
      connect: jest.fn(),
      disconnect: jest.fn(),
    } as any;

    config = {
      socket: mockSocket,
      syncInterval: 5000,
      retryDelay: 1000,
      retryAttempts: 3,
      batchSize: 10,
      optimisticUpdates: true,
      conflictResolution: 'merge'
    };

    stateManager = new StateManager(config);
  });

  afterEach(() => {
    stateManager.destroy();
    jest.clearAllMocks();
  });

  describe('State Management', () => {
    it('should initialize with empty state', () => {
      expect(stateManager.getState()).toEqual({});
      expect(stateManager.getVersion()).toBe(0);
    });

    it('should update state optimistically', async () => {
      const update: Partial<TableState> = {
        tableId: 'table1',
        pot: 100
      };

      await stateManager.updateState(update);

      expect(stateManager.getState()).toMatchObject(update);
      expect(mockSocket.emit).toHaveBeenCalled();
    });

    it('should rollback optimistic updates on error', async () => {
      const update: Partial<TableState> = {
        tableId: 'table1',
        pot: 100
      };

      mockSocket.emit.mockImplementationOnce(() => {
        throw new Error('Network error');
      });

      await expect(stateManager.updateState(update)).rejects.toThrow('Network error');
      expect(stateManager.getState()).toEqual({});
    });
  });

  describe('Sync Management', () => {
    it('should start sync interval on initialization', () => {
      jest.useFakeTimers();
      const newStateManager = new StateManager(config);
      
      expect(mockSocket.emit).not.toHaveBeenCalled();
      
      jest.advanceTimersByTime(config.syncInterval);
      
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'sync_request',
        expect.any(Object)
      );

      newStateManager.destroy();
      jest.useRealTimers();
    });

    it('should stop sync interval on destroy', () => {
      jest.useFakeTimers();
      
      stateManager.destroy();
      jest.advanceTimersByTime(config.syncInterval);
      
      expect(mockSocket.emit).not.toHaveBeenCalled();
      
      jest.useRealTimers();
    });
  });

  describe('Version Management', () => {
    it('should maintain state versions', async () => {
      const initialVersion = stateManager.getVersion();

      await stateManager.updateState({ pot: 100 });
      
      expect(stateManager.getVersion()).toBeGreaterThan(initialVersion);
    });
  });
});
