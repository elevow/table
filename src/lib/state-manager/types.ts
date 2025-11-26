import { StateDelta, StateConflict } from '../../types/state-sync';
import { TableState } from '../../types/poker';

// Note: Socket type removed - Socket.IO transport has been deprecated
// This type is kept for backward compatibility
type Socket = any;

export interface StateVersioning {
  version: number;
  timestamp: number;
  checksum: string;
}

export interface StateSyncOptions {
  retryAttempts: number;
  retryDelay: number;
  batchSize: number;
  syncInterval: number;
  conflictResolution: 'client' | 'server' | 'merge';
}

import { StateChange } from '../../types/state-sync';
// Remove duplicate StateChange definition and use the one from state-sync.ts

export interface VersionedState<T> extends StateVersioning {
  data: T;
  changes: StateChange[];
  lastSync: number;
}

// New interfaces for modular state management
export interface IStateManager<T = any> {
  getState(): T;
  getVersion(): number;
  destroy(): void;
}

export interface ISyncManager {
  startSyncInterval(): void;
  stopSyncInterval(): void;
  syncState(): Promise<void>;
  handleSyncError(): void;
}

export interface IOptimisticManager<T = any> {
  applyOptimisticUpdate(delta: StateDelta): void;
  rollbackOptimisticUpdate(delta: StateDelta): void;
  handleUpdateRejection(delta: StateDelta, conflicts: StateConflict[]): void;
}

export interface IDeltaManager<T = any> {
  calculateDelta(oldState: T, newState: T): StateDelta;
  applyDelta(state: T, delta: StateDelta): T;
  findChangedPaths(oldObj: T, newObj: T, basePath?: string): string[];
  getValueAtPath(obj: T, path: string): any;
  setValueAtPath(obj: T, path: string, value: any): void;
}

export interface IConflictManager {
  detectConflicts(delta: StateDelta): StateConflict[];
  resolveConflict(conflict: StateConflict): Promise<void>;
  handleConflict(conflict: StateConflict): Promise<void>;
  mergeValues(clientValue: any, serverValue: any): Promise<any>;
}

export interface StateManagerConfig extends StateSyncOptions {
  socket?: Socket; // Deprecated - Socket.IO has been removed
  optimisticUpdates: boolean;
}

export interface StateManagerDependencies {
  syncManager: ISyncManager;
  optimisticManager: IOptimisticManager;
  deltaManager: IDeltaManager;
  conflictManager: IConflictManager;
}
