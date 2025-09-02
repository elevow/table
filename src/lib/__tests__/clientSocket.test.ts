/**
 * Tests for clientSocket.ts
 */

// Mock socket.io-client to avoid real connections and to inspect calls
jest.mock('socket.io-client', () => {
  const mockSocket = { on: jest.fn(), emit: jest.fn(), connect: jest.fn(), disconnect: jest.fn() };
  const io = jest.fn(() => mockSocket);
  return { __esModule: true, default: io, io };
});

describe('getSocket', () => {
  beforeEach(() => {
  jest.resetModules();
  jest.resetAllMocks();
  });

  test('returns null on server (SSR guard)', () => {
    jest.isolateModules(() => {
  // Mock env.isBrowser to simulate SSR environment
  jest.doMock(require.resolve('../env'), () => ({ isBrowser: () => false }));

  const { getSocket } = require('../clientSocket') as typeof import('../clientSocket');
      const socket = getSocket();
      expect(socket).toBeNull();

      const { io } = require('socket.io-client');
      expect(io).not.toHaveBeenCalled();
    });
  });

  test('creates a singleton socket in browser environment', () => {
    jest.isolateModules(() => {
  // Ensure browser environment; clear any prior mocks for env then provide a true implementation
  jest.unmock(require.resolve('../env'));
  jest.doMock(require.resolve('../env'), () => ({ __esModule: true, isBrowser: () => true }));

  const { getSocket, __resetClientSocketForTests } = require('../clientSocket') as typeof import('../clientSocket');
      const { io } = require('socket.io-client');

  // Reset any cached instance within this isolated registry
  __resetClientSocketForTests();
      const s1 = getSocket();
      expect(s1).not.toBeNull();
      expect(io).toHaveBeenCalledTimes(1);

      const s2 = getSocket();
      expect(s2).toBe(s1);
      expect(io).toHaveBeenCalledTimes(1); // still one call due to caching

      // Verify connection options
      const call = (io as jest.Mock).mock.calls[0];
      expect(call[0]).toBe('/');
      expect(call[1]).toMatchObject({ transports: ['websocket'], autoConnect: true });
    });
  });
});
