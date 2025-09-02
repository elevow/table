import { io, Socket } from 'socket.io-client';
import { isBrowser } from './env';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  if (!isBrowser()) return null;
  if (!socket) {
    socket = io('/', {
      transports: ['websocket'],
      autoConnect: true
    });
  }
  return socket;
}

// Test-only helper to reset the cached socket between tests
export function __resetClientSocketForTests(): void {
  socket = null;
}
