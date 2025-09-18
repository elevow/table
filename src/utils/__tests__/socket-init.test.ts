/**
 * @jest-environment jsdom
 */

// Mock fetch globally first 
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// Mock console methods
const mockConsoleLog = jest.fn();
const mockConsoleWarn = jest.fn();

// Store original methods
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

describe('Socket Initialization Utils', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    mockFetch.mockReset();
    
    // Mock console methods
    console.log = mockConsoleLog;
    console.warn = mockConsoleWarn;

    // Clear the module cache to reset module-level state
    jest.resetModules();
  });

  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
  });

  describe('ensureSocketIOServer', () => {
    describe('Client-side execution', () => {
      it('should successfully initialize Socket.IO server', async () => {
        // Ensure window exists for client-side
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const mockResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ status: 'ready' })
        };
        mockFetch.mockResolvedValue(mockResponse);

        // Import fresh module 
        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockFetch).toHaveBeenCalledWith('/api/socketio', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        expect(mockResponse.json).toHaveBeenCalled();
        expect(mockConsoleLog).toHaveBeenCalledWith('🔧 Initializing Socket.IO server...');
        expect(mockConsoleLog).toHaveBeenCalledWith('✅ Socket.IO server ready:', 'ready');
        expect(mockConsoleWarn).not.toHaveBeenCalled();
      });

      it('should handle server initialization with different response status', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const mockResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ status: 'already-running' })
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockConsoleLog).toHaveBeenCalledWith('✅ Socket.IO server ready:', 'already-running');
      });

      it('should handle server initialization with complex response data', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const complexResponse = {
          status: 'initialized',
          port: 3001,
          connections: 5,
          uptime: 12345
        };
        const mockResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(complexResponse)
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockConsoleLog).toHaveBeenCalledWith('✅ Socket.IO server ready:', 'initialized');
      });

      it('should handle non-OK response status', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const mockResponse = {
          ok: false,
          status: 500,
          json: jest.fn()
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockFetch).toHaveBeenCalled();
        expect(mockResponse.json).not.toHaveBeenCalled();
        expect(mockConsoleLog).toHaveBeenCalledWith('🔧 Initializing Socket.IO server...');
        expect(mockConsoleWarn).toHaveBeenCalledWith(
          '⚠️ Socket.IO server initialization warning:',
          expect.objectContaining({
            message: 'Server initialization failed: 500'
          })
        );
      });

      it('should handle 404 response', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const mockResponse = {
          ok: false,
          status: 404,
          json: jest.fn()
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockConsoleWarn).toHaveBeenCalledWith(
          '⚠️ Socket.IO server initialization warning:',
          expect.objectContaining({
            message: 'Server initialization failed: 404'
          })
        );
      });

      it('should handle network errors', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const networkError = new Error('Network error');
        mockFetch.mockRejectedValue(networkError);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockFetch).toHaveBeenCalled();
        expect(mockConsoleLog).toHaveBeenCalledWith('🔧 Initializing Socket.IO server...');
        expect(mockConsoleWarn).toHaveBeenCalledWith(
          '⚠️ Socket.IO server initialization warning:',
          networkError
        );
      });

      it('should handle JSON parsing errors', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const jsonError = new Error('Invalid JSON');
        const mockResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockRejectedValue(jsonError)
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockConsoleWarn).toHaveBeenCalledWith(
          '⚠️ Socket.IO server initialization warning:',
          jsonError
        );
      });

      it('should use singleton pattern - multiple calls within same import return same promise', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const mockResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ status: 'concurrent-ready' })
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        const promise1 = ensureSocketIOServer();
        const promise2 = ensureSocketIOServer();
        const promise3 = ensureSocketIOServer();

        // All promises should be resolved to the same value
        const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);
        expect(result1).toBe(result2);
        expect(result2).toBe(result3);

        // Fetch should only be called once despite multiple ensureSocketIOServer calls
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockConsoleLog).toHaveBeenCalledWith('✅ Socket.IO server ready:', 'concurrent-ready');
      });

      it('should handle concurrent initialization attempts', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const mockResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ status: 'concurrent-ready' })
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        const promises = Array(5).fill(null).map(() => ensureSocketIOServer());

        await Promise.all(promises);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockConsoleLog).toHaveBeenCalledWith('✅ Socket.IO server ready:', 'concurrent-ready');
      });

      it('should handle response with empty JSON', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const mockResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({})
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockConsoleLog).toHaveBeenCalledWith('✅ Socket.IO server ready:', undefined);
      });

      it('should handle response with null JSON', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const mockResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(null)
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        // This should not throw an error
        await expect(ensureSocketIOServer()).resolves.toBeUndefined();
        
        expect(mockConsoleLog).toHaveBeenCalledWith('🔧 Initializing Socket.IO server...');
        // When result is null, accessing result.status throws an error, triggering the catch block
        expect(mockConsoleWarn).toHaveBeenCalled();
      });

      it('should handle response with status property as null', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const mockResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ status: null })
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockConsoleLog).toHaveBeenCalledWith('✅ Socket.IO server ready:', null);
      });
    });

    describe('Edge cases and error scenarios', () => {
      it('should handle fetch throwing synchronous error', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const syncError = new Error('Synchronous fetch error');
        mockFetch.mockImplementation(() => {
          throw syncError;
        });

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockConsoleWarn).toHaveBeenCalledWith(
          '⚠️ Socket.IO server initialization warning:',
          syncError
        );
      });

      it('should handle response.json() throwing error', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const jsonError = new Error('JSON parsing failed');
        const mockResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockImplementation(() => {
            throw jsonError;
          })
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockConsoleWarn).toHaveBeenCalledWith(
          '⚠️ Socket.IO server initialization warning:',
          jsonError
        );
      });

      it('should handle undefined fetch', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const originalFetch = (global as any).fetch;
        delete (global as any).fetch;

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockConsoleWarn).toHaveBeenCalledWith(
          '⚠️ Socket.IO server initialization warning:',
          expect.any(Error)
        );

        // Restore fetch
        (global as any).fetch = originalFetch;
      });

      it('should handle fetch returning undefined response', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        mockFetch.mockResolvedValue(undefined);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockConsoleWarn).toHaveBeenCalledWith(
          '⚠️ Socket.IO server initialization warning:',
          expect.any(Error)
        );
      });

      it('should handle response without ok property', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const mockResponse = {
          status: 200,
          json: jest.fn().mockResolvedValue({ status: 'ready' })
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        // Should treat as non-OK response and show warning
        expect(mockConsoleWarn).toHaveBeenCalled();
      });

      it('should handle response without status property', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };

        const mockResponse = {
          ok: true,
          json: jest.fn().mockResolvedValue({ status: 'ready' })
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockConsoleLog).toHaveBeenCalledWith('✅ Socket.IO server ready:', 'ready');
      });
    });

    describe('Environment detection', () => {
      it('should correctly detect client environment with window defined', async () => {
        (global as any).window = { location: { href: 'http://localhost:3000' } };
        
        const mockResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ status: 'client-ready' })
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockFetch).toHaveBeenCalled();
        expect(mockConsoleLog).toHaveBeenCalledWith('✅ Socket.IO server ready:', 'client-ready');
      });

      it('should handle window being null', async () => {
        (global as any).window = null;

        const mockResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ status: 'null-window-ready' })
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        // null is not undefined, so should still be treated as client-side
        expect(mockFetch).toHaveBeenCalled();
        expect(mockConsoleLog).toHaveBeenCalledWith('✅ Socket.IO server ready:', 'null-window-ready');
      });

      it('should handle window being empty object', async () => {
        (global as any).window = {};
        
        const mockResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ status: 'empty-window-ready' })
        };
        mockFetch.mockResolvedValue(mockResponse);

        const { ensureSocketIOServer } = require('../socket-init');

        await ensureSocketIOServer();

        expect(mockFetch).toHaveBeenCalled();
        expect(mockConsoleLog).toHaveBeenCalledWith('✅ Socket.IO server ready:', 'empty-window-ready');
      });
    });
  });
});