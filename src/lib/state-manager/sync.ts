import { createHash } from 'crypto';
import { StateDelta } from '../../types/state';
import { TableState } from '../../types/poker';
import { ISyncManager, StateManagerConfig, VersionedState } from './types';

export class SyncManager implements ISyncManager {
  private syncTimeout: NodeJS.Timeout | null = null;
  private retryCount: number = 0;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  
  constructor(
    private readonly config: StateManagerConfig,
    private readonly state: VersionedState<TableState>
  ) {}

  public startSyncInterval(): void {
    if (this.syncTimeout) {
      clearInterval(this.syncTimeout);
    }
    
    this.syncTimeout = setInterval(() => {
      this.syncState();
    }, this.config.syncInterval);
  }

  public stopSyncInterval(): void {
    if (this.syncTimeout) {
      clearInterval(this.syncTimeout);
      this.syncTimeout = null;
    }
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  public async syncState(): Promise<void> {
    // Always clear retry timer before a sync attempt
    this.clearSyncTimer();

    try {
      // If we've hit max retries, emit failure and reset
      if (this.retryCount === this.config.retryAttempts) {
        this.config.socket.emit('sync_failed', {
          version: this.state.version,
          timestamp: Date.now()
        });
        this.retryCount = 0;
        return;
      }

      const checksum = this.calculateChecksum(this.state.data);
      const pendingUpdates = Array.from(this.state.changes);

      await this.config.socket.emit('sync_request', {
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
      this.handleSyncError();
    }
  }

  public handleSyncError(): void {
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

  private clearSyncTimer(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private calculateChecksum(data: any): string {
    return createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  public destroy(): void {
    this.stopSyncInterval();
  }
}
