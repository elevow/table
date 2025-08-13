export interface StateDelta {
  changes: {
    path: string;
    oldValue: any;
    newValue: any;
    timestamp: number;
  }[];
  baseVersion: number;
  deltaId: string;
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
