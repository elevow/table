import { PerformanceMetrics } from '../types/state-update';

export class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    actionLatency: 0,
    stateUpdateLatency: 0,
    messageQueueLength: 0,
    clientFPS: 60
  };

  private actionTimestamps: Map<string, number> = new Map();
  private stateUpdateTimestamps: Map<string, number> = new Map();
  private messageQueue: string[] = [];
  private fpsHistory: number[] = [];
  private lastFrameTime: number = 0;
  
  private static instance: PerformanceMonitor;

  private constructor() {}

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  startActionTracking(actionId: string): void {
    this.actionTimestamps.set(actionId, Date.now());
  }

  endActionTracking(actionId: string): void {
    const startTime = this.actionTimestamps.get(actionId);
    if (startTime) {
      const latency = Date.now() - startTime;
      this.metrics.actionLatency = this.calculateMovingAverage(this.metrics.actionLatency, latency);
      this.actionTimestamps.delete(actionId);
    }
  }

  startStateUpdateTracking(updateId: string): void {
    this.stateUpdateTimestamps.set(updateId, Date.now());
  }

  endStateUpdateTracking(updateId: string): void {
    const startTime = this.stateUpdateTimestamps.get(updateId);
    if (startTime) {
      const latency = Date.now() - startTime;
      this.metrics.stateUpdateLatency = this.calculateMovingAverage(this.metrics.stateUpdateLatency, latency);
      this.stateUpdateTimestamps.delete(updateId);
    }
  }

  trackMessageQueue(queueLength: number): void {
    this.metrics.messageQueueLength = queueLength;
  }

  updateFPS(): void {
    const now = performance.now();
    if (this.lastFrameTime) {
      const deltaTime = now - this.lastFrameTime;
      const currentFPS = 1000 / deltaTime;
      this.fpsHistory.push(currentFPS);
      
      // Keep last 60 frames for average
      if (this.fpsHistory.length > 60) {
        this.fpsHistory.shift();
      }
      
      this.metrics.clientFPS = this.fpsHistory.reduce((a, b) => a + b) / this.fpsHistory.length;
    }
    this.lastFrameTime = now;
  }

  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  checkPerformanceThresholds(): boolean {
    return (
      this.metrics.actionLatency < 100 &&
      this.metrics.stateUpdateLatency < 50 &&
      this.metrics.clientFPS >= 30 &&
      this.metrics.messageQueueLength < 100
    );
  }

  private calculateMovingAverage(currentAvg: number, newValue: number, weight: number = 0.1): number {
    return currentAvg * (1 - weight) + newValue * weight;
  }
}
