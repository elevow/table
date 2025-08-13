import { WebSocketManager } from '../websocket-manager';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { io } from 'socket.io-client';
import { WebSocketConfig } from '../../types/websocket';

describe('WebSocketManager', () => {
  let server: ReturnType<typeof createServer>;
  let manager: WebSocketManager;
  let clientSocket: ReturnType<typeof io>;
  let port: number;

  beforeEach((done) => {
    port = Math.floor(Math.random() * 1000) + 3000;
    server = createServer();
    
    const config: Partial<WebSocketConfig> = {
      reconnectionAttempts: 3,
      reconnectionDelay: 100,
      timeout: 1000,
      pingInterval: 100
    };

    // Reset the singleton instance before each test
    (WebSocketManager as any).instance = undefined;
    manager = WebSocketManager.getInstance(server, config);
    
    server.listen(port, () => {
      clientSocket = io(`http://localhost:${port}`, {
        transports: ['websocket'],
        reconnection: false // Disable auto-reconnection for tests
      });
      clientSocket.on('connect', done);
    });
  });

  afterEach((done) => {
    const cleanup = () => {
      // Reset the singleton instance
      (WebSocketManager as any).instance = undefined;
      done();
    };

    if (clientSocket) {
      clientSocket.removeAllListeners();
      if (clientSocket.connected) {
        clientSocket.disconnect();
      }
    }

    if (server.listening) {
      server.close(() => {
        cleanup();
      });
    } else {
      cleanup();
    }
  });

  describe('Connection Management', () => {
    it('should track connection state', () => {
      return new Promise<void>((resolve) => {
        const state = manager.getConnectionState(clientSocket.id);
        expect(state).toBeDefined();
        expect(state?.status).toBe('connected');
        resolve();
      });
    });

    it('should handle disconnection', () => {
      return new Promise<void>((resolve) => {
        const socketId = clientSocket.id;
        
        // Listen for disconnect before initiating it
        clientSocket.once('disconnect', () => {
          setTimeout(() => {
            const state = manager.getConnectionState(socketId);
            expect(state?.status).toBe('disconnected');
            resolve();
          }, 50);
        });

        clientSocket.disconnect();
      });
    });

    it('should track connection latency', () => {
      return new Promise<void>((resolve) => {
        // Wait for initial ping/pong cycle
        setTimeout(() => {
          const latency = manager.getConnectionLatency(clientSocket.id);
          expect(latency).toBeGreaterThanOrEqual(0);
          resolve();
        }, 150);
      });
    });
  });

  describe('Room Management', () => {
    it('should allow joining rooms', () => {
      return new Promise<void>((resolve) => {
        const room = 'test-room';
        manager.joinRoom(clientSocket.id, room);
        
        // Wait for room join to be processed
        setTimeout(() => {
          const size = manager.getRoomSize(room);
          expect(size).toBe(1);
          resolve();
        }, 50);
      });
    });

    it('should allow leaving rooms', () => {
      return new Promise<void>((resolve) => {
        const room = 'test-room';
        manager.joinRoom(clientSocket.id, room);
        
        // Wait for room join to be processed
        setTimeout(() => {
          manager.leaveRoom(clientSocket.id, room);
          
          // Wait for room leave to be processed
          setTimeout(() => {
            const size = manager.getRoomSize(room);
            expect(size).toBe(0);
            resolve();
          }, 50);
        }, 50);
      });
    });
  });

  describe('Broadcasting', () => {
    it('should broadcast to all clients', () => {
      return new Promise<void>((resolve) => {
        const testData = { message: 'test' };
        
        clientSocket.once('test-event', (data) => {
          expect(data).toEqual(testData);
          resolve();
        });

        manager.broadcast('test-event', testData);
      });
    });

    it('should broadcast to specific room', () => {
      return new Promise<void>((resolve) => {
        const room = 'test-room';
        const testData = { message: 'test' };
        
        manager.joinRoom(clientSocket.id, room);
        
        // Wait for room join to be processed
        setTimeout(() => {
          clientSocket.once('test-event', (data) => {
            expect(data).toEqual(testData);
            resolve();
          });
          
          manager.broadcast('test-event', testData, room);
        }, 50);
      });
    });

    it('should handle batch broadcasting', () => {
      return new Promise<void>((resolve) => {
        const events = [
          { event: 'test1', data: { id: 1 } },
          { event: 'test2', data: { id: 2 } }
        ];
        
        let received = 0;
        const checkDone = () => {
          received++;
          if (received === 2) resolve();
        };
        
        clientSocket.once('test1', (data) => {
          expect(data).toEqual({ id: 1 });
          checkDone();
        });
        
        clientSocket.once('test2', (data) => {
          expect(data).toEqual({ id: 2 });
          checkDone();
        });

        manager.broadcastBatch(events);
      });
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      const newConfig: Partial<WebSocketConfig> = {
        pingInterval: 200,
        timeout: 2000
      };
      
      manager.updateConfig(newConfig);
      const state = manager.getConnectionState(clientSocket.id);
      expect(state).toBeDefined();
    });
  });
});
