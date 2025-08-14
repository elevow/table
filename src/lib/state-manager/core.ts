import { StateSynchronization, StateConflict, StateDelta } from '../../types/state';
import { TableState } from '../../types/poker';
import { VersionedState, StateManagerConfig, StateManagerDependencies } from './types';
import { SyncManager } from './sync';
import { OptimisticManager } from './optimistic';
import { DeltaManager } from './delta';
import { ConflictManager } from './conflict';
import { createHash } from 'crypto';
import { StateChange } from '../../types/state-sync';

export class StateManager {
  private state: VersionedState<TableState>;
  private syncManager: SyncManager;
  private optimisticManager: OptimisticManager;
  private deltaManager: DeltaManager;
  private conflictManager: ConflictManager;
  private readonly config: StateManagerConfig;

  constructor(config: StateManagerConfig) {
    this.config = config;
    this.state = {
      version: 0,
      timestamp: Date.now(),
      checksum: '',
      data: {} as TableState,
      changes: [],
      lastSync: Date.now()
    };

    // Initialize dependencies
    this.syncManager = new SyncManager(config, this.state);
    this.optimisticManager = new OptimisticManager(this.state);
    this.deltaManager = new DeltaManager();
    this.conflictManager = new ConflictManager(this.state, config);

    // Start sync
    this.syncManager.startSyncInterval();
  }

  public getState(): TableState {
    return this.state.data;
  }

  public getVersion(): number {
    return this.state.version;
  }

  public async updateState(update: Partial<TableState>): Promise<void> {
    const newState = {
      ...this.state.data,
      ...update
    };

    const delta = this.deltaManager.calculateDelta(this.state.data, newState);

    if (this.config.optimisticUpdates) {
      this.optimisticManager.applyOptimisticUpdate(delta);
    }

    try {
      // Apply update immediately for optimistic UI
      this.state.data = newState;
      this.state.version++;
      this.state.timestamp = Date.now();
      this.state.checksum = this.calculateChecksum(this.state.data);

      // Send update to server
      await this.syncManager.syncState();
    } catch (error) {
      // If update fails, rollback optimistic update and state changes
      if (this.config.optimisticUpdates) {
        this.optimisticManager.rollbackOptimisticUpdate(delta);
        this.state.data = this.deltaManager.applyDelta(newState, {
          changes: delta.changes.map((change: StateChange) => ({
            ...change,
            newValue: change.oldValue
          })),
          from: this.state.version,
          to: this.state.version - 1
        });
        this.state.version--;
      }
      throw error;
    }
  }

  public destroy(): void {
    this.syncManager.stopSyncInterval();
  }

  private calculateChecksum(data: any): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex');
  }
}
