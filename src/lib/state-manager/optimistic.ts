import { StateDelta, StateConflict } from '../../types/state';
import { TableState } from '../../types/poker';
import { IOptimisticManager, VersionedState } from './types';
import { StateChange } from '../../types/state-sync';
import { DeltaManager } from './delta';

export class OptimisticManager implements IOptimisticManager {
  private optimisticUpdates = new Map<string, any>();
  private deltaManager: DeltaManager;

  constructor(
    private readonly state: VersionedState<TableState>
  ) {
    this.deltaManager = new DeltaManager();
  }

  public applyOptimisticUpdate(delta: StateDelta): void {
    const newState = this.deltaManager.applyDelta(this.state.data, delta);
    const timestamp = Date.now();
    const key = `opt_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;  // Add random component
    
    // Store the original state for potential rollback
    this.optimisticUpdates.set(key, {
      originalState: { ...this.state.data },
      delta,
      timestamp
    });

    // Store each delta change as a state change
    for (const deltaChange of delta.changes) {
      const change: StateChange = {
        id: `optimistic_${timestamp}`,
        type: 'update',
        path: deltaChange.path.split('.'),
        value: deltaChange.newValue,
        oldValue: deltaChange.oldValue,
        newValue: deltaChange.newValue,
        timestamp,
        source: 'client',
        optimisticKey: key  // Track which optimistic update this change belongs to
      };
      this.state.changes.push(change);
    }

    // Apply the optimistic update
    this.state.data = newState;
    this.state.version++; // Increment version optimistically
  }

  public rollbackOptimisticUpdate(delta: StateDelta): void {
    // Find the matching optimistic update
    Array.from(this.optimisticUpdates.entries()).forEach(([key, update]) => {
      if (this.isDeltaEqual(update.delta, delta)) {
        // Restore the original state
        this.state.data = { ...update.originalState };
        this.state.version--; // Decrement version

        // Get the timestamp from the update
        const timestamp = update.timestamp;

        // Only keep changes that don't match any changes in the delta we're rolling back
        // Only remove changes that came from this specific optimistic update
        this.state.changes = this.state.changes.filter(change => {
          // Keep changes that don't have an optimisticKey or have a different optimisticKey
          if (!change.optimisticKey || change.optimisticKey !== key) {
            return true;
          }
          // For changes that belong to this update, only remove if they match a delta change
          return !delta.changes.some((deltaChange: { path: string | string[]; oldValue: any; newValue: any }) => {
            const deltaPath = Array.isArray(deltaChange.path) ? deltaChange.path : deltaChange.path.split('.');
            const changePath = Array.isArray(change.path) ? change.path : [change.path];
            return deltaPath.join('.') === changePath.join('.');
          });
        });

        this.optimisticUpdates.delete(key);
      }
    });
  }

  public handleUpdateRejection(delta: StateDelta, conflicts: StateConflict[]): void {
    // Rollback the optimistic update
    this.rollbackOptimisticUpdate(delta);

    // Add conflicts to state
    for (const conflict of conflicts) {
      const deltaFromConflict: StateDelta = {
        changes: [{
          path: conflict.path,
          oldValue: conflict.clientValue,
          newValue: conflict.serverValue,
          timestamp: Date.now()
        }],
        from: conflict.clientVersion,
        to: conflict.serverVersion
      };

      if (!this.state.changes.some(c => this.isDeltaMatchesChange(deltaFromConflict, c))) {
        this.state.changes.push({
          id: `conflict_${Date.now()}`,
          type: 'update',
          path: conflict.path ? conflict.path.split('.') : [],
          value: conflict.resolvedValue,
          timestamp: Date.now(),
          source: 'server'
        });
      }
    }
  }

  private isDeltaEqual(delta1: StateDelta, delta2: StateDelta): boolean {
    if (delta1.changes.length !== delta2.changes.length) return false;

    return delta1.changes.every((change1: { path: string; oldValue: any; newValue: any }, index: number) => {
      const change2 = delta2.changes[index];
      return (
        change1.path === change2.path &&
        change1.oldValue === change2.oldValue &&
        change1.newValue === change2.newValue
      );
    });
  }

  private isDeltaMatchesChange(delta: StateDelta, change: StateChange): boolean {
    return delta.changes.some((deltaChange: StateChange) => 
      deltaChange.path === change.path &&
      deltaChange.oldValue === change.oldValue &&
      deltaChange.newValue === change.newValue
    );
  }
}
