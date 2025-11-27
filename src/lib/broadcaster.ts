/**
 * Broadcaster interface for server-side event emission.
 * This provides a socket.io-compatible API without requiring the socket.io package.
 * In the current Supabase-only architecture, implementations should use Supabase publishing.
 */

export interface BroadcasterRoom {
  emit(event: string, ...args: any[]): void;
}

export interface Broadcaster {
  to(room: string): BroadcasterRoom;
  emit(event: string, ...args: any[]): void;
}

/**
 * No-op broadcaster that does nothing.
 * Use this when Socket.IO is not available.
 */
export class NoopBroadcaster implements Broadcaster {
  private noopRoom: BroadcasterRoom = {
    emit: () => {}
  };

  to(_room: string): BroadcasterRoom {
    return this.noopRoom;
  }

  emit(_event: string, ..._args: any[]): void {
    // No-op
  }
}

/**
 * Create a no-op broadcaster instance.
 */
export function createNoopBroadcaster(): Broadcaster {
  return new NoopBroadcaster();
}
