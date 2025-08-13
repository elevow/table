import { BroadcastManager } from '../broadcast-manager';
import { WebSocketManager } from '../websocket-manager';
import { createServer } from 'http';
import { GameEvent } from '../../types/broadcast';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

jest.setTimeout(10000); // Increase timeout for all tests

describe('BroadcastManager', () => {
  let server: ReturnType<typeof createServer>;
  let wsManager: WebSocketManager;
  let broadcastManager: BroadcastManager;
  let clientSocket: ReturnType<typeof io>;
  let port: number;

  beforeEach((done) => {
    port = Math.floor(Math.random() * 1000) + 3000;
    server = createServer();

    // Reset singletons
    (WebSocketManager as any).instance = undefined;
    (BroadcastManager as any).instance = undefined;

    wsManager = WebSocketManager.getInstance(server);
    broadcastManager = BroadcastManager.getInstance(wsManager, {
      batchSize: 2,
      batchInterval: 100,
      compression: false
    });

    server.listen(port, () => {
      clientSocket = io(`http://localhost:${port}`, {
        transports: ['websocket']
      });
      clientSocket.on('connect', done);
    });
  });

  afterEach((done) => {
    const cleanup = () => {
      broadcastManager.clearQueue();
      (BroadcastManager as any).instance = undefined;
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

  describe('Message Batching', () => {
    it('should batch messages based on size', (done) => {
      let batchCount = 0;

      clientSocket.on('gameEvent', (batch) => {
        expect(batch.messages).toBeDefined();
        expect(batch.sequence).toBeGreaterThan(0);
        batchCount++;

        if (batchCount === 2) {
          done();
        }
      });

      // Send 4 messages (should create 2 batches of 2)
      for (let i = 0; i < 4; i++) {
        const event: GameEvent = {
          id: `event${i}`,
          type: 'test',
          payload: { value: i },
          timestamp: Date.now(),
          priority: 'normal'
        };
        broadcastManager.broadcast(event);
      }
    });

    it('should process high priority messages immediately', (done) => {
      clientSocket.once('gameEvent', (batch) => {
        expect(batch.messages.length).toBe(1);
        expect(batch.messages[0].priority).toBe('high');
        done();
      });

      const highPriorityEvent: GameEvent = {
        id: 'urgent',
        type: 'test',
        payload: { value: 'urgent' },
        timestamp: Date.now(),
        priority: 'high'
      };

      broadcastManager.broadcast(highPriorityEvent);
    });
  });

  describe('Room-based Broadcasting', () => {
    it('should broadcast to specific room', (done) => {
      const room = 'test-room';
      wsManager.joinRoom(clientSocket.id, room);

      setTimeout(() => {
        clientSocket.once('gameEvent', (batch) => {
          expect(batch.messages[0].target).toBe(room);
          done();
        });

        const event: GameEvent = {
          id: 'room-event',
          type: 'test',
          payload: { value: 'test' },
          timestamp: Date.now(),
          priority: 'normal',
          target: room
        };

        broadcastManager.broadcast(event);
      }, 100);
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      const newConfig = {
        batchSize: 5,
        batchInterval: 200
      };

      broadcastManager.updateConfig(newConfig);
      const stats = broadcastManager.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('Stats Tracking', () => {
    it('should track broadcasting stats', (done) => {
      // Send some messages
      for (let i = 0; i < 5; i++) {
        const event: GameEvent = {
          id: `event${i}`,
          type: 'test',
          payload: { value: i },
          timestamp: Date.now(),
          priority: 'normal'
        };
        broadcastManager.broadcast(event);
      }

      // Wait for stats to update
      setTimeout(() => {
        const stats = broadcastManager.getStats();
        expect(stats.activeConnections).toBeGreaterThanOrEqual(1);
        expect(stats.avgBatchSize).toBeGreaterThan(0);
        done();
      }, 1100); // Wait for stats interval
    });
  });
});
