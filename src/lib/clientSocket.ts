/**
 * Client Socket module - deprecated
 * Socket.IO transport has been removed. Only Supabase transport is supported.
 * This module is kept for backward compatibility but always returns null.
 */

export async function getSocket(): Promise<null> {
  // Socket.IO transport has been removed - only Supabase transport is supported
  console.log('⚠️ Socket.IO has been removed. Use Supabase realtime instead.');
  return null;
}

// Synchronous version for backward compatibility (returns null)
export function getSocketSync(): null {
  return null;
}

// Test utility function - no-op for compatibility
export function __resetClientSocketForTests(): void {
  // No-op: Socket.IO has been removed
}
