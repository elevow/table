import io, { Socket } from 'socket.io-client';
import { TableState } from '../types/poker';
import { StateDelta, StateConflict, ClientState, SyncConfig } from '../types/state-sync';
import { createHash } from 'crypto';

export class EnhancedStateManager {
  private state: ClientState;
  private config: SyncConfig;
  private socket: Socket;
  private syncTimeout: NodeJS.Timeout | null;
  private retryCount: number;

  constructor(socket: Socket, config: SyncConfig) {
    this.socket = socket;
    this.config = config;
    this.retryCount = 0;
    this.syncTimeout = null;
    
    this.state = {
      version: 0,
      lastSync: Date.now(),
      data: {},
      pendingUpdates: new Map(),
      optimisticUpdates: new Map(),
      conflicts: []
    };

    this.setupSocketHandlers();
    this.startSyncInterval();
  }

  private setupSocketHandlers(): void {
    this.socket.on('state_update', (update: TableState) => {
      this.handleStateUpdate(update);
    });

    this.socket.on('state_sync', (syncData: { version: number; state: TableState }) => {
      this.handleStateSync(syncData);
    });

    this.socket.on('conflict', (conflict: StateConflict) => {
      this.handleConflict(conflict);
    });
  }

  private startSyncInterval(): void {
    if (this.syncTimeout) {
      clearInterval(this.syncTimeout);
    }
    
    this.syncTimeout = setInterval(() => {
      this.syncState();
    }, this.config.syncInterval);
  }

  private async syncState(): Promise<void> {
    // Always clear retry timer before a sync attempt
    this.clearSyncTimer();

    try {
      // If we've hit max retries, emit failure and reset
      if (this.retryCount === this.config.maxRetries) {
        this.socket.emit('sync_failed', {
          version: this.state.version,
          timestamp: Date.now()
        });
        this.retryCount = 0;
        return;
      }

      const checksum = this.calculateChecksum(this.state.data);
      const pendingUpdates = Array.from(this.state.pendingUpdates.values());

      await this.socket.emit('sync_request', {
        version: this.state.version,
        checksum,
        pendingUpdates
      });

      // Successful sync - clear retry count and restore normal sync interval
      this.state.lastSync = Date.now();
      this.retryCount = 0;
      
      // Only restart sync interval if we were in retry mode
      if (!this.syncTimeout) {
        this.startSyncInterval();
      }
    } catch (error) {
      console.error('Sync failed:', error);
      this.handleSyncError();
    }
  }  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private initialSyncTime: number = 0;

  private clearSyncTimer(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private handleSyncError(): void {
    // Increment retry count first
    this.retryCount++;

    // Stop regular sync interval during retry mode
    if (this.syncTimeout) {
      clearInterval(this.syncTimeout);
      this.syncTimeout = null;
    }

    // Schedule next retry attempt
    this.syncTimer = setTimeout(() => {
      this.syncState();
    }, this.config.retryDelay);
  }

  private calculateChecksum(data: any): string {
    return createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  private handleStateUpdate(update: TableState): void {
    const delta = this.calculateDelta(this.state.data, update);
    
    if (this.config.optimisticUpdates) {
      this.applyOptimisticUpdate(delta);
      this.state.version++; // Increment version optimistically
    }

    this.state.pendingUpdates.set(delta.deltaId, delta);
    this.attemptStateUpdate(delta);
  }

  private calculateDelta(oldState: any, newState: any): StateDelta {
    const changes = [];
    const paths = this.findChangedPaths(oldState, newState);

    for (const path of paths) {
      changes.push({
        path,
        oldValue: this.getValueAtPath(oldState, path),
        newValue: this.getValueAtPath(newState, path),
        timestamp: Date.now()
      });
    }

    return {
      changes,
      baseVersion: this.state.version,
      deltaId: `delta_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
  }

  private findChangedPaths(oldObj: any, newObj: any, basePath = ''): string[] {
    const paths: string[] = [];
    const allKeys = Array.from(new Set([...Object.keys(oldObj), ...Object.keys(newObj)]));

    for (const key of allKeys) {
      const currentPath = basePath ? `${basePath}.${key}` : key;
      const oldValue = oldObj[key];
      const newValue = newObj[key];

      if (typeof oldValue !== typeof newValue) {
        paths.push(currentPath);
      } else if (typeof oldValue === 'object' && oldValue !== null) {
        paths.push(...this.findChangedPaths(oldValue, newValue, currentPath));
      } else if (oldValue !== newValue) {
        paths.push(currentPath);
      }
    }

    return paths;
  }

  private getValueAtPath(obj: any, path: string): any {
    return path.split('.').reduce((curr, key) => curr?.[key], obj);
  }

  private setValueAtPath(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const target = keys.reduce((curr, key) => curr[key] = curr[key] || {}, obj);
    target[lastKey] = value;
  }

  private applyOptimisticUpdate(delta: StateDelta): void {
    for (const change of delta.changes) {
      this.state.optimisticUpdates.set(change.path, change.newValue);
      this.setValueAtPath(this.state.data, change.path, change.newValue);
    }
  }

  private async attemptStateUpdate(delta: StateDelta): Promise<void> {
    try {
      const serverAck = await new Promise<any>((resolve) => {
        this.socket.emit('state_update', {
          version: this.state.version,
          delta
        }, resolve);
      });

      if (serverAck.accepted) {
        this.state.version = serverAck.newVersion;
        this.state.pendingUpdates.delete(delta.deltaId);
        
        // Clear optimistic updates that were confirmed
        for (const change of delta.changes) {
          this.state.optimisticUpdates.delete(change.path);
          this.setValueAtPath(this.state.data, change.path, change.newValue);
        }
      } else {
        this.handleUpdateRejection(delta, serverAck.conflicts);
      }
    } catch (error) {
      console.error('State update failed:', error);
      this.rollbackOptimisticUpdate(delta);
    }
  }

  private rollbackOptimisticUpdate(delta: StateDelta): void {
    if (!this.config.optimisticUpdates) return;

    for (const change of delta.changes) {
      this.state.optimisticUpdates.delete(change.path);
      this.setValueAtPath(this.state.data, change.path, change.oldValue);
    }
  }

  private handleUpdateRejection(delta: StateDelta, conflicts: StateConflict[]): void {
    this.state.conflicts.push(...conflicts);
    this.rollbackOptimisticUpdate(delta);

    for (const conflict of conflicts) {
      this.resolveConflict(conflict);
    }
  }

  private async handleStateSync({ version, state }: { version: number; state: TableState }): Promise<void> {
    const localChecksum = this.calculateChecksum(this.state.data);
    const serverChecksum = this.calculateChecksum(state);

    if (localChecksum !== serverChecksum) {
      const delta = this.calculateDelta(this.state.data, state);
      const conflicts = this.detectConflicts(delta);

      if (conflicts.length > 0) {
        this.state.conflicts.push(...conflicts);
        for (const conflict of conflicts) {
          await this.resolveConflict(conflict);
        }
      } else {
        this.state.data = state;
        this.state.version = version;
        this.state.pendingUpdates.clear();
        this.state.optimisticUpdates.clear();
      }
    }
  }

  private detectConflicts(delta: StateDelta): StateConflict[] {
    const conflicts: StateConflict[] = [];

    for (const change of delta.changes) {
      const optimisticValue = this.state.optimisticUpdates.get(change.path);
      if (optimisticValue !== undefined && optimisticValue !== change.newValue) {
        conflicts.push({
          clientVersion: this.state.version,
          serverVersion: delta.baseVersion,
          conflictType: 'merge',
          resolution: this.config.conflictResolutionStrategy,
          path: change.path,
          clientValue: optimisticValue,
          serverValue: change.newValue,
          resolvedValue: null
        });
      }
    }

    return conflicts;
  }

  private async resolveConflict(conflict: StateConflict): Promise<void> {
    let resolvedValue: any;

    switch (conflict.resolution) {
      case 'client':
        resolvedValue = conflict.clientValue;
        break;
      case 'server':
        resolvedValue = conflict.serverValue;
        break;
      case 'merge':
        resolvedValue = await this.mergeValues(conflict.clientValue, conflict.serverValue);
        break;
    }

    conflict.resolvedValue = resolvedValue;
    this.setValueAtPath(this.state.data, conflict.path, resolvedValue);
    
    this.socket.emit('conflict_resolved', {
      conflict,
      timestamp: Date.now()
    });
  }

  private async handleConflict(conflict: StateConflict): Promise<void> {
    this.state.conflicts.push(conflict);
    await this.resolveConflict(conflict);
  }

  private async mergeValues(clientValue: any, serverValue: any): Promise<any> {
    // For simple values, prefer server value
    if (typeof clientValue !== 'object' || typeof serverValue !== 'object') {
      return serverValue;
    }

    // For arrays, merge unique items
    if (Array.isArray(clientValue) && Array.isArray(serverValue)) {
      const merged = Array.from(new Set([...clientValue, ...serverValue]));
      return merged;
    }

    // For objects, deep merge
    const merged = { ...clientValue };
    for (const [key, value] of Object.entries(serverValue)) {
      if (key in clientValue && typeof clientValue[key] === 'object') {
        merged[key] = await this.mergeValues(clientValue[key], value);
      } else {
        merged[key] = value;
      }
    }

    return merged;
  }

  public getState(): any {
    return this.state.data;
  }

  public getVersion(): number {
    return this.state.version;
  }

  public getPendingUpdates(): StateDelta[] {
    return Array.from(this.state.pendingUpdates.values());
  }

  public getConflicts(): StateConflict[] {
    return this.state.conflicts;
  }

  public destroy(): void {
    if (this.syncTimeout) {
      clearInterval(this.syncTimeout);
      this.syncTimeout = null;
    }
  }
}
