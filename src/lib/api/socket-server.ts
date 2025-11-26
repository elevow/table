/**
 * Socket server helper - deprecated
 * Socket.IO transport has been removed. Only Supabase transport is supported.
 */

import type { NextApiResponse } from 'next';
import { WebSocketManager } from '../websocket-manager';

// Helper to get the WebSocketManager (deprecated - returns the deprecated stub)
export function getWsManager(_res: NextApiResponse): WebSocketManager | null {
  console.warn('⚠️ getWsManager is deprecated. Socket.IO has been removed.');
  return WebSocketManager.getInstance();
}
