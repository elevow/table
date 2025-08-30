export interface ResourceUtilization {
  cpu: number;    // CPU usage percentage (0-100)
  memory: number; // Memory usage in MB
  network: number;// Network throughput in KB/s
}

export interface SystemMetrics {
  activeTables: number;
  activePlayers: number;
  messageRate: number;  // Messages per second
  resourceUtilization: ResourceUtilization;
}

export interface TableMetrics {
  tableId: string;
  playerCount: number;
  messagesPerSecond: number;
  lastActivity: number;
}

export interface LoadBalancingMetrics {
  totalCapacity: number;     // Maximum number of supported tables
  currentLoad: number;       // Current load percentage (0-100)
  tablesPerNode: number;     // Average tables per node
  nodeCount: number;         // Number of active nodes
}

export interface SystemAlert {
  type: 'warning' | 'critical';
  metric: keyof SystemMetrics | keyof ResourceUtilization | 'errors';
  current: number;
  threshold: number;
  timestamp: number;
}
