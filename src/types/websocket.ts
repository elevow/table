export interface WebSocketConfig {
  reconnectionAttempts: number;  // Maximum number of reconnection attempts
  reconnectionDelay: number;     // Delay between reconnection attempts in ms
  timeout: number;              // Connection timeout in ms
  pingInterval: number;         // Interval between ping messages in ms
  transport?: string; // Transport protocol - defaults to WebSocket
}

export interface ConnectionState {
  status: 'connected' | 'disconnected' | 'reconnecting';
  lastPing: number;           // Timestamp of last ping
  latency: number;           // Current connection latency in ms
  transport: string;         // Current transport protocol
}

export interface WebSocketError {
  code: number;
  message: string;
  timestamp: number;
}
