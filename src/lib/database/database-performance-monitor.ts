/**
 * US-011: Database Performance Monitor
 * 
 * Monitors database performance metrics, query patterns, and system health
 * Provides real-time insights and alerting for database optimization
 */

import { DatabaseClient, DatabasePool } from './database-connection';

export interface DatabaseMetrics {
  connections: {
    active: number;
    idle: number;
    total: number;
    maxCapacity: number;
    utilization: number;
  };
  queries: {
    totalExecuted: number;
    averageResponseTime: number;
    slowQueries: number;
    queriesPerSecond: number;
    errorRate: number;
  };
  resources: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    networkLatency: number;
  };
  cache: {
    hitRatio: number;
    evictions: number;
    size: number;
    maxSize: number;
  };
  locks: {
    totalLocks: number;
    waitingLocks: number;
    deadlocks: number;
    avgLockWaitTime: number;
  };
}

export interface QueryAnalytics {
  topSlowQueries: Array<{
    query: string;
    avgExecutionTime: number;
    executionCount: number;
    lastExecuted: Date;
  }>;
  queryPatterns: Array<{
    pattern: string;
    frequency: number;
    avgExecutionTime: number;
  }>;
  indexUsage: Array<{
    tableName: string;
    indexName: string;
    usageCount: number;
    efficiency: number;
  }>;
  tableScanFrequency: Array<{
    tableName: string;
    scanCount: number;
    avgScanTime: number;
  }>;
}

export interface PerformanceAlert {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metric: string;
  threshold: number;
  currentValue: number;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
}

export interface MonitoringConfig {
  enabled: boolean;
  samplingInterval: number; // milliseconds
  alertThresholds: {
    slowQueryTime: number;
    connectionUtilization: number;
    errorRate: number;
    cacheHitRatio: number;
    lockWaitTime: number;
  };
  retentionPeriod: number; // days
  enableRealTimeAlerts: boolean;
}

/**
 * Comprehensive database performance monitoring service
 */
export class DatabasePerformanceMonitor {
  private metrics: DatabaseMetrics;
  private queryAnalytics: QueryAnalytics;
  private alerts: PerformanceAlert[] = [];
  private monitoringInterval?: NodeJS.Timeout;
  private queryHistory: Array<{
    query: string;
    executionTime: number;
    timestamp: Date;
    error?: string;
  }> = [];
  
  private readonly maxHistorySize = 10000;

  constructor(
    private dbPool: DatabasePool,
    private config: MonitoringConfig
  ) {
    this.metrics = this.initializeMetrics();
    this.queryAnalytics = this.initializeQueryAnalytics();
    
    if (config.enabled) {
      this.startMonitoring();
    }
  }

  /**
   * Start continuous monitoring
   */
  startMonitoring(): void {
    if (this.monitoringInterval) return;
    
    this.monitoringInterval = setInterval(
      () => this.collectMetrics(),
      this.config.samplingInterval
    );
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }

  /**
   * Record a query execution for analysis
   */
  recordQueryExecution(
    query: string,
    executionTime: number,
    success: boolean,
    error?: string
  ): void {
    this.queryHistory.push({
      query: query.substring(0, 500), // Truncate long queries
      executionTime,
      timestamp: new Date(),
      error: success ? undefined : error
    });

    // Maintain history size limit
    if (this.queryHistory.length > this.maxHistorySize) {
      this.queryHistory = this.queryHistory.slice(-this.maxHistorySize);
    }

    // Update metrics immediately
    this.updateQueryMetrics();

    // Check for performance alerts
    this.checkPerformanceAlerts(query, executionTime, success);
  }

  /**
   * Get current database metrics
   */
  getCurrentMetrics(): DatabaseMetrics {
    return { ...this.metrics };
  }

  /**
   * Get query analytics
   */
  getQueryAnalytics(): QueryAnalytics {
    this.updateQueryAnalytics();
    return { ...this.queryAnalytics };
  }

  /**
   * Get active performance alerts
   */
  getActiveAlerts(): PerformanceAlert[] {
    return this.alerts.filter(alert => !alert.acknowledged);
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
    }
  }

  /**
   * Get performance recommendations
   */
  getPerformanceRecommendations(): {
    indexRecommendations: string[];
    queryOptimizations: string[];
    configurationTuning: string[];
    resourceRecommendations: string[];
  } {
    const recommendations = {
      indexRecommendations: this.generateIndexRecommendations(),
      queryOptimizations: this.generateQueryOptimizations(),
      configurationTuning: this.generateConfigurationRecommendations(),
      resourceRecommendations: this.generateResourceRecommendations()
    };

    return recommendations;
  }

  /**
   * Get historical performance trends
   */
  getPerformanceTrends(timeRange: { start: Date; end: Date }): {
    responseTimeTrend: Array<{ timestamp: Date; value: number }>;
    throughputTrend: Array<{ timestamp: Date; value: number }>;
    errorRateTrend: Array<{ timestamp: Date; value: number }>;
    connectionUtilizationTrend: Array<{ timestamp: Date; value: number }>;
  } {
    const filteredHistory = this.queryHistory.filter(
      q => q.timestamp >= timeRange.start && q.timestamp <= timeRange.end
    );

    return {
      responseTimeTrend: this.calculateResponseTimeTrend(filteredHistory),
      throughputTrend: this.calculateThroughputTrend(filteredHistory),
      errorRateTrend: this.calculateErrorRateTrend(filteredHistory),
      connectionUtilizationTrend: this.calculateConnectionTrend()
    };
  }

  /**
   * Export metrics for external monitoring systems
   */
  exportMetrics(): {
    prometheus: string;
    json: object;
    csv: string;
  } {
    return {
      prometheus: this.formatPrometheusMetrics(),
      json: this.formatJsonMetrics(),
      csv: this.formatCsvMetrics()
    };
  }

  /**
   * Cleanup old data and optimize memory usage
   */
  cleanup(): void {
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() - this.config.retentionPeriod);

    // Clean old query history
    this.queryHistory = this.queryHistory.filter(
      q => q.timestamp > retentionDate
    );

    // Clean old alerts
    this.alerts = this.alerts.filter(
      alert => alert.timestamp > retentionDate && !alert.acknowledged
    );
  }

  // Private methods

  private initializeMetrics(): DatabaseMetrics {
    return {
      connections: {
        active: 0,
        idle: 0,
        total: 0,
        maxCapacity: 10,
        utilization: 0
      },
      queries: {
        totalExecuted: 0,
        averageResponseTime: 0,
        slowQueries: 0,
        queriesPerSecond: 0,
        errorRate: 0
      },
      resources: {
        cpuUsage: 0,
        memoryUsage: 0,
        diskUsage: 0,
        networkLatency: 0
      },
      cache: {
        hitRatio: 0,
        evictions: 0,
        size: 0,
        maxSize: 1000
      },
      locks: {
        totalLocks: 0,
        waitingLocks: 0,
        deadlocks: 0,
        avgLockWaitTime: 0
      }
    };
  }

  private initializeQueryAnalytics(): QueryAnalytics {
    return {
      topSlowQueries: [],
      queryPatterns: [],
      indexUsage: [],
      tableScanFrequency: []
    };
  }

  private async collectMetrics(): Promise<void> {
    try {
      // Update connection metrics
      await this.updateConnectionMetrics();
      
      // Update query metrics
      this.updateQueryMetrics();
      
      // Update resource metrics (mock implementation)
      this.updateResourceMetrics();
      
      // Update cache metrics
      this.updateCacheMetrics();
      
      // Update analytics
      this.updateQueryAnalytics();
      
    } catch (error) {
      console.error('Error collecting database metrics:', error);
    }
  }

  private async updateConnectionMetrics(): Promise<void> {
    // In a real implementation, this would query the database for connection stats
    // For now, we'll simulate metrics based on current activity
    try {
      // US-043: If pool exposes stats, use them
      const stats = this.dbPool.getStats?.();
      if (stats) {
        this.metrics.connections.total = stats.total;
        this.metrics.connections.idle = stats.idle;
        this.metrics.connections.maxCapacity = stats.max;
        const active = Math.max(0, stats.total - stats.idle);
        this.metrics.connections.active = active;
        this.metrics.connections.utilization = (active / Math.max(1, stats.max)) * 100;
        return;
      }
    } catch {}

    // Fallback simulated metrics
    this.metrics.connections.total = this.metrics.connections.active + this.metrics.connections.idle;
    this.metrics.connections.utilization = (this.metrics.connections.active / this.metrics.connections.maxCapacity) * 100;
  }

  private updateQueryMetrics(): void {
    const recentQueries = this.queryHistory.slice(-100);
    
    if (recentQueries.length > 0) {
      const totalTime = recentQueries.reduce((sum, q) => sum + q.executionTime, 0);
      const errors = recentQueries.filter(q => q.error).length;
      const slowQueries = recentQueries.filter(
        q => q.executionTime > this.config.alertThresholds.slowQueryTime
      ).length;

      this.metrics.queries.totalExecuted = this.queryHistory.length;
      this.metrics.queries.averageResponseTime = totalTime / recentQueries.length;
      this.metrics.queries.errorRate = (errors / recentQueries.length) * 100;
      this.metrics.queries.slowQueries = slowQueries;
      
      // Calculate QPS based on recent activity
      const timeSpan = Math.max(1, 
        (recentQueries[recentQueries.length - 1]?.timestamp.getTime() - 
         recentQueries[0]?.timestamp.getTime()) / 1000
      );
      this.metrics.queries.queriesPerSecond = recentQueries.length / timeSpan;
    }
  }

  private updateResourceMetrics(): void {
    // Mock resource metrics - in real implementation, would query system stats
    this.metrics.resources.cpuUsage = Math.random() * 100;
    this.metrics.resources.memoryUsage = Math.random() * 100;
    this.metrics.resources.diskUsage = Math.random() * 100;
    this.metrics.resources.networkLatency = Math.random() * 50;
  }

  private updateCacheMetrics(): void {
    // Mock cache metrics - in real implementation, would query cache stats
    this.metrics.cache.hitRatio = 75 + Math.random() * 20; // 75-95%
    this.metrics.cache.size = Math.floor(Math.random() * this.metrics.cache.maxSize);
  }

  private updateQueryAnalytics(): void {
    const recentQueries = this.queryHistory.slice(-1000);
    
    // Update top slow queries
    this.queryAnalytics.topSlowQueries = this.calculateTopSlowQueries(recentQueries);
    
    // Update query patterns
    this.queryAnalytics.queryPatterns = this.calculateQueryPatterns(recentQueries);
    
    // Update table scan frequency
    this.queryAnalytics.tableScanFrequency = this.calculateTableScans(recentQueries);
  }

  private calculateTopSlowQueries(queries: typeof this.queryHistory): typeof this.queryAnalytics.topSlowQueries {
    const queryStats = new Map<string, { totalTime: number; count: number; lastExecuted: Date }>();
    
    queries.forEach(q => {
      const normalizedQuery = this.normalizeQuery(q.query);
      const stats = queryStats.get(normalizedQuery) || { totalTime: 0, count: 0, lastExecuted: q.timestamp };
      
      stats.totalTime += q.executionTime;
      stats.count++;
      if (q.timestamp > stats.lastExecuted) {
        stats.lastExecuted = q.timestamp;
      }
      
      queryStats.set(normalizedQuery, stats);
    });

    return Array.from(queryStats.entries())
      .map(([query, stats]) => ({
        query,
        avgExecutionTime: stats.totalTime / stats.count,
        executionCount: stats.count,
        lastExecuted: stats.lastExecuted
      }))
      .sort((a, b) => b.avgExecutionTime - a.avgExecutionTime)
      .slice(0, 10);
  }

  private calculateQueryPatterns(queries: typeof this.queryHistory): typeof this.queryAnalytics.queryPatterns {
    const patterns = new Map<string, { totalTime: number; count: number }>();
    
    queries.forEach(q => {
      const pattern = this.extractQueryPattern(q.query);
      const stats = patterns.get(pattern) || { totalTime: 0, count: 0 };
      
      stats.totalTime += q.executionTime;
      stats.count++;
      
      patterns.set(pattern, stats);
    });

    return Array.from(patterns.entries())
      .map(([pattern, stats]) => ({
        pattern,
        frequency: stats.count,
        avgExecutionTime: stats.totalTime / stats.count
      }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);
  }

  private calculateTableScans(queries: typeof this.queryHistory): typeof this.queryAnalytics.tableScanFrequency {
    // Mock implementation - in real scenario, would analyze query plans
    const tables = ['players', 'game_history', 'player_actions', 'user_sessions'];
    
    return tables.map(table => ({
      tableName: table,
      scanCount: Math.floor(Math.random() * 100),
      avgScanTime: Math.random() * 1000
    }));
  }

  private checkPerformanceAlerts(query: string, executionTime: number, success: boolean): void {
    if (!this.config.enableRealTimeAlerts) return;

    // Check slow query alert
    if (executionTime > this.config.alertThresholds.slowQueryTime) {
      this.createAlert(
        'high',
        'slow_query',
        this.config.alertThresholds.slowQueryTime,
        executionTime,
        `Slow query detected: ${executionTime}ms`
      );
    }

    // Check error rate alert
    if (!success) {
      const recentErrors = this.queryHistory.slice(-100).filter(q => q.error).length;
      const errorRate = (recentErrors / 100) * 100;
      
      if (errorRate > this.config.alertThresholds.errorRate) {
        this.createAlert(
          'medium',
          'error_rate',
          this.config.alertThresholds.errorRate,
          errorRate,
          `High error rate detected: ${errorRate}%`
        );
      }
    }

    // Check connection utilization
    if (this.metrics.connections.utilization > this.config.alertThresholds.connectionUtilization) {
      this.createAlert(
        'medium',
        'connection_utilization',
        this.config.alertThresholds.connectionUtilization,
        this.metrics.connections.utilization,
        `High connection utilization: ${this.metrics.connections.utilization}%`
      );
    }
  }

  private createAlert(
    severity: PerformanceAlert['severity'],
    metric: string,
    threshold: number,
    currentValue: number,
    message: string
  ): void {
    const alert: PerformanceAlert = {
      id: `${metric}_${Date.now()}`,
      severity,
      metric,
      threshold,
      currentValue,
      message,
      timestamp: new Date(),
      acknowledged: false
    };

    this.alerts.push(alert);
    
    // Keep only recent alerts
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-1000);
    }
  }

  private normalizeQuery(query: string): string {
    // Normalize query by removing parameters and excess whitespace
    return query
      .replace(/\$\d+|\?|'[^']*'/g, '?') // Replace parameters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .toLowerCase();
  }

  private extractQueryPattern(query: string): string {
    const match = query.match(/^\s*(\w+)/i);
    return match ? match[1].toUpperCase() : 'UNKNOWN';
  }

  private generateIndexRecommendations(): string[] {
    // Analyze slow queries and recommend indexes
    const recommendations: string[] = [];
    
    this.queryAnalytics.topSlowQueries.forEach(slowQuery => {
      if (slowQuery.avgExecutionTime > 1000) {
        recommendations.push(
          `Consider adding index for query pattern: ${slowQuery.query.substring(0, 100)}...`
        );
      }
    });

    return recommendations;
  }

  private generateQueryOptimizations(): string[] {
    const optimizations: string[] = [];
    
    if (this.metrics.queries.averageResponseTime > 500) {
      optimizations.push('Review query patterns - average response time is high');
    }
    
    if (this.metrics.queries.errorRate > 5) {
      optimizations.push('Investigate query errors - error rate exceeds 5%');
    }

    return optimizations;
  }

  private generateConfigurationRecommendations(): string[] {
    const recommendations: string[] = [];
    
    if (this.metrics.connections.utilization > 80) {
      recommendations.push('Consider increasing connection pool size');
    }
    
    if (this.metrics.cache.hitRatio < 70) {
      recommendations.push('Consider tuning cache configuration');
    }

    return recommendations;
  }

  private generateResourceRecommendations(): string[] {
    const recommendations: string[] = [];
    
    if (this.metrics.resources.memoryUsage > 85) {
      recommendations.push('Consider increasing memory allocation');
    }
    
    if (this.metrics.resources.cpuUsage > 80) {
      recommendations.push('Consider CPU optimization or scaling');
    }

    return recommendations;
  }

  private calculateResponseTimeTrend(queries: typeof this.queryHistory): Array<{ timestamp: Date; value: number }> {
    // Group queries by time windows and calculate average response time
    const windows = new Map<number, { total: number; count: number }>();
    const windowSize = 60000; // 1 minute windows
    
    queries.forEach(q => {
      const window = Math.floor(q.timestamp.getTime() / windowSize) * windowSize;
      const stats = windows.get(window) || { total: 0, count: 0 };
      stats.total += q.executionTime;
      stats.count++;
      windows.set(window, stats);
    });

    return Array.from(windows.entries())
      .map(([timestamp, stats]) => ({
        timestamp: new Date(timestamp),
        value: stats.total / stats.count
      }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private calculateThroughputTrend(queries: typeof this.queryHistory): Array<{ timestamp: Date; value: number }> {
    const windows = new Map<number, number>();
    const windowSize = 60000; // 1 minute windows
    
    queries.forEach(q => {
      const window = Math.floor(q.timestamp.getTime() / windowSize) * windowSize;
      windows.set(window, (windows.get(window) || 0) + 1);
    });

    return Array.from(windows.entries())
      .map(([timestamp, count]) => ({
        timestamp: new Date(timestamp),
        value: count
      }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private calculateErrorRateTrend(queries: typeof this.queryHistory): Array<{ timestamp: Date; value: number }> {
    const windows = new Map<number, { total: number; errors: number }>();
    const windowSize = 60000; // 1 minute windows
    
    queries.forEach(q => {
      const window = Math.floor(q.timestamp.getTime() / windowSize) * windowSize;
      const stats = windows.get(window) || { total: 0, errors: 0 };
      stats.total++;
      if (q.error) stats.errors++;
      windows.set(window, stats);
    });

    return Array.from(windows.entries())
      .map(([timestamp, stats]) => ({
        timestamp: new Date(timestamp),
        value: stats.total > 0 ? (stats.errors / stats.total) * 100 : 0
      }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private calculateConnectionTrend(): Array<{ timestamp: Date; value: number }> {
    // Mock connection trend data
    const now = new Date();
    const trend = [];
    
    for (let i = 59; i >= 0; i--) {
      const timestamp = new Date(now.getTime() - i * 60000);
      const value = this.metrics.connections.utilization + (Math.random() - 0.5) * 20;
      trend.push({ timestamp, value: Math.max(0, Math.min(100, value)) });
    }
    
    return trend;
  }

  private formatPrometheusMetrics(): string {
    const metrics = [
      `db_connections_active ${this.metrics.connections.active}`,
      `db_connections_utilization ${this.metrics.connections.utilization}`,
      `db_queries_total ${this.metrics.queries.totalExecuted}`,
      `db_query_duration_avg ${this.metrics.queries.averageResponseTime}`,
      `db_queries_slow_total ${this.metrics.queries.slowQueries}`,
      `db_error_rate ${this.metrics.queries.errorRate}`,
      `db_cache_hit_ratio ${this.metrics.cache.hitRatio}`,
      `db_resource_cpu_usage ${this.metrics.resources.cpuUsage}`,
      `db_resource_memory_usage ${this.metrics.resources.memoryUsage}`
    ];
    
    return metrics.join('\n');
  }

  private formatJsonMetrics(): object {
    return {
      timestamp: new Date().toISOString(),
      metrics: this.metrics,
      analytics: this.queryAnalytics,
      alerts: this.alerts.filter(a => !a.acknowledged)
    };
  }

  private formatCsvMetrics(): string {
    const headers = [
      'timestamp',
      'active_connections',
      'connection_utilization',
      'total_queries',
      'avg_response_time',
      'slow_queries',
      'error_rate',
      'cache_hit_ratio'
    ];
    
    const values = [
      new Date().toISOString(),
      this.metrics.connections.active,
      this.metrics.connections.utilization,
      this.metrics.queries.totalExecuted,
      this.metrics.queries.averageResponseTime,
      this.metrics.queries.slowQueries,
      this.metrics.queries.errorRate,
      this.metrics.cache.hitRatio
    ];
    
    return `${headers.join(',')}\n${values.join(',')}`;
  }
}

/**
 * Factory for creating database performance monitor instances
 */
export class DatabasePerformanceMonitorFactory {
  static create(
    dbPool: DatabasePool,
    config?: Partial<MonitoringConfig>
  ): DatabasePerformanceMonitor {
    const defaultConfig: MonitoringConfig = {
      enabled: true,
      samplingInterval: 30000, // 30 seconds
      alertThresholds: {
        slowQueryTime: 1000, // 1 second
        connectionUtilization: 80, // 80%
        errorRate: 5, // 5%
        cacheHitRatio: 70, // 70%
        lockWaitTime: 500 // 500ms
      },
      retentionPeriod: 7, // 7 days
      enableRealTimeAlerts: true
    };
    
    const mergedConfig = { ...defaultConfig, ...config };
    
    return new DatabasePerformanceMonitor(dbPool, mergedConfig);
  }
}
