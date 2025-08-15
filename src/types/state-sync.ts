export interface StateChange {
  id: string;
  type: 'update' | 'delete' | 'create';
  path: string[];
  value: any;
  timestamp: number;
  source: 'client' | 'server';
  oldValue?: any;
  newValue?: any;
  optimisticKey?: string;  // Key that identifies which optimistic update this change belongs to
}

export interface StateDelta {
  changes: StateChange[];
  from: number;
  to: number;
}

export interface StateConflict {
  clientVersion: number;
  serverVersion: number;
  conflictType: 'merge' | 'override';
  resolution: 'client' | 'server' | 'merge';
  path: string;
  clientValue: any;
  serverValue: any;
  resolvedValue: any;
}

export interface StateSynchronization {
  version: number;
  timestamp: number;
  checksum: string;
  delta: StateDelta;
  conflicts: StateConflict[];
}

export interface ClientState {
  version: number;
  lastSync: number;
  data: any;
  pendingUpdates: Map<string, StateDelta>;
  optimisticUpdates: Map<string, any>;
  conflicts: StateConflict[];
}

export interface SyncConfig {
  syncInterval: number;
  maxRetries: number;
  conflictResolutionStrategy: 'client' | 'server' | 'merge';
  optimisticUpdates: boolean;
  retryDelay: number;
}
