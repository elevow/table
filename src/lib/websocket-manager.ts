/**
 * WebSocket Manager - deprecated
 * Socket.IO transport has been removed. Only Supabase transport is supported.
 * This module is kept for backward compatibility but provides no functionality.
 */

import { WebSocketConfig, ConnectionState } from '../types/websocket';

export class WebSocketManager {
  private static instance: WebSocketManager | null = null;
  
  private constructor() {
    console.warn('⚠️ WebSocketManager is deprecated. Socket.IO has been removed. Use Supabase realtime instead.');
  }

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  // All methods return no-op or empty values for backward compatibility
  public getSocketServer(): null {
    return null;
  }

  public getConnectionState(_socketId: string): ConnectionState | undefined {
    return undefined;
  }

  public getAllConnections(): Map<string, ConnectionState> {
    return new Map();
  }

  public disconnectClient(_socketId: string, _reason?: string): void {
    // No-op
  }

  public broadcast(_event: string, _data: any, _room?: string): void {
    // No-op - use Supabase realtime publisher instead
  }

  public broadcastBatch(_events: { event: string; data: any }[], _room?: string): void {
    // No-op - use Supabase realtime publisher instead
  }

  public joinRoom(_socketId: string, _room: string): void {
    // No-op
  }

  public leaveRoom(_socketId: string, _room: string): void {
    // No-op
  }

  public getActiveConnections(): number {
    return 0;
  }

  public getRoomSize(_room: string): number {
    return 0;
  }

  public getConnectionLatency(_socketId: string): number {
    return -1;
  }

  public updateConfig(_config: Partial<WebSocketConfig>): void {
    // No-op
  }
}
