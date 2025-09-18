/**
 * Utility to ensure Socket.IO server is properly initialized in development
 */

let initPromise: Promise<void> | null = null;

export async function ensureSocketIOServer(): Promise<void> {
  if (typeof window === 'undefined') {
    // Server-side, nothing to do
    return;
  }

  if (!initPromise) {
    initPromise = initializeServer();
  }

  return initPromise;
}

async function initializeServer(): Promise<void> {
  try {
    console.log('🔧 Initializing Socket.IO server...');
    
    const response = await fetch('/api/socketio', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Server initialization failed: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ Socket.IO server ready:', result.status);
  } catch (error) {
    console.warn('⚠️ Socket.IO server initialization warning:', error);
    // Don't throw - the server might be running already
  }
}

// Auto-initialize in development (disabled to prevent navigation blocking)
// if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
//   // Wait a bit for the page to load, then initialize
//   setTimeout(() => {
//     ensureSocketIOServer().catch(console.warn);
//   }, 500);
// }
