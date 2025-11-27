import { createHash } from 'crypto';
import { StateDelta } from '../../types/state-sync';
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
    // Socket.IO sync has been removed. State is now synced via Supabase Realtime.
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

  public async syncState(_isRetry: boolean = false): Promise<void> {
    // Socket.IO sync has been removed. State is now synced via Supabase Realtime.
    this.state.lastSync = Date.now();
  }

  public handleSyncError(): void {
    // Socket.IO sync has been removed. Error handling is now done via Supabase.
  }

  private calculateChecksum(data: any): string {
    const hash = createHash('md5');
    hash.update(JSON.stringify(data));
    return hash.digest('hex');
  }
}
