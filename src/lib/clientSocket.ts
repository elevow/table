import { io, Socket } from 'socket.io-client';
import { isBrowser } from './env';

let socket: Socket | null = null;
let isInitializing = false;
let serverInitialized = false;
let initializationPromise: Promise<Socket | null> | null = null;
let lastServerInitTime = 0;

// Global flag to prevent multiple simultaneous getSocket calls
let globalSocketInitializing = false;

export async function getSocket(): Promise<Socket | null> {
  if (!isBrowser()) return null;
  
  console.log('🔍 getSocket() called - socket exists:', !!socket, 'connected:', socket?.connected, 'initializing:', !!initializationPromise);
  
  // Return existing socket if already connected
  if (socket && socket.connected) {
    console.log('🔄 Returning existing connected socket');
    return socket;
  }
  
  // Return existing initialization promise if already initializing
  if (initializationPromise) {
    console.log('🔄 Returning existing initialization promise');
    return initializationPromise;
  }
  
  // For testing, allow socket creation even in development
  const isTestEnvironment = process.env.NODE_ENV === 'test';
  
  // Prevent multiple simultaneous initialization attempts
  if (globalSocketInitializing) {
    console.log('🔒 Socket initialization already in progress globally');
    return new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!globalSocketInitializing) {
          clearInterval(checkInterval);
          resolve(socket);
        }
      }, 100);
    });
  }
  
  globalSocketInitializing = true;
  
  // Start initialization process
  initializationPromise = (async () => {
    try {
  console.log('🔌 Creating Socket.IO connection...');
      
      // Ensure socket server is initialized (only once with rate limiting)
      const now = Date.now();
      if (!serverInitialized && (now - lastServerInitTime) > 5000) { // Rate limit to once per 5 seconds
        try {
          lastServerInitTime = now;
          await fetch('/api/socketio');
          serverInitialized = true;
          console.log('✅ Socket server initialized');
        } catch (initError) {
          console.warn('⚠️ Failed to initialize socket server:', initError);
        }
      }
      
      // Create socket connection with environment-aware configuration
      const isTest = process.env.NODE_ENV === 'test';
      // Allow overriding the socket server base URL (useful for external persistent servers)
      const envBase = (typeof window !== 'undefined' ? (window as any).NEXT_PUBLIC_SOCKET_IO_URL : undefined) || process.env.NEXT_PUBLIC_SOCKET_IO_URL;
      const baseUrl = envBase && /^https?:\/\//i.test(envBase) ? envBase : '/';
      const socketPath = isTest ? '/socket.io' : (process.env.NEXT_PUBLIC_SOCKET_IO_PATH || '/api/socketio');
      // Determine if the base is cross-origin compared to current page (treat absolute same-origin as same)
      let crossOrigin = baseUrl !== '/';
      try {
        if (typeof window !== 'undefined' && baseUrl !== '/') {
          const u = new URL(baseUrl);
          if (u.origin === window.location.origin) {
            crossOrigin = false;
          }
        }
      } catch {}
      // Optional force-polling flag to ensure no websocket/upgrade in production
      const forcePolling = (() => {
        const raw = (typeof window !== 'undefined' ? (window as any).NEXT_PUBLIC_SOCKET_IO_FORCE_POLLING : undefined) || process.env.NEXT_PUBLIC_SOCKET_IO_FORCE_POLLING;
        const v = String(raw || '').toLowerCase();
        return v === '1' || v === 'true' || v === 'yes';
      })();
      const transports = isTest
        ? (['polling', 'websocket'] as const)
        : forcePolling
          ? (['polling'] as const)
          : crossOrigin
            ? (['websocket', 'polling'] as const)
            : (['polling'] as const);
      const allowUpgrade = isTest ? true : (forcePolling ? false : !!crossOrigin);
      console.log('🛣️ Socket.IO config', {
        base: baseUrl,
        path: socketPath,
        transports,
        upgrade: allowUpgrade,
      });
      socket = io(baseUrl, {
        path: socketPath,
        transports: transports as any,
        upgrade: allowUpgrade,
        autoConnect: false, // Don't auto-connect, we'll connect manually
        reconnection: true,
        reconnectionAttempts: 2, // Very limited attempts
        reconnectionDelay: 5000, // Long delay between attempts
        reconnectionDelayMax: 10000,
        timeout: 20000,
        forceNew: false
      });
      
      // Manual connection with error handling
      socket.connect();
      
      socket.on('connect', () => {
        console.log('✅ Socket.IO connected successfully');
      });

      socket.on('connect_error', (error: any) => {
        try {
          const detail = {
            message: error?.message || String(error),
            description: (error && typeof error === 'object' && 'description' in error) ? (error as any).description : undefined,
            type: (error && typeof error === 'object' && 'type' in error) ? (error as any).type : undefined,
            transport: (socket as any)?.transport?.name,
          };
          console.warn('⚠️ Socket.IO connection error:', detail);
        } catch {
          console.warn('⚠️ Socket.IO connection error:', error?.message || error);
        }
        // Don't reset promise immediately, let reconnection handle it
      });
      
      socket.on('disconnect', (reason) => {
        console.log('🔌 Socket.IO disconnected:', reason);
        // Reset initialization promise on disconnect so it can be recreated
        if (reason === 'io server disconnect' || reason === 'io client disconnect') {
          initializationPromise = null;
        }
      });
      
      socket.on('reconnect_attempt', (attemptNumber) => {
        console.log(`🔄 Socket.IO reconnect attempt ${attemptNumber}`);
      });
      
      socket.on('reconnect_failed', () => {
        console.warn('❌ Socket.IO reconnection failed');
        initializationPromise = null;
      });
      
      return socket;
    } catch (error) {
      console.warn('Socket.IO initialization failed:', error);
      initializationPromise = null;
      return null;
    } finally {
      globalSocketInitializing = false;
    }
  })();
  
  return initializationPromise;
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
  isInitializing = false;
  serverInitialized = false;
  initializationPromise = null;
  globalSocketInitializing = false;
  lastServerInitTime = 0;
}
