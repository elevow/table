import type { NextApiResponse } from 'next';

// Helper to get/create the WebSocketManager from a Next.js API response.
// Socket.IO has been removed - this function now returns null for backward compatibility.
export function getWsManager(_res: NextApiResponse): null {
  // Socket.IO functionality has been removed. Supabase is now the only supported transport.
  return null;
}
