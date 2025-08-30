import { ConflictManager } from '../state-manager/conflict';
import { VersionedState, StateManagerConfig } from '../state-manager/types';
import { TableState } from '../../types/poker';
import { StateConflict } from '../../types/state';

describe('ConflictManager', () => {
  let conflictManager: ConflictManager;
  let state: VersionedState<TableState>;
  let config: StateManagerConfig;

  beforeEach(() => {
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

    config = {
      syncInterval: 1000,
      optimisticUpdates: true,
      retryAttempts: 3,
      retryDelay: 1000,
      batchSize: 10,
      socket: null as any,
      conflictResolution: 'merge'
    };

    conflictManager = new ConflictManager(state, config);
  });

  describe('handleConflict', () => {
    it('should apply server state when configured for server', async () => {
      config.conflictResolution = 'server';
      
      const serverState: VersionedState<TableState> = {
        ...state,
        version: 2,
        data: {
          ...state.data,
          pot: 200
        }
      };

      const conflict: StateConflict = {
        clientVersion: state.version,
        serverVersion: serverState.version,
        conflictType: 'override',
        resolution: 'server',
        path: 'pot',
        clientValue: state.data.pot,
        serverValue: serverState.data.pot,
        resolvedValue: serverState.data.pot
      };

      await conflictManager.handleConflict(conflict);

      // Check that state was updated according to server state
      expect(state.version).toBe(serverState.version);
      expect(state.data.pot).toBe(200);
    });

    it('should keep client state when configured for client', async () => {
      config.conflictResolution = 'client';
      
      const serverState: VersionedState<TableState> = {
        ...state,
        version: 2,
        data: {
          ...state.data,
          pot: 200
        }
      };

      const conflict: StateConflict = {
        clientVersion: state.version,
        serverVersion: serverState.version,
        conflictType: 'override',
        resolution: 'client',
        path: 'pot',
        clientValue: state.data.pot,
        serverValue: serverState.data.pot,
        resolvedValue: state.data.pot
      };

      await conflictManager.handleConflict(conflict);

      // Check that state remained unchanged
      expect(state.version).toBe(1);
      expect(state.data.pot).toBe(100);
    });

    it('should merge states when configured for merge', async () => {
      config.conflictResolution = 'merge';
      
      const serverState: VersionedState<TableState> = {
        ...state,
        version: 2,
        data: {
          ...state.data,
          pot: 200,
          activePlayer: 'player2'
        }
      };

      const conflicts: StateConflict[] = [{
        clientVersion: state.version,
        serverVersion: serverState.version,
        conflictType: 'merge',
        resolution: 'merge',
        path: 'pot',
        clientValue: state.data.pot,
        serverValue: serverState.data.pot,
        resolvedValue: serverState.data.pot
      }, {
        clientVersion: state.version,
        serverVersion: serverState.version,
        conflictType: 'merge',
        resolution: 'merge',
        path: 'activePlayer',
        clientValue: state.data.activePlayer,
        serverValue: serverState.data.activePlayer,
        resolvedValue: serverState.data.activePlayer
      }];

      for (const conflict of conflicts) {
        await conflictManager.handleConflict(conflict);
      }

      // Check that states were merged
      expect(state.version).toBe(serverState.version);
      expect(state.data.pot).toBe(200);
      expect(state.data.activePlayer).toBe('player2');
    });

    it('should do nothing when states match', async () => {
      const serverState: VersionedState<TableState> = { ...state };
      const initialVersion = state.version;

      const testConflict: StateConflict = {
        clientVersion: state.version,
        serverVersion: serverState.version,
        conflictType: 'override',
        resolution: 'server',
        path: 'pot',
        clientValue: state.data.pot,
        serverValue: serverState.data.pot,
        resolvedValue: state.data.pot
      };

      await conflictManager.handleConflict(testConflict);

      expect(state.version).toBe(initialVersion);
    });
  });
});
