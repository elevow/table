import { OptimisticManager } from '../state-manager/optimistic';
import { VersionedState } from '../state-manager/types';
import { TableState } from '../../types/poker';
import { StateDelta } from '../../types/state';
import { StateChange } from '../../types/state-sync';

describe('OptimisticManager', () => {
  let optimisticManager: OptimisticManager;
  let state: VersionedState<TableState>;

  beforeEach(() => {
    state = {
      version: 0,
      timestamp: Date.now(),
      checksum: '',
      data: {} as TableState,
      changes: [],
      lastSync: Date.now()
    };
    optimisticManager = new OptimisticManager(state);
  });

  describe('applyOptimisticUpdate', () => {
    it('should store changes correctly', () => {
      const delta: StateDelta = {
        changes: [
          { path: 'pot', oldValue: 0, newValue: 100 }
        ],
        from: 0,
        to: 1
      };

      optimisticManager.applyOptimisticUpdate(delta);

      expect(state.changes).toContainEqual(expect.objectContaining({
        type: 'update',
        path: ['pot'],
        oldValue: 0,
        newValue: 100,
        source: 'client'
      }));
    });

    it('should handle multiple updates', () => {
      const delta1: StateDelta = {
        changes: [{ path: 'pot', oldValue: 0, newValue: 100 }],
        from: 0,
        to: 1
      };

      const delta2: StateDelta = {
        changes: [{ path: 'activePlayer', oldValue: '', newValue: 'player1' }],
        from: 1,
        to: 2
      };

      optimisticManager.applyOptimisticUpdate(delta1);
      optimisticManager.applyOptimisticUpdate(delta2);

      expect(state.changes).toContainEqual(expect.objectContaining({
        path: ['pot'],
        oldValue: 0,
        newValue: 100,
        source: 'client'
      }));
      expect(state.changes).toContainEqual(expect.objectContaining({
        path: ['activePlayer'],
        oldValue: '',
        newValue: 'player1',
        source: 'client'
      }));
      expect(state.changes).toHaveLength(2);
    });
  });

  describe('rollbackOptimisticUpdate', () => {
    it('should remove rolled back changes', () => {
      const delta: StateDelta = {
        changes: [{ path: 'pot', oldValue: 0, newValue: 100 }],
        from: 0,
        to: 1
      };

      optimisticManager.applyOptimisticUpdate(delta);
      const changeToRollback = state.changes[0];
      optimisticManager.rollbackOptimisticUpdate(delta);

      expect(state.changes).not.toContainEqual(changeToRollback);
      expect(state.changes).toHaveLength(0);
    });

    it('should handle rollback of specific changes when multiple exist', () => {
      const delta1: StateDelta = {
        changes: [{ path: 'pot', oldValue: 0, newValue: 100 }],
        from: 0,
        to: 1
      };

      const delta2: StateDelta = {
        changes: [{ path: 'activePlayer', oldValue: '', newValue: 'player1' }],
        from: 1,
        to: 2
      };

      optimisticManager.applyOptimisticUpdate(delta1);
      optimisticManager.applyOptimisticUpdate(delta2);
      const firstChange = state.changes[0];
      optimisticManager.rollbackOptimisticUpdate(delta1);

      expect(state.changes).not.toContainEqual(firstChange);
      expect(state.changes).toContainEqual(expect.objectContaining({
        path: ['activePlayer'],
        oldValue: '',
        newValue: 'player1',
        source: 'client'
      }));
      expect(state.changes).toHaveLength(1);
    });
  });

  describe('pending changes', () => {
    it('should track all changes correctly', () => {
      const delta1: StateDelta = {
        changes: [{ path: 'pot', oldValue: 0, newValue: 100 }],
        from: 0,
        to: 1
      };

      const delta2: StateDelta = {
        changes: [{ path: 'activePlayer', oldValue: '', newValue: 'player1' }],
        from: 1,
        to: 2
      };

      optimisticManager.applyOptimisticUpdate(delta1);
      optimisticManager.applyOptimisticUpdate(delta2);

      const expectedChanges = [
        expect.objectContaining({
          path: ['pot'],
          oldValue: 0,
          newValue: 100,
          source: 'client'
        }),
        expect.objectContaining({
          path: ['activePlayer'],
          oldValue: '',
          newValue: 'player1',
          source: 'client'
        })
      ];

      expect(state.changes).toEqual(expect.arrayContaining(expectedChanges));
      expect(state.changes).toHaveLength(2);
    });

    it('should have empty changes array initially', () => {
      expect(state.changes).toEqual([]);
    });
  });
});
