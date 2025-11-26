/**
 * Socket.IO server initialization - deprecated
 * Socket.IO transport has been removed. Only Supabase transport is supported.
 * This module is kept for backward compatibility but does nothing.
 */

export async function ensureSocketIOServer(): Promise<void> {
  // Socket.IO server has been removed - only Supabase transport is supported
  // This is a no-op for backward compatibility
  return;
}
