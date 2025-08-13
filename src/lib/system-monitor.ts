import { SystemMetrics, TableMetrics, LoadBalancingMetrics, SystemAlert, ResourceUtilization } from '../types/system-metrics';
import os from 'os';

export class SystemMonitor {
  private static instance: SystemMonitor;
  private metrics: SystemMetrics;
  private tables: Map<string, TableMetrics>;
  private messageHistory: number[];
  private connections: Map<string, number>;
  private errors: Map<string, number>;
  private readonly maxHistorySize = 60; // 1 minute of history at 1 sample/sec
  private alertHandlers: ((alert: SystemAlert) => void)[] = [];

  private testMode = false;

  private constructor() {
    this.reset();
  }

  static getInstance(): SystemMonitor {
    if (!SystemMonitor.instance) {
      SystemMonitor.instance = new SystemMonitor();
    }
    return SystemMonitor.instance;
  }

  // For testing purposes
  enableTestMode(): void {
    this.testMode = true;
    this.reset();
  }

  // For testing purposes
  disableTestMode(): void {
    this.testMode = false;
    this.reset();
  }

  // For testing purposes
  reset(): void {
    this.metrics = {
      activeTables: 0,
      activePlayers: 0,
      messageRate: 0,
      resourceUtilization: {
        cpu: 0,
        memory: 0,
        network: 0
      }
    };
    this.tables = new Map();
    this.messageHistory = [];
    this.connections = new Map();
    this.errors = new Map();
    this.alertHandlers = [];
    
    if (!this.testMode) {
      this.startMonitoring();
    }
  }

  // Table Management
  registerTable(tableId: string): void {
    if (this.tables.size >= 1000 && !this.testMode) {
      this.emitAlert({
        type: 'critical',
        metric: 'activeTables',
        current: this.tables.size + 1,
        threshold: 1000,
        timestamp: Date.now()
      });
      throw new Error('Maximum table limit reached');
    }

    this.tables.set(tableId, {
      tableId,
      playerCount: 0,
      messagesPerSecond: 0,
      lastActivity: Date.now()
    });
    this.metrics.activeTables = this.tables.size;
    this.updateMetrics();
  }

  unregisterTable(tableId: string): void {
    this.tables.delete(tableId);
    this.metrics.activeTables = this.tables.size;
    this.updateMetrics();
  }

  // Player Management
  playerJoined(tableId: string): void {
    const table = this.tables.get(tableId);
    if (table) {
      table.playerCount++;
      table.lastActivity = Date.now();
      this.metrics.activePlayers++;
    }
  }

  playerLeft(tableId: string): void {
    const table = this.tables.get(tableId);
    if (table && table.playerCount > 0) {
      table.playerCount--;
      table.lastActivity = Date.now();
      this.metrics.activePlayers--;
    }
  }

  // Message Tracking
  recordMessage(tableId: string): void {
    const table = this.tables.get(tableId);
    if (table) {
      table.messagesPerSecond++;
      table.lastActivity = Date.now();
      this.messageHistory.push(Date.now());
      this.updateMessageRate();
    }
  }

  // Resource Monitoring
  private async getResourceUtilization(): Promise<ResourceUtilization> {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    // Calculate CPU usage
    const cpuUsage = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b);
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total) * 100;
    }, 0) / cpus.length;

    // Calculate memory usage in MB
    const memoryUsage = (totalMem - freeMem) / (1024 * 1024);

    // Get network stats (simplified)
    const networkStats = Object.values(os.networkInterfaces())
      .flat()
      .filter(Boolean) as os.NetworkInterfaceInfo[];
    
    const networkUsage = networkStats.reduce((acc, interface_) => {
      return acc + (interface_.internal ? 0 : 1);
    }, 0);

    return {
      cpu: Math.round(cpuUsage),
      memory: Math.round(memoryUsage),
      network: networkUsage
    };
  }

  // Metrics Update
  private async updateMetrics(): Promise<void> {
    const resourceUtilization = await this.getResourceUtilization();
    
    this.metrics = {
      activeTables: this.tables.size,
      activePlayers: Array.from(this.tables.values())
        .reduce((sum, table) => sum + table.playerCount, 0),
      messageRate: this.calculateMessageRate(),
      resourceUtilization
    };

    this.checkThresholds();
  }

  private updateMessageRate(): void {
    const now = Date.now();
    
    // Keep only last minute of history
    const oneMinuteAgo = now - 60000;
    this.messageHistory = this.messageHistory.filter(time => time > oneMinuteAgo);
    
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }

    this.metrics.messageRate = this.calculateMessageRate();
  }

  private calculateMessageRate(): number {
    const now = Date.now();
    const lastSecond = now - 1000;
    return this.messageHistory.filter(time => time > lastSecond).length;
  }

  // Monitoring Loop
  private startMonitoring(): void {
    setInterval(() => {
      this.updateMetrics();
    }, 1000);
  }

  // Thresholds and Alerts
  private checkThresholds(): void {
    const thresholds = {
      activeTables: 1000,
      messageRate: 100, // Lower threshold for testing
      cpu: 80,
      memory: 0.8 * os.totalmem() / (1024 * 1024),
      network: 1000
    };

    if (this.metrics.activeTables > thresholds.activeTables) {
      this.emitAlert({
        type: 'critical',
        metric: 'activeTables',
        current: this.metrics.activeTables,
        threshold: thresholds.activeTables,
        timestamp: Date.now()
      });
    }

    if (this.metrics.messageRate > thresholds.messageRate) {
      this.emitAlert({
        type: 'warning',
        metric: 'messageRate',
        current: this.metrics.messageRate,
        threshold: thresholds.messageRate,
        timestamp: Date.now()
      });
    }

    if (this.metrics.resourceUtilization.cpu > thresholds.cpu) {
      this.emitAlert({
        type: 'warning',
        metric: 'cpu',
        current: this.metrics.resourceUtilization.cpu,
        threshold: thresholds.cpu,
        timestamp: Date.now()
      });
    }

    if (this.metrics.resourceUtilization.memory > thresholds.memory) {
      this.emitAlert({
        type: 'warning',
        metric: 'memory',
        current: this.metrics.resourceUtilization.memory,
        threshold: thresholds.memory,
        timestamp: Date.now()
      });
    }
  }

  // Alert System
  onAlert(handler: (alert: SystemAlert) => void): void {
    this.alertHandlers.push(handler);
  }

  private emitAlert(alert: SystemAlert): void {
    this.alertHandlers.forEach(handler => handler(alert));
  }

  // WebSocket monitoring
  public recordConnection(socketId: string): void {
    this.connections.set(socketId, Date.now());
    this.updateMetrics();
  }

  public recordError(type: string, error: any): void {
    const count = this.errors.get(type) ?? 0;
    this.errors.set(type, count + 1);
    
    this.emitAlert({
      type: 'warning',
      metric: 'errors',
      current: this.errors.size,
      threshold: 100,
      timestamp: Date.now()
    });
  }

  public getConnectionCount(): number {
    return this.connections.size;
  }

  public getErrorCount(type?: string): number {
    if (type) {
      return this.errors.get(type) ?? 0;
    }
    return Array.from(this.errors.values()).reduce((sum, count) => sum + count, 0);
  }

  // Public API
  getMetrics(): SystemMetrics {
    return { ...this.metrics };
  }

  getTableMetrics(tableId: string): TableMetrics | null {
    const table = this.tables.get(tableId);
    return table ? { ...table } : null;
  }

  getAllTableMetrics(): TableMetrics[] {
    return Array.from(this.tables.values()).map(table => ({ ...table }));
  }
}
