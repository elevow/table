import { WebSocketManager } from './websocket-manager';
import { BroadcastConfig, MessageBatch, GameEvent, LoadBalancerStats } from '../types/broadcast';
import { SystemMonitor } from './system-monitor';

export class BroadcastManager {
  private static instance: BroadcastManager;
  private wsManager: WebSocketManager;
  private systemMonitor: SystemMonitor;
  private messageQueue: Map<string, GameEvent[]>;
  private batchSequence: number;
  private batchTimers: Map<string, NodeJS.Timeout>;
  private config: BroadcastConfig;
  private stats: LoadBalancerStats;

  private constructor(wsManager: WebSocketManager, config: Partial<BroadcastConfig> = {}) {
    this.wsManager = wsManager;
    this.systemMonitor = SystemMonitor.getInstance();
    this.messageQueue = new Map();
    this.batchSequence = 0;
    this.batchTimers = new Map();
    
    // Default configuration
    this.config = {
      batchSize: config.batchSize ?? 10,
      batchInterval: config.batchInterval ?? 100,
      compression: config.compression ?? false,
      priority: config.priority ?? 'normal',
      targets: config.targets ?? []
    };

    this.stats = {
      activeConnections: 0,
      messageRate: 0,
      batchRate: 0,
      avgBatchSize: 0,
      compressionRatio: 1
    };

    this.setupMetricsTracking();
  }

  static getInstance(wsManager?: WebSocketManager, config?: Partial<BroadcastConfig>): BroadcastManager {
    if (!BroadcastManager.instance && wsManager) {
      BroadcastManager.instance = new BroadcastManager(wsManager, config);
    }
    return BroadcastManager.instance;
  }

  private setupMetricsTracking(): void {
    setInterval(() => {
      this.stats.activeConnections = this.wsManager.getActiveConnections();
      this.updateLoadBalancerStats();
    }, 1000);
  }

  public broadcast(event: GameEvent): void {
    const target = event.target || 'global';
    if (!this.messageQueue.has(target)) {
      this.messageQueue.set(target, []);
      this.setupBatchTimer(target);
    }
    this.messageQueue.get(target)!.push(event);

    // Process high priority messages immediately
    if (event.priority === 'high') {
      this.processBatch(target);
    }
    // Process batch if size threshold reached
    else if (this.messageQueue.get(target)!.length >= this.config.batchSize) {
      this.processBatch(target);
    }
  }

  private setupBatchTimer(target: string): void {
    if (this.batchTimers.has(target)) {
      clearInterval(this.batchTimers.get(target)!);
    }

    const timer = setInterval(() => {
      if (this.messageQueue.get(target)?.length) {
        this.processBatch(target);
      }
    }, this.config.batchInterval);

    this.batchTimers.set(target, timer);
  }

  private processBatch(target: string): void {
    const messages = this.messageQueue.get(target) || [];
    if (!messages.length) return;

    const batch: MessageBatch = {
      sequence: ++this.batchSequence,
      timestamp: Date.now(),
      messages: messages,
      compression: this.config.compression ? 'gzip' : 'none'
    };

    // Clear the queue before sending to prevent message loss during processing
    this.messageQueue.set(target, []);

    if (target === 'global') {
      this.wsManager.broadcast('gameEvent', batch);
    } else {
      this.wsManager.broadcast('gameEvent', batch, target);
    }

    this.updateStats(batch);
  }

  private updateStats(batch: MessageBatch): void {
    this.stats.messageRate += batch.messages.length;
    this.stats.batchRate++;
    this.stats.avgBatchSize = this.stats.messageRate / this.stats.batchRate;
  }

  private updateLoadBalancerStats(): void {
    // Reset counters every second
    this.stats.messageRate = 0;
    this.stats.batchRate = 0;
    this.systemMonitor.recordError('broadcast_stats', this.stats);
  }

  public getStats(): LoadBalancerStats {
    return { ...this.stats };
  }

  public updateConfig(config: Partial<BroadcastConfig>): void {
    this.config = { ...this.config, ...config };

    // Reset all batch timers with new interval
    if (config.batchInterval) {
      for (const [target, timer] of this.batchTimers) {
        clearInterval(timer);
        this.setupBatchTimer(target);
      }
    }
  }

  public clearQueue(target?: string): void {
    if (target) {
      this.messageQueue.delete(target);
      const timer = this.batchTimers.get(target);
      if (timer) {
        clearInterval(timer);
        this.batchTimers.delete(target);
      }
    } else {
      this.messageQueue.clear();
      for (const timer of this.batchTimers.values()) {
        clearInterval(timer);
      }
      this.batchTimers.clear();
    }
  }
}
