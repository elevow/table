export interface BroadcastConfig {
  batchSize: number;      // Maximum number of messages per batch
  batchInterval: number;  // Time window for collecting messages (ms)
  compression: boolean;   // Whether to compress messages
  priority: 'high' | 'normal' | 'low';  // Message priority level
  targets: string[];     // Target room or user IDs
}

export interface MessageBatch {
  sequence: number;      // Sequence number for ordering
  timestamp: number;     // Batch creation timestamp
  messages: GameEvent[]; // Array of game events
  compression: 'none' | 'gzip' | 'binary';  // Compression type
}

export interface GameEvent {
  id: string;           // Unique event identifier
  type: string;         // Event type
  payload: any;         // Event data
  timestamp: number;    // Event creation time
  priority: 'high' | 'normal' | 'low';  // Event priority
  target?: string;      // Optional specific target (room/user)
}

export interface LoadBalancerStats {
  activeConnections: number;  // Current active connections
  messageRate: number;        // Messages per second
  batchRate: number;         // Batches per second
  avgBatchSize: number;      // Average messages per batch
  compressionRatio: number;  // Average compression ratio
}
