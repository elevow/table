import { io, Socket } from 'socket.io-client';
import { isBrowser } from './env';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  if (!isBrowser()) return null;
  
  // For testing, allow socket creation even in development
  const isTestEnvironment = process.env.NODE_ENV === 'test';
  
  // For now, disable socket connections to prevent navigation blocking
  // TODO: Re-enable once navigation issues are resolved
  if (process.env.NODE_ENV === 'development' && !isTestEnvironment) {
    // console.log('🔌 Socket.IO disabled in development to prevent navigation issues');
    return null;
  }
  
  if (!socket) {
    try {
      console.log('🔌 Creating Socket.IO connection...');
      
      // Create socket connection with minimal configuration
      socket = io('/', {
        transports: ['websocket'], // Use websockets as expected by test
        autoConnect: true, // Auto-connect as expected by test
        reconnection: false, // Disable reconnection for now
        timeout: 3000
      });
      
      socket.on('connect', () => {
        console.log('✅ Socket.IO connected successfully');
      });

      socket.on('connect_error', (error) => {
        console.warn('⚠️ Socket.IO connection error:', error.message || error);
      });
    } catch (error) {
      console.warn('Socket.IO initialization failed:', error);
      return null;
    }
  }
  
  return socket;
}

// Synchronous version for backward compatibility (returns null if not ready)
export function getSocketSync(): Socket | null {
  return socket;
}

// Test utility function
export function __resetClientSocketForTests(): void {
  if (socket) {
    socket.disconnect();
  }
  socket = null;
}
