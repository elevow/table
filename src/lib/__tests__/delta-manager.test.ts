import { DeltaManager } from '../state-manager/delta';
import { StateDelta } from '../../types/state';
import { StateChange } from '../../types/state-sync';

describe('DeltaManager', () => {
  let deltaManager: DeltaManager;

  beforeEach(() => {
    deltaManager = new DeltaManager();
  });

  describe('calculateDelta', () => {
    it('should detect added fields', () => {
      const oldState = { a: 1 };
      const newState = { a: 1, b: 2 };

      const delta = deltaManager.calculateDelta(oldState, newState);

      const change = delta.changes.find(c => c.path === 'b');
      expect(change).toBeTruthy();
      expect(change).toMatchObject({
        path: 'b',
        oldValue: undefined,
        newValue: 2
      });
    });

    it('should detect removed fields', () => {
      const oldState = { a: 1, b: 2 };
      const newState = { a: 1 };

      const delta = deltaManager.calculateDelta(oldState, newState);

      const removedChange = delta.changes.find((c: StateChange) => c.path === 'b');
      expect(removedChange).toBeTruthy();
      expect(removedChange).toMatchObject({
        path: 'b',
        oldValue: 2,
        newValue: undefined
      });
    });

    it('should detect modified fields', () => {
      const oldState = { a: 1, b: 2 };
      const newState = { a: 1, b: 3 };

      const delta = deltaManager.calculateDelta(oldState, newState);

      const modifiedChange = delta.changes.find((c: StateChange) => c.path === 'b');
      expect(modifiedChange).toBeTruthy();
      expect(modifiedChange).toMatchObject({
        path: 'b',
        oldValue: 2,
        newValue: 3
      });
    });

    it('should handle nested objects', () => {
      const oldState = { nested: { a: 1, b: 2 } };
      const newState = { nested: { a: 1, b: 3 } };

      const delta = deltaManager.calculateDelta(oldState, newState);

      const nestedChange = delta.changes.find((c: StateChange) => c.path === 'nested.b');
      expect(nestedChange).toBeTruthy();
      expect(nestedChange).toMatchObject({
        path: 'nested.b',
        oldValue: 2,
        newValue: 3
      });
    });

    it('should handle arrays', () => {
      const oldState = { arr: [1, 2, 3] };
      const newState = { arr: [1, 4, 3] };

      const delta = deltaManager.calculateDelta(oldState, newState);

      const arrayChange = delta.changes.find((c: StateChange) => c.path === 'arr.1');
      expect(arrayChange).toBeTruthy();
      expect(arrayChange).toMatchObject({
        path: 'arr.1',
        oldValue: 2,
        newValue: 4
      });
    });
  });

  describe('applyDelta', () => {
    it('should apply added fields', () => {
      const state = { a: 1 };
      const delta: StateDelta = {
        changes: [{
          path: 'b',
          oldValue: undefined,
          newValue: 2
        }],
        from: 0,
        to: 1
      };

      const newState = deltaManager.applyDelta(state, delta);
      expect(newState).toEqual({ a: 1, b: 2 });
    });

    it('should apply removed fields', () => {
      const state = { a: 1, b: 2 };
      const delta: StateDelta = {
        changes: [{
          path: 'b',
          oldValue: 2,
          newValue: undefined
        }],
        from: 0,
        to: 1
      };

      const newState = deltaManager.applyDelta(state, delta);
      expect(newState).toEqual({ a: 1 });
    });

    it('should apply modified fields', () => {
      const state = { a: 1, b: 2 };
      const delta: StateDelta = {
        changes: [{
          path: 'b',
          oldValue: 2,
          newValue: 3
        }],
        from: 0,
        to: 1
      };

      const newState = deltaManager.applyDelta(state, delta);
      expect(newState).toEqual({ a: 1, b: 3 });
    });

    it('should apply nested changes', () => {
      const state = { nested: { a: 1, b: 2 } };
      const delta: StateDelta = {
        changes: [{
          path: 'nested.b',
          oldValue: 2,
          newValue: 3
        }],
        from: 0,
        to: 1
      };

      const newState = deltaManager.applyDelta(state, delta);
      expect(newState).toEqual({ nested: { a: 1, b: 3 } });
    });

    it('should apply array changes', () => {
      const state = { arr: [1, 2, 3] };
      const delta: StateDelta = {
        changes: [{
          path: 'arr.1',
          oldValue: 2,
          newValue: 4
        }],
        from: 0,
        to: 1
      };

      const newState = deltaManager.applyDelta(state, delta);
      expect(newState).toEqual({ arr: [1, 4, 3] });
    });
  });
});
