import type { Socket } from 'socket.io-client';
import { EnhancedStateManager } from '../enhanced-state-manager';
import { SyncConfig, StateDelta, StateConflict } from '../../types/state-sync';
import { TableState } from '../../types/poker';

jest.mock('socket.io-client');

describe('EnhancedStateManager', () => {
  let socket: any;
  let stateManager: EnhancedStateManager;
  let config: SyncConfig;

  beforeEach(() => {
    socket = {
      on: jest.fn(),
      emit: jest.fn().mockReturnThis(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      connected: true,
      id: 'mock-socket-id'
    };

    config = {
      syncInterval: 5000,
      retryDelay: 1000,
      maxRetries: 3,
      optimisticUpdates: true,
      conflictResolutionStrategy: 'merge'
    };

    stateManager = new EnhancedStateManager(socket, config);
  });

  afterEach(() => {
    stateManager.destroy();
    jest.clearAllMocks();
  });

  describe('State Updates', () => {
    it('should handle state updates correctly', () => {
      const update: TableState = {
        tableId: 'table123',
        stage: 'preflop',
        players: [],
        activePlayer: '',
        pot: 0,
        communityCards: [],
        currentBet: 0,
        dealerPosition: 0,
        smallBlind: 5,
        bigBlind: 10,
        minRaise: 10,
        lastRaise: 0
      };

      const stateUpdateCallback = socket.on.mock.calls.find(
        (call: [string, unknown]) => call[0] === 'state_update'
      )?.[1];

      expect(stateUpdateCallback).toBeDefined();
      stateUpdateCallback!(update);

      expect(socket.emit).toHaveBeenCalledWith(
        'state_update',
        expect.objectContaining({
          version: expect.any(Number),
          delta: expect.any(Object),
        }),
        expect.any(Function)
      );
    });

    it('should handle optimistic updates correctly', () => {
      const player: Player = {
        id: 'p1',
        name: 'Player 1',
        position: 0,
        stack: 1000,
        currentBet: 0,
        hasActed: false,
        isFolded: false,
        isAllIn: false,
        timeBank: 30000
      };

      const update: TableState = {
        tableId: 'table123',
        stage: 'preflop',
        players: [player],
        activePlayer: player.id,
        pot: 0,
        communityCards: [],
        currentBet: 0,
        dealerPosition: 0,
        smallBlind: 5,
        bigBlind: 10,
        minRaise: 10,
        lastRaise: 0
      };

      socket.emit.mockImplementation((...args: any[]) => {
        const [event, data, callback] = args;
        if (event === 'state_update' && callback) {
          callback({ accepted: true, newVersion: 1 });
        }
        return socket;
      });

      const stateUpdateCallback = socket.on.mock.calls.find(
        (call: [string, unknown]) => call[0] === 'state_update'
      )?.[1];

      stateUpdateCallback!(update);

      expect(stateManager.getState()).toEqual(update);
      expect(stateManager.getVersion()).toBe(1);
    });
  });

  describe('State Synchronization', () => {
    it('should handle state sync correctly', () => {
      const player: Player = {
        id: 'p1',
        name: 'Player 1',
        position: 0,
        stack: 1000,
        currentBet: 10,
        hasActed: true,
        isFolded: false,
        isAllIn: false,
        timeBank: 30000
      };

      const syncData = {
        version: 2,
        state: {
          tableId: 'table123',
          stage: 'flop',
          players: [player],
          activePlayer: player.id,
          pot: 50,
          communityCards: [],
          currentBet: 10,
          dealerPosition: 0,
          smallBlind: 5,
          bigBlind: 10,
          minRaise: 10,
          lastRaise: 10
        }
      };

      const stateSyncCallback = socket.on.mock.calls.find(
        (call: [string, unknown]) => call[0] === 'state_sync'
      )?.[1];

      stateSyncCallback!(syncData);

      expect(stateManager.getState()).toEqual(syncData.state);
      expect(stateManager.getVersion()).toBe(2);
    });
  });

  describe('Conflict Resolution', () => {
    it('should handle conflicts correctly', async () => {
      const conflict: StateConflict = {
        clientVersion: 1,
        serverVersion: 2,
        conflictType: 'merge',
        resolution: 'merge',
        path: 'players[0].stack',
        clientValue: 150,
        serverValue: 200,
        resolvedValue: null
      };

      socket.emit.mockImplementation((...args: any[]) => {
        const [event, data] = args;
        if (event === 'conflict_resolved') {
          expect((data as any).conflict.resolvedValue).toBe(200);
        }
        return socket;
      });

      const conflictCallback = socket.on.mock.calls.find(
        (call: [string, unknown]) => call[0] === 'conflict'
      )?.[1];

      await conflictCallback!(conflict);

      expect(socket.emit).toHaveBeenCalledWith(
        'conflict_resolved',
        expect.objectContaining({
          conflict: expect.objectContaining({
            resolvedValue: expect.any(Number)
          }),
          timestamp: expect.any(Number)
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle sync errors with retries', () => {
      jest.useFakeTimers();

      socket.emit.mockImplementation((...args: any[]) => {
        const [event] = args;
        if (event === 'sync_request') {
          throw new Error('Sync failed');
        }
        return socket;
      });

      // Stop internal sync interval
      if (stateManager['syncTimeout']) {
        clearInterval(stateManager['syncTimeout']);
        stateManager['syncTimeout'] = null;
      }

      // Initial sync attempt
      stateManager['syncState']();
      expect(socket.emit).toHaveBeenCalledTimes(1);

      // First retry after retryDelay
      jest.advanceTimersByTime(config.retryDelay);
      expect(socket.emit).toHaveBeenCalledTimes(2);

      // Second retry after retryDelay
      jest.advanceTimersByTime(config.retryDelay);
      expect(socket.emit).toHaveBeenCalledTimes(3);

      // Third retry after retryDelay - this will exceed maxRetries
      jest.advanceTimersByTime(config.retryDelay);
      expect(socket.emit).toHaveBeenCalledTimes(4);
      expect(socket.emit).toHaveBeenLastCalledWith('sync_failed', {
        version: stateManager.getVersion(),
        timestamp: expect.any(Number)
      });

      // Should not try again after max retries
      jest.advanceTimersByTime(config.retryDelay);
      expect(socket.emit).toHaveBeenCalledTimes(4);  // Count should stay the same

      jest.useRealTimers();
    });
  });
});
