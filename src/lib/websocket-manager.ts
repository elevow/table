import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { WebSocketConfig, ConnectionState } from '../types/websocket';
import { SystemMonitor } from './system-monitor';

export class WebSocketManager {
  private io: SocketServer;
  private config: WebSocketConfig;
  private connectionStates: Map<string, ConnectionState>;
  private systemMonitor: SystemMonitor;
  private static instance: WebSocketManager;
  
  // Private logging method that respects environment variables
  private log(message: string): void {
    // Only log in non-CI environments or when DEBUG_WEBSOCKET is set
    if (!process.env.CI || process.env.DEBUG_WEBSOCKET) {
      console.log(`[WebSocket] ${message}`);
    }
  }
  
  private error(message: string, error?: any): void {
    // Only log in non-CI environments or when DEBUG_WEBSOCKET is set
    if (!process.env.CI || process.env.DEBUG_WEBSOCKET) {
      console.error(`[WebSocket] ${message}`, error || '');
    }
  }

  private constructor(server: HttpServer, config: Partial<WebSocketConfig> = {}) {
    this.config = {
      reconnectionAttempts: config.reconnectionAttempts ?? 5,
      reconnectionDelay: config.reconnectionDelay ?? 1000,
      timeout: config.timeout ?? 5000,
      pingInterval: config.pingInterval ?? 25000,
      transport: config.transport ?? 'websocket'
    };

    this.connectionStates = new Map();
    this.systemMonitor = SystemMonitor.getInstance();

    this.io = new SocketServer(server, {
      transports: ['websocket'],
      allowUpgrades: false,
      pingInterval: this.config.pingInterval,
      pingTimeout: this.config.timeout,
      connectTimeout: this.config.timeout
    });

    this.setupEventHandlers();
  }

  static getInstance(server?: HttpServer, config?: Partial<WebSocketConfig>): WebSocketManager {
    if (!WebSocketManager.instance && server) {
      WebSocketManager.instance = new WebSocketManager(server, config);
    }
    return WebSocketManager.instance;
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket) => {
      // Initialize connection state
      this.connectionStates.set(socket.id, {
        status: 'connected',
        lastPing: Date.now(),
        latency: 0,
        transport: socket.conn.transport.name
      });
      this.log(`New connection established: ${socket.id} using ${socket.conn.transport.name}`);

      // Handle reconnection
      socket.on('reconnect_attempt', (attemptNumber) => {
        this.log(`Reconnection attempt ${attemptNumber} for socket ${socket.id}`);
        if (attemptNumber > this.config.reconnectionAttempts) {
          this.log(`Max reconnection attempts (${this.config.reconnectionAttempts}) exceeded for ${socket.id}`);
          socket.disconnect(true);
          return;
        }

        this.updateConnectionState(socket.id, 'reconnecting');
      });

      // Handle successful reconnection
      socket.on('reconnect', () => {
        this.log(`Successful reconnection for socket ${socket.id}`);
        this.updateConnectionState(socket.id, 'connected');
        const state = this.connectionStates.get(socket.id);
        if (state) {
          this.connectionStates.set(socket.id, {
            ...state,
            lastPing: Date.now()
          });
        }
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        this.log(`Disconnect event for ${socket.id}, reason: ${reason}`);
        const currentState = this.connectionStates.get(socket.id);
        this.log(`Current state before disconnect: ${JSON.stringify(currentState)}`);
        
        if (reason === 'transport close' || reason === 'ping timeout') {
          this.updateConnectionState(socket.id, 'reconnecting');
          this.log(`Setting state to reconnecting for ${socket.id}`);
          // Socket.IO will handle reconnection automatically
          this.systemMonitor.recordError('socket_reconnecting', {
            socketId: socket.id,
            reason: reason
          });
        } else {
          this.updateConnectionState(socket.id, 'disconnected');
          this.log(`Setting state to disconnected for ${socket.id}`);
          this.systemMonitor.recordError('socket_disconnected', {
            socketId: socket.id,
            reason: reason
          });
        }
        
        const newState = this.connectionStates.get(socket.id);
        this.log(`New state after disconnect: ${JSON.stringify(newState)}`);
      });

      // Handle pings for latency tracking
      socket.on('ping', () => {
        const state = this.connectionStates.get(socket.id)!;
        state.lastPing = Date.now();
        this.connectionStates.set(socket.id, state);
      });

      // Handle pongs for latency calculation
      socket.on('pong', () => {
        const state = this.connectionStates.get(socket.id)!;
        state.latency = Date.now() - state.lastPing;
        this.connectionStates.set(socket.id, state);
      });

      // Monitor system metrics
      this.systemMonitor.recordConnection(socket.id);
    });

    // Setup error handling
    this.io.on('error', (error) => {
      this.error('WebSocket error:', error);
      this.systemMonitor.recordError('websocket', error);
    });
  }

  // Public methods for managing connections
  public getConnectionState(socketId: string): ConnectionState | undefined {
    return this.connectionStates.get(socketId);
  }

  public getAllConnections(): Map<string, ConnectionState> {
    return new Map(this.connectionStates);
  }

  public disconnectClient(socketId: string, reason?: string): void {
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.disconnect(true);
      this.connectionStates.delete(socketId);
    }
  }

  // Broadcasting methods
  public broadcast(event: string, data: any, room?: string): void {
    if (room) {
      this.io.to(room).emit(event, data);
    } else {
      this.io.emit(event, data);
    }
  }

  public broadcastBatch(events: { event: string; data: any }[], room?: string): void {
    events.forEach(({ event, data }) => {
      this.broadcast(event, data, room);
    });
  }

  // Room management
  public joinRoom(socketId: string, room: string): void {
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.join(room);
    }
  }

  public leaveRoom(socketId: string, room: string): void {
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.leave(room);
    }
  }

  // Utility methods
  public getActiveConnections(): number {
    return this.io.sockets.sockets.size;
  }

  public getRoomSize(room: string): number {
    return this.io.sockets.adapter.rooms.get(room)?.size ?? 0;
  }

  public getConnectionLatency(socketId: string): number {
    return this.connectionStates.get(socketId)?.latency ?? -1;
  }

  // Helper methods
  private updateConnectionState(socketId: string, status: ConnectionState['status']): void {
    this.log(`Updating connection state for ${socketId} to ${status}`);
    const state = this.connectionStates.get(socketId);
    if (state) {
      this.log(`Previous state for ${socketId}: ${JSON.stringify(state)}`);
      this.connectionStates.set(socketId, {
        ...state,
        status
      });
      this.log(`Updated state for ${socketId}: ${JSON.stringify(this.connectionStates.get(socketId))}`);
    } else {
      this.log(`No existing state found for ${socketId}`);
    }
  }

  // Configuration updates
  public updateConfig(config: Partial<WebSocketConfig>): void {
    this.config = { ...this.config, ...config };
    // Apply relevant changes to socket.io instance
    if (config.pingInterval) {
      this.io.engine.opts.pingInterval = config.pingInterval;
    }
    if (config.timeout) {
      this.io.engine.opts.pingTimeout = config.timeout;
    }
  }
}
