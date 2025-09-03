import type { NextApiResponse } from 'next';
import type { Server as HttpServer } from 'http';
import { WebSocketManager } from '../websocket-manager';

// Helper to get/create the WebSocketManager from a Next.js API response.
// Returns null if the underlying Node server is not available (e.g., edge runtimes).
export function getWsManager(res: NextApiResponse): WebSocketManager | null {
  const anyRes = res as any;
  const server: HttpServer | undefined = anyRes?.socket?.server as HttpServer | undefined;
  if (!server) return null;
  return WebSocketManager.getInstance(server);
}
