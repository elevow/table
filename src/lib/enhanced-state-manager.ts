/**
 * EnhancedStateManager - deprecated
 * Socket.IO transport has been removed. Use HTTP APIs with Supabase realtime instead.
 * This module is kept for backward compatibility but provides minimal functionality.
 */

export class EnhancedStateManager {
  private connected: boolean = false;
  private tableId: string | null = null;

  constructor() {
    console.warn('⚠️ EnhancedStateManager is deprecated. Socket.IO has been removed. Use HTTP APIs with Supabase realtime instead.');
  }

  public connect(_url?: string): Promise<void> {
    console.warn('⚠️ EnhancedStateManager.connect is deprecated.');
    return Promise.resolve();
  }

  public disconnect(): void {
    console.warn('⚠️ EnhancedStateManager.disconnect is deprecated.');
    this.connected = false;
  }

  public joinTable(_tableId: string): void {
    console.warn('⚠️ EnhancedStateManager.joinTable is deprecated.');
  }

  public leaveTable(): void {
    console.warn('⚠️ EnhancedStateManager.leaveTable is deprecated.');
    this.tableId = null;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public getCurrentTable(): string | null {
    return this.tableId;
  }

  public on(_event: string, _handler: (...args: any[]) => void): void {
    console.warn('⚠️ EnhancedStateManager.on is deprecated.');
  }

  public off(_event: string, _handler?: (...args: any[]) => void): void {
    console.warn('⚠️ EnhancedStateManager.off is deprecated.');
  }

  public emit(_event: string, _data?: any): void {
    console.warn('⚠️ EnhancedStateManager.emit is deprecated. Use HTTP APIs instead.');
  }
}
