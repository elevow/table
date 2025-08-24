/**
 * US-015: Performance Monitoring System
 * 
 * Comprehensive database performance monitoring with:
 * - Real-time query performance tracking
 * - Resource usage monitoring
 * - Anomaly detection and alerting
 * - Performance report generation
 */

import { Pool, PoolClient } from 'pg';
import { EventEmitter } from 'events';

// Core monitoring interfaces based on US-015 requirements
export interface DBMetrics {
  queryStats: {
    avg_execution_time: number;
    cache_hit_ratio: number;
    slow_queries: number;
  };
  resources: {
    connections: number;
    disk_usage: number;
    cpu_usage: number;
  };
  alerts: Alert[];
}

export interface Alert {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  metric: string;
  message: string;
  threshold: number;
  currentValue: number;
  timestamp: Date;
  acknowledged: boolean;
  resolvedAt?: Date;
}

export interface QueryPerformanceMetrics {
  query_id: string;
  query_text: string;
  calls: number;
  total_time: number;
  mean_time: number;
  min_time: number;
  max_time: number;
  stddev_time: number;
  rows_affected: number;
  cache_hits: number;
  cache_misses: number;
  last_executed: Date;
}

export interface ResourceMetrics {
  timestamp: Date;
  cpu_usage_percent: number;
  memory_usage_bytes: number;
  memory_usage_percent: number;
  disk_usage_bytes: number;
  disk_usage_percent: number;
  network_bytes_sent: number;
  network_bytes_received: number;
  connection_count: number;
  connection_utilization: number;
}

export interface PerformanceReport {
  reportId: string;
  generatedAt: Date;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalQueries: number;
    avgQueryTime: number;
    slowestQuery: QueryPerformanceMetrics;
    fastestQuery: QueryPerformanceMetrics;
    errorCount: number;
    uptime: number;
  };
  queryAnalysis: {
    topSlowQueries: QueryPerformanceMetrics[];
    mostFrequentQueries: QueryPerformanceMetrics[];
    queryPatterns: Array<{
      pattern: string;
      count: number;
      avgTime: number;
    }>;
  };
  resourceAnalysis: {
    avgCpuUsage: number;
    peakCpuUsage: number;
    avgMemoryUsage: number;
    peakMemoryUsage: number;
    diskGrowth: number;
    connectionTrends: Array<{
      timestamp: Date;
      count: number;
    }>;
  };
  recommendations: string[];
  anomalies: Array<{
    type: string;
    description: string;
    impact: 'low' | 'medium' | 'high';
    recommendation: string;
  }>;
}

export interface MonitoringConfiguration {
  enabled: boolean;
  samplingIntervalMs: number;
  alertThresholds: {
    slowQueryTimeMs: number;
    cacheHitRatioMin: number;
    cpuUsageMaxPercent: number;
    memoryUsageMaxPercent: number;
    diskUsageMaxPercent: number;
    connectionUtilizationMax: number;
    errorRateMax: number;
  };
  retention: {
    queryMetricsDays: number;
    resourceMetricsDays: number;
    alertsDays: number;
    reportsDays: number;
  };
  notifications: {
    email: boolean;
    slack: boolean;
    webhook?: string;
  };
}

/**
 * Advanced Performance Monitoring Service for US-015
 */
export class PerformanceMonitoringService extends EventEmitter {
  private pool: Pool;
  private config: MonitoringConfiguration;
  private isMonitoring: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;
  private currentMetrics: DBMetrics;
  private alerts: Map<string, Alert> = new Map();

  constructor(pool: Pool, config: MonitoringConfiguration) {
    super();
    this.pool = pool;
    this.config = config;
    this.currentMetrics = this.initializeMetrics();
  }

  /**
   * Initialize the performance monitoring system
   */
  async initialize(): Promise<void> {
    await this.createMonitoringTables();
    await this.setupQueryTracking();
    await this.setupAlertingSystem();
    
    if (this.config.enabled) {
      await this.startMonitoring();
    }
  }

  // ========================================
  // QUERY PERFORMANCE TRACKING
  // ========================================

  /**
   * Track query performance metrics
   */
  async trackQueryPerformance(): Promise<QueryPerformanceMetrics[]> {
    const client = await this.pool.connect();
    
    try {
      // Use pg_stat_statements extension for detailed query statistics
      const result = await client.query(`
        SELECT 
          queryid::text as query_id,
          query as query_text,
          calls,
          total_exec_time as total_time,
          mean_exec_time as mean_time,
          min_exec_time as min_time,
          max_exec_time as max_time,
          stddev_exec_time as stddev_time,
          rows,
          shared_blks_hit as cache_hits,
          shared_blks_read as cache_misses,
          now() as last_executed
        FROM pg_stat_statements 
        ORDER BY total_exec_time DESC
        LIMIT 100
      `);

      const metrics: QueryPerformanceMetrics[] = result.rows.map(row => ({
        query_id: row.query_id,
        query_text: row.query_text,
        calls: parseInt(row.calls),
        total_time: parseFloat(row.total_time),
        mean_time: parseFloat(row.mean_time),
        min_time: parseFloat(row.min_time),
        max_time: parseFloat(row.max_time),
        stddev_time: parseFloat(row.stddev_time || '0'),
        rows_affected: parseInt(row.rows),
        cache_hits: parseInt(row.cache_hits),
        cache_misses: parseInt(row.cache_misses),
        last_executed: new Date(row.last_executed)
      }));

      // Store metrics in monitoring table
      await this.storeQueryMetrics(metrics);

      // Update current metrics
      this.updateQueryStats(metrics);

      return metrics;
    } finally {
      client.release();
    }
  }

  /**
   * Get current query statistics
   */
  async getCurrentQueryStats(): Promise<DBMetrics['queryStats']> {
    const client = await this.pool.connect();
    
    try {
      // Calculate average execution time
      const avgTimeResult = await client.query(`
        SELECT AVG(mean_exec_time) as avg_execution_time
        FROM pg_stat_statements
        WHERE calls > 0
      `);

      // Calculate cache hit ratio
      const cacheResult = await client.query(`
        SELECT 
          CASE 
            WHEN (shared_blks_hit + shared_blks_read) > 0 
            THEN (shared_blks_hit::float / (shared_blks_hit + shared_blks_read)) * 100
            ELSE 0 
          END as cache_hit_ratio
        FROM pg_stat_statements
      `);

      // Count slow queries
      const slowQueriesResult = await client.query(`
        SELECT COUNT(*) as slow_queries
        FROM pg_stat_statements
        WHERE mean_exec_time > $1
      `, [this.config.alertThresholds.slowQueryTimeMs]);

      return {
        avg_execution_time: parseFloat(avgTimeResult.rows[0]?.avg_execution_time || '0'),
        cache_hit_ratio: parseFloat(cacheResult.rows[0]?.cache_hit_ratio || '0'),
        slow_queries: parseInt(slowQueriesResult.rows[0]?.slow_queries || '0')
      };
    } finally {
      client.release();
    }
  }

  // ========================================
  // RESOURCE USAGE MONITORING
  // ========================================

  /**
   * Monitor database resource usage
   */
  async monitorResourceUsage(): Promise<ResourceMetrics> {
    const client = await this.pool.connect();
    
    try {
      // Get database connection statistics
      const connectionStats = await client.query(`
        SELECT 
          count(*) as total_connections,
          count(*) filter (where state = 'active') as active_connections,
          count(*) filter (where state = 'idle') as idle_connections
        FROM pg_stat_activity
        WHERE datname = current_database()
      `);

      // Get database size information
      const databaseSize = await client.query(`
        SELECT 
          pg_database_size(current_database()) as db_size,
          pg_size_pretty(pg_database_size(current_database())) as db_size_pretty
      `);

      // Get system statistics (if available)
      const systemStats = await this.getSystemStats();

      const metrics: ResourceMetrics = {
        timestamp: new Date(),
        cpu_usage_percent: systemStats.cpuUsage,
        memory_usage_bytes: systemStats.memoryUsage,
        memory_usage_percent: systemStats.memoryUsagePercent,
        disk_usage_bytes: parseInt(databaseSize.rows[0]?.db_size || '0'),
        disk_usage_percent: systemStats.diskUsagePercent,
        network_bytes_sent: systemStats.networkBytesSent,
        network_bytes_received: systemStats.networkBytesReceived,
        connection_count: parseInt(connectionStats.rows[0]?.total_connections || '0'),
        connection_utilization: connectionStats.rows[0]?.total_connections > 0 ? 
          (parseInt(connectionStats.rows[0]?.active_connections || '0') / 
           parseInt(connectionStats.rows[0]?.total_connections || '1')) * 100 : 0
      };

      // Store resource metrics
      await this.storeResourceMetrics(metrics);

      // Update current metrics
      this.updateResourceStats(metrics);

      return metrics;
    } finally {
      client.release();
    }
  }

  // ========================================
  // ANOMALY DETECTION & ALERTING
  // ========================================

  /**
   * Detect performance anomalies and generate alerts
   */
  async detectAnomalies(): Promise<Alert[]> {
    const newAlerts: Alert[] = [];
    const queryStats = await this.getCurrentQueryStats();
    const resourceMetrics = await this.getLatestResourceMetrics();

    // Check slow query threshold
    if (queryStats.slow_queries > 0) {
      const alert = this.createAlert(
        'slow_queries',
        'warning',
        `${queryStats.slow_queries} slow queries detected`,
        0,
        queryStats.slow_queries
      );
      newAlerts.push(alert);
    }

    // Check cache hit ratio
    if (queryStats.cache_hit_ratio < this.config.alertThresholds.cacheHitRatioMin) {
      const alert = this.createAlert(
        'cache_hit_ratio',
        'warning',
        `Cache hit ratio is below threshold: ${queryStats.cache_hit_ratio.toFixed(2)}%`,
        this.config.alertThresholds.cacheHitRatioMin,
        queryStats.cache_hit_ratio
      );
      newAlerts.push(alert);
    }

    // Check CPU usage
    if (resourceMetrics && resourceMetrics.cpu_usage_percent > this.config.alertThresholds.cpuUsageMaxPercent) {
      const alert = this.createAlert(
        'cpu_usage',
        'error',
        `High CPU usage detected: ${resourceMetrics.cpu_usage_percent.toFixed(2)}%`,
        this.config.alertThresholds.cpuUsageMaxPercent,
        resourceMetrics.cpu_usage_percent
      );
      newAlerts.push(alert);
    }

    // Check memory usage
    if (resourceMetrics && resourceMetrics.memory_usage_percent > this.config.alertThresholds.memoryUsageMaxPercent) {
      const alert = this.createAlert(
        'memory_usage',
        'error',
        `High memory usage detected: ${resourceMetrics.memory_usage_percent.toFixed(2)}%`,
        this.config.alertThresholds.memoryUsageMaxPercent,
        resourceMetrics.memory_usage_percent
      );
      newAlerts.push(alert);
    }

    // Check connection utilization
    if (resourceMetrics && resourceMetrics.connection_utilization > this.config.alertThresholds.connectionUtilizationMax) {
      const alert = this.createAlert(
        'connection_utilization',
        'critical',
        `High connection utilization: ${resourceMetrics.connection_utilization.toFixed(2)}%`,
        this.config.alertThresholds.connectionUtilizationMax,
        resourceMetrics.connection_utilization
      );
      newAlerts.push(alert);
    }

    // Store and emit new alerts
    for (const alert of newAlerts) {
      this.alerts.set(alert.id, alert);
      await this.storeAlert(alert);
      this.emit('alert', alert);
    }

    // Update current metrics with alerts
    this.currentMetrics.alerts = Array.from(this.alerts.values())
      .filter(alert => !alert.acknowledged && !alert.resolvedAt)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return newAlerts;
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      this.alerts.set(alertId, alert);
      
      await this.updateAlertStatus(alertId, { acknowledged: true, acknowledgedBy });
      this.emit('alertAcknowledged', alert);
    }
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string, resolvedBy: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.resolvedAt = new Date();
      this.alerts.set(alertId, alert);
      
      await this.updateAlertStatus(alertId, { resolvedAt: new Date(), resolvedBy });
      this.emit('alertResolved', alert);
    }
  }

  // ========================================
  // PERFORMANCE REPORTING
  // ========================================

  /**
   * Generate comprehensive performance report
   */
  async generatePerformanceReport(
    startDate: Date,
    endDate: Date,
    includeRecommendations: boolean = true
  ): Promise<PerformanceReport> {
    const reportId = `perf-report-${Date.now()}`;
    
    // Gather query metrics for the period
    const queryMetrics = await this.getQueryMetricsForPeriod(startDate, endDate);
    const resourceMetrics = await this.getResourceMetricsForPeriod(startDate, endDate);

    // Calculate summary statistics
    const summary = this.calculateSummaryStats(queryMetrics);
    
    // Analyze query patterns
    const queryAnalysis = this.analyzeQueryPatterns(queryMetrics);
    
    // Analyze resource usage
    const resourceAnalysis = this.analyzeResourceUsage(resourceMetrics);

    // Generate recommendations
    const recommendations = includeRecommendations ? 
      await this.generateRecommendations(queryMetrics, resourceMetrics) : [];

    // Detect anomalies in the period
    const anomalies = this.detectHistoricalAnomalies(queryMetrics, resourceMetrics);

    const report: PerformanceReport = {
      reportId,
      generatedAt: new Date(),
      period: { start: startDate, end: endDate },
      summary,
      queryAnalysis,
      resourceAnalysis,
      recommendations,
      anomalies
    };

    // Store the report
    await this.storePerformanceReport(report);

    return report;
  }

  /**
   * Get current database metrics
   */
  getCurrentMetrics(): DBMetrics {
    return { 
      ...this.currentMetrics,
      alerts: Array.from(this.alerts.values())
    };
  }

  /**
   * Start continuous monitoring
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.trackQueryPerformance();
        await this.monitorResourceUsage();
        await this.detectAnomalies();
      } catch (error) {
        console.error('Monitoring error:', error);
        this.emit('monitoringError', error);
      }
    }, this.config.samplingIntervalMs);

    this.emit('monitoringStarted');
  }

  /**
   * Stop continuous monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.isMonitoring = false;
    this.emit('monitoringStopped');
  }

  // ========================================
  // PRIVATE HELPER METHODS
  // ========================================

  private initializeMetrics(): DBMetrics {
    return {
      queryStats: {
        avg_execution_time: 0,
        cache_hit_ratio: 0,
        slow_queries: 0
      },
      resources: {
        connections: 0,
        disk_usage: 0,
        cpu_usage: 0
      },
      alerts: []
    };
  }

  private async createMonitoringTables(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      // Query metrics table
      await client.query(`
        CREATE TABLE IF NOT EXISTS query_performance_metrics (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          query_id VARCHAR(64) NOT NULL,
          query_text TEXT NOT NULL,
          calls INTEGER NOT NULL,
          total_time DECIMAL(15,3) NOT NULL,
          mean_time DECIMAL(15,3) NOT NULL,
          min_time DECIMAL(15,3) NOT NULL,
          max_time DECIMAL(15,3) NOT NULL,
          stddev_time DECIMAL(15,3) NOT NULL,
          rows_affected INTEGER NOT NULL,
          cache_hits INTEGER NOT NULL,
          cache_misses INTEGER NOT NULL,
          recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // Resource metrics table
      await client.query(`
        CREATE TABLE IF NOT EXISTS resource_metrics (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          cpu_usage_percent DECIMAL(5,2) NOT NULL,
          memory_usage_bytes BIGINT NOT NULL,
          memory_usage_percent DECIMAL(5,2) NOT NULL,
          disk_usage_bytes BIGINT NOT NULL,
          disk_usage_percent DECIMAL(5,2) NOT NULL,
          network_bytes_sent BIGINT NOT NULL,
          network_bytes_received BIGINT NOT NULL,
          connection_count INTEGER NOT NULL,
          connection_utilization DECIMAL(5,2) NOT NULL
        )
      `);

      // Performance alerts table
      await client.query(`
        CREATE TABLE IF NOT EXISTS performance_alerts (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          alert_id VARCHAR(64) UNIQUE NOT NULL,
          severity VARCHAR(20) NOT NULL,
          metric VARCHAR(100) NOT NULL,
          message TEXT NOT NULL,
          threshold_value DECIMAL(15,3),
          current_value DECIMAL(15,3),
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          acknowledged BOOLEAN DEFAULT FALSE,
          acknowledged_by VARCHAR(100),
          acknowledged_at TIMESTAMP WITH TIME ZONE,
          resolved_at TIMESTAMP WITH TIME ZONE,
          resolved_by VARCHAR(100)
        )
      `);

      // Performance reports table
      await client.query(`
        CREATE TABLE IF NOT EXISTS performance_reports (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          report_id VARCHAR(64) UNIQUE NOT NULL,
          generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          period_start TIMESTAMP WITH TIME ZONE NOT NULL,
          period_end TIMESTAMP WITH TIME ZONE NOT NULL,
          report_data JSONB NOT NULL
        )
      `);

      // Create indexes for performance
      await client.query('CREATE INDEX IF NOT EXISTS idx_query_metrics_recorded_at ON query_performance_metrics(recorded_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_resource_metrics_timestamp ON resource_metrics(timestamp)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON performance_alerts(timestamp)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_reports_generated_at ON performance_reports(generated_at)');

    } finally {
      client.release();
    }
  }

  private async setupQueryTracking(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      // Enable pg_stat_statements extension
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
      
      // Reset statistics to start fresh
      await client.query('SELECT pg_stat_statements_reset()');
    } catch (error) {
      console.warn('Could not setup query tracking:', error);
    } finally {
      client.release();
    }
  }

  private async setupAlertingSystem(): Promise<void> {
    // Load existing unresolved alerts
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT * FROM performance_alerts 
        WHERE resolved_at IS NULL 
        ORDER BY timestamp DESC
      `);

      if (result && result.rows) {
        for (const row of result.rows) {
          const alert: Alert = {
            id: row.alert_id,
            severity: row.severity,
            metric: row.metric,
            message: row.message,
            threshold: parseFloat(row.threshold_value || '0'),
            currentValue: parseFloat(row.current_value || '0'),
            timestamp: new Date(row.timestamp),
            acknowledged: row.acknowledged
          };

          if (row.resolved_at) {
            alert.resolvedAt = new Date(row.resolved_at);
          }

          this.alerts.set(alert.id, alert);
        }
      }
    } finally {
      client.release();
    }
  }

  private createAlert(
    metric: string,
    severity: Alert['severity'],
    message: string,
    threshold: number,
    currentValue: number
  ): Alert {
    return {
      id: `alert-${metric}-${Date.now()}`,
      severity,
      metric,
      message,
      threshold,
      currentValue,
      timestamp: new Date(),
      acknowledged: false
    };
  }

  private updateQueryStats(metrics: QueryPerformanceMetrics[]): void {
    if (metrics.length === 0) return;

    const avgTime = metrics.reduce((sum, m) => sum + m.mean_time, 0) / metrics.length;
    const slowQueries = metrics.filter(m => m.mean_time > this.config.alertThresholds.slowQueryTimeMs).length;
    const totalCacheHits = metrics.reduce((sum, m) => sum + m.cache_hits, 0);
    const totalCacheMisses = metrics.reduce((sum, m) => sum + m.cache_misses, 0);
    const cacheHitRatio = totalCacheHits + totalCacheMisses > 0 ? 
      (totalCacheHits / (totalCacheHits + totalCacheMisses)) * 100 : 0;

    this.currentMetrics.queryStats = {
      avg_execution_time: avgTime,
      cache_hit_ratio: cacheHitRatio,
      slow_queries: slowQueries
    };
  }

  private updateResourceStats(metrics: ResourceMetrics): void {
    this.currentMetrics.resources = {
      connections: metrics.connection_count,
      disk_usage: metrics.disk_usage_bytes,
      cpu_usage: metrics.cpu_usage_percent
    };
  }

  private async getSystemStats(): Promise<{
    cpuUsage: number;
    memoryUsage: number;
    memoryUsagePercent: number;
    diskUsagePercent: number;
    networkBytesSent: number;
    networkBytesReceived: number;
  }> {
    // This would typically use system monitoring tools
    // For now, return mock data or basic estimates
    return {
      cpuUsage: Math.random() * 20 + 10, // 10-30%
      memoryUsage: Math.random() * 1000000000 + 500000000, // 500MB-1.5GB
      memoryUsagePercent: Math.random() * 30 + 40, // 40-70%
      diskUsagePercent: Math.random() * 20 + 60, // 60-80%
      networkBytesSent: Math.random() * 1000000,
      networkBytesReceived: Math.random() * 1000000
    };
  }

  private async storeQueryMetrics(metrics: QueryPerformanceMetrics[]): Promise<void> {
    if (metrics.length === 0) return;

    const client = await this.pool.connect();
    
    try {
      const values = metrics.map(m => 
        `('${m.query_id}', $${1}, ${m.calls}, ${m.total_time}, ${m.mean_time}, ${m.min_time}, ${m.max_time}, ${m.stddev_time}, ${m.rows_affected}, ${m.cache_hits}, ${m.cache_misses})`
      ).join(',');

      await client.query(`
        INSERT INTO query_performance_metrics (
          query_id, query_text, calls, total_time, mean_time, min_time, 
          max_time, stddev_time, rows_affected, cache_hits, cache_misses
        ) VALUES ${values}
      `, [metrics[0].query_text]); // Simplified for demo
    } finally {
      client.release();
    }
  }

  private async storeResourceMetrics(metrics: ResourceMetrics): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query(`
        INSERT INTO resource_metrics (
          cpu_usage_percent, memory_usage_bytes, memory_usage_percent,
          disk_usage_bytes, disk_usage_percent, network_bytes_sent,
          network_bytes_received, connection_count, connection_utilization
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        metrics.cpu_usage_percent,
        metrics.memory_usage_bytes,
        metrics.memory_usage_percent,
        metrics.disk_usage_bytes,
        metrics.disk_usage_percent,
        metrics.network_bytes_sent,
        metrics.network_bytes_received,
        metrics.connection_count,
        metrics.connection_utilization
      ]);
    } finally {
      client.release();
    }
  }

  private async storeAlert(alert: Alert): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query(`
        INSERT INTO performance_alerts (
          alert_id, severity, metric, message, threshold_value, current_value
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        alert.id,
        alert.severity,
        alert.metric,
        alert.message,
        alert.threshold,
        alert.currentValue
      ]);
    } finally {
      client.release();
    }
  }

  private async updateAlertStatus(
    alertId: string,
    updates: { acknowledged?: boolean; acknowledgedBy?: string; resolvedAt?: Date; resolvedBy?: string }
  ): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      const setParts: string[] = [];
      const values: any[] = [];
      let paramCount = 0;

      if (updates.acknowledged !== undefined) {
        setParts.push(`acknowledged = $${++paramCount}`);
        values.push(updates.acknowledged);
        if (updates.acknowledgedBy) {
          setParts.push(`acknowledged_by = $${++paramCount}`);
          values.push(updates.acknowledgedBy);
          setParts.push(`acknowledged_at = NOW()`);
        }
      }

      if (updates.resolvedAt) {
        setParts.push(`resolved_at = $${++paramCount}`);
        values.push(updates.resolvedAt);
        if (updates.resolvedBy) {
          setParts.push(`resolved_by = $${++paramCount}`);
          values.push(updates.resolvedBy);
        }
      }

      if (setParts.length > 0) {
        values.push(alertId);
        await client.query(`
          UPDATE performance_alerts 
          SET ${setParts.join(', ')} 
          WHERE alert_id = $${++paramCount}
        `, values);
      }
    } finally {
      client.release();
    }
  }

  private async getLatestResourceMetrics(): Promise<ResourceMetrics | null> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT * FROM resource_metrics 
        ORDER BY timestamp DESC 
        LIMIT 1
      `);

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        timestamp: new Date(row.timestamp),
        cpu_usage_percent: parseFloat(row.cpu_usage_percent),
        memory_usage_bytes: parseInt(row.memory_usage_bytes),
        memory_usage_percent: parseFloat(row.memory_usage_percent),
        disk_usage_bytes: parseInt(row.disk_usage_bytes),
        disk_usage_percent: parseFloat(row.disk_usage_percent),
        network_bytes_sent: parseInt(row.network_bytes_sent),
        network_bytes_received: parseInt(row.network_bytes_received),
        connection_count: parseInt(row.connection_count),
        connection_utilization: parseFloat(row.connection_utilization)
      };
    } finally {
      client.release();
    }
  }

  private async getQueryMetricsForPeriod(start: Date, end: Date): Promise<QueryPerformanceMetrics[]> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT * FROM query_performance_metrics 
        WHERE recorded_at BETWEEN $1 AND $2
        ORDER BY total_time DESC
      `, [start, end]);

      return result.rows.map(row => ({
        query_id: row.query_id,
        query_text: row.query_text,
        calls: parseInt(row.calls),
        total_time: parseFloat(row.total_time),
        mean_time: parseFloat(row.mean_time),
        min_time: parseFloat(row.min_time),
        max_time: parseFloat(row.max_time),
        stddev_time: parseFloat(row.stddev_time),
        rows_affected: parseInt(row.rows_affected),
        cache_hits: parseInt(row.cache_hits),
        cache_misses: parseInt(row.cache_misses),
        last_executed: new Date(row.recorded_at)
      }));
    } finally {
      client.release();
    }
  }

  private async getResourceMetricsForPeriod(start: Date, end: Date): Promise<ResourceMetrics[]> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT * FROM resource_metrics 
        WHERE timestamp BETWEEN $1 AND $2
        ORDER BY timestamp DESC
      `, [start, end]);

      return result.rows.map(row => ({
        timestamp: new Date(row.timestamp),
        cpu_usage_percent: parseFloat(row.cpu_usage_percent),
        memory_usage_bytes: parseInt(row.memory_usage_bytes),
        memory_usage_percent: parseFloat(row.memory_usage_percent),
        disk_usage_bytes: parseInt(row.disk_usage_bytes),
        disk_usage_percent: parseFloat(row.disk_usage_percent),
        network_bytes_sent: parseInt(row.network_bytes_sent),
        network_bytes_received: parseInt(row.network_bytes_received),
        connection_count: parseInt(row.connection_count),
        connection_utilization: parseFloat(row.connection_utilization)
      }));
    } finally {
      client.release();
    }
  }

  private calculateSummaryStats(metrics: QueryPerformanceMetrics[]): PerformanceReport['summary'] {
    if (metrics.length === 0) {
      return {
        totalQueries: 0,
        avgQueryTime: 0,
        slowestQuery: {} as QueryPerformanceMetrics,
        fastestQuery: {} as QueryPerformanceMetrics,
        errorCount: 0,
        uptime: 0
      };
    }

    const totalQueries = metrics.reduce((sum, m) => sum + m.calls, 0);
    const avgQueryTime = metrics.reduce((sum, m) => sum + m.mean_time, 0) / metrics.length;
    const slowestQuery = metrics.reduce((slowest, current) => 
      current.max_time > slowest.max_time ? current : slowest
    );
    const fastestQuery = metrics.reduce((fastest, current) => 
      current.min_time < fastest.min_time ? current : fastest
    );

    return {
      totalQueries,
      avgQueryTime,
      slowestQuery,
      fastestQuery,
      errorCount: 0, // Would need error tracking
      uptime: 99.9 // Would calculate from actual uptime data
    };
  }

  private analyzeQueryPatterns(metrics: QueryPerformanceMetrics[]): PerformanceReport['queryAnalysis'] {
    const topSlowQueries = metrics
      .sort((a, b) => b.mean_time - a.mean_time)
      .slice(0, 10);

    const mostFrequentQueries = metrics
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 10);

    const queryPatterns = this.extractQueryPatterns(metrics);

    return {
      topSlowQueries,
      mostFrequentQueries,
      queryPatterns
    };
  }

  private analyzeResourceUsage(metrics: ResourceMetrics[]): PerformanceReport['resourceAnalysis'] {
    if (metrics.length === 0) {
      return {
        avgCpuUsage: 0,
        peakCpuUsage: 0,
        avgMemoryUsage: 0,
        peakMemoryUsage: 0,
        diskGrowth: 0,
        connectionTrends: []
      };
    }

    const avgCpuUsage = metrics.reduce((sum, m) => sum + m.cpu_usage_percent, 0) / metrics.length;
    const peakCpuUsage = Math.max(...metrics.map(m => m.cpu_usage_percent));
    const avgMemoryUsage = metrics.reduce((sum, m) => sum + m.memory_usage_percent, 0) / metrics.length;
    const peakMemoryUsage = Math.max(...metrics.map(m => m.memory_usage_percent));
    
    const firstDiskUsage = metrics[metrics.length - 1]?.disk_usage_bytes || 0;
    const lastDiskUsage = metrics[0]?.disk_usage_bytes || 0;
    const diskGrowth = lastDiskUsage - firstDiskUsage;

    const connectionTrends = metrics.map(m => ({
      timestamp: m.timestamp,
      count: m.connection_count
    }));

    return {
      avgCpuUsage,
      peakCpuUsage,
      avgMemoryUsage,
      peakMemoryUsage,
      diskGrowth,
      connectionTrends
    };
  }

  private extractQueryPatterns(metrics: QueryPerformanceMetrics[]): Array<{ pattern: string; count: number; avgTime: number }> {
    const patterns = new Map<string, { count: number; totalTime: number; calls: number }>();

    for (const metric of metrics) {
      // Simple pattern extraction - normalize queries
      const pattern = this.normalizeQuery(metric.query_text);
      const existing = patterns.get(pattern) || { count: 0, totalTime: 0, calls: 0 };
      
      patterns.set(pattern, {
        count: existing.count + 1,
        totalTime: existing.totalTime + metric.total_time,
        calls: existing.calls + metric.calls
      });
    }

    return Array.from(patterns.entries()).map(([pattern, data]) => ({
      pattern,
      count: data.count,
      avgTime: data.totalTime / data.calls
    })).sort((a, b) => b.count - a.count).slice(0, 10);
  }

  private normalizeQuery(query: string): string {
    return query
      .replace(/\$\d+/g, '$?') // Replace parameter placeholders
      .replace(/\d+/g, 'N') // Replace numbers
      .replace(/'[^']*'/g, "'?'") // Replace string literals
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private async generateRecommendations(
    queryMetrics: QueryPerformanceMetrics[],
    resourceMetrics: ResourceMetrics[]
  ): Promise<string[]> {
    const recommendations: string[] = [];

    // Check for slow queries
    const slowQueries = queryMetrics.filter(m => m.mean_time > this.config.alertThresholds.slowQueryTimeMs);
    if (slowQueries.length > 0) {
      recommendations.push(`Consider optimizing ${slowQueries.length} slow queries with average execution time > ${this.config.alertThresholds.slowQueryTimeMs}ms`);
    }

    // Check cache hit ratio
    const avgCacheHits = queryMetrics.reduce((sum, m) => sum + m.cache_hits, 0);
    const avgCacheMisses = queryMetrics.reduce((sum, m) => sum + m.cache_misses, 0);
    const cacheHitRatio = avgCacheHits + avgCacheMisses > 0 ? 
      (avgCacheHits / (avgCacheHits + avgCacheMisses)) * 100 : 0;
    
    if (cacheHitRatio < this.config.alertThresholds.cacheHitRatioMin) {
      recommendations.push(`Cache hit ratio is ${cacheHitRatio.toFixed(2)}%. Consider increasing shared_buffers or adding more memory`);
    }

    // Check resource usage trends
    if (resourceMetrics.length > 0) {
      const avgCpuUsage = resourceMetrics.reduce((sum, m) => sum + m.cpu_usage_percent, 0) / resourceMetrics.length;
      if (avgCpuUsage > 70) {
        recommendations.push(`High average CPU usage (${avgCpuUsage.toFixed(2)}%). Consider query optimization or scaling up`);
      }

      const avgMemoryUsage = resourceMetrics.reduce((sum, m) => sum + m.memory_usage_percent, 0) / resourceMetrics.length;
      if (avgMemoryUsage > 80) {
        recommendations.push(`High average memory usage (${avgMemoryUsage.toFixed(2)}%). Consider increasing memory or optimizing queries`);
      }
    }

    return recommendations;
  }

  private detectHistoricalAnomalies(
    queryMetrics: QueryPerformanceMetrics[],
    resourceMetrics: ResourceMetrics[]
  ): PerformanceReport['anomalies'] {
    const anomalies: PerformanceReport['anomalies'] = [];

    // Detect query performance anomalies
    const queryTimes = queryMetrics.map(m => m.mean_time);
    const avgQueryTime = queryTimes.reduce((sum, time) => sum + time, 0) / queryTimes.length;
    const maxQueryTime = Math.max(...queryTimes);

    if (maxQueryTime > avgQueryTime * 10) {
      anomalies.push({
        type: 'query_performance',
        description: `Query execution time spike detected: ${maxQueryTime.toFixed(2)}ms (${(maxQueryTime / avgQueryTime).toFixed(1)}x average)`,
        impact: 'high',
        recommendation: 'Investigate and optimize the slowest queries'
      });
    }

    // Detect resource usage anomalies
    if (resourceMetrics.length > 0) {
      const cpuUsages = resourceMetrics.map(m => m.cpu_usage_percent);
      const avgCpuUsage = cpuUsages.reduce((sum, usage) => sum + usage, 0) / cpuUsages.length;
      const maxCpuUsage = Math.max(...cpuUsages);

      if (maxCpuUsage > avgCpuUsage * 2 && maxCpuUsage > 90) {
        anomalies.push({
          type: 'cpu_spike',
          description: `CPU usage spike detected: ${maxCpuUsage.toFixed(2)}% (${(maxCpuUsage / avgCpuUsage).toFixed(1)}x average)`,
          impact: 'medium',
          recommendation: 'Monitor for concurrent heavy operations or consider scaling'
        });
      }
    }

    return anomalies;
  }

  private async storePerformanceReport(report: PerformanceReport): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query(`
        INSERT INTO performance_reports (
          report_id, period_start, period_end, report_data
        ) VALUES ($1, $2, $3, $4)
      `, [
        report.reportId,
        report.period.start,
        report.period.end,
        JSON.stringify(report)
      ]);
    } finally {
      client.release();
    }
  }
}

/**
 * Factory for creating performance monitoring service with default configuration
 */
export class PerformanceMonitoringFactory {
  static createPerformanceMonitor(
    pool: Pool,
    customConfig: Partial<MonitoringConfiguration> = {}
  ): PerformanceMonitoringService {
    const defaultConfig: MonitoringConfiguration = {
      enabled: true,
      samplingIntervalMs: 30000, // 30 seconds
      alertThresholds: {
        slowQueryTimeMs: 1000, // 1 second
        cacheHitRatioMin: 95, // 95%
        cpuUsageMaxPercent: 85, // 85%
        memoryUsageMaxPercent: 90, // 90%
        diskUsageMaxPercent: 90, // 90%
        connectionUtilizationMax: 80, // 80%
        errorRateMax: 1 // 1%
      },
      retention: {
        queryMetricsDays: 30,
        resourceMetricsDays: 30,
        alertsDays: 90,
        reportsDays: 365
      },
      notifications: {
        email: false,
        slack: false
      }
    };

    const config = { ...defaultConfig, ...customConfig };
    return new PerformanceMonitoringService(pool, config);
  }

  static createProductionMonitor(pool: Pool): PerformanceMonitoringService {
    return this.createPerformanceMonitor(pool, {
      samplingIntervalMs: 60000, // 1 minute in production
      alertThresholds: {
        slowQueryTimeMs: 2000, // 2 seconds for production
        cacheHitRatioMin: 98, // Higher requirement for production
        cpuUsageMaxPercent: 80,
        memoryUsageMaxPercent: 85,
        diskUsageMaxPercent: 85,
        connectionUtilizationMax: 70,
        errorRateMax: 0.5
      },
      notifications: {
        email: true,
        slack: true
      }
    });
  }

  static createDevelopmentMonitor(pool: Pool): PerformanceMonitoringService {
    return this.createPerformanceMonitor(pool, {
      samplingIntervalMs: 10000, // 10 seconds for development
      alertThresholds: {
        slowQueryTimeMs: 500, // More sensitive in development
        cacheHitRatioMin: 90,
        cpuUsageMaxPercent: 95,
        memoryUsageMaxPercent: 95,
        diskUsageMaxPercent: 95,
        connectionUtilizationMax: 90,
        errorRateMax: 5
      },
      retention: {
        queryMetricsDays: 7,
        resourceMetricsDays: 7,
        alertsDays: 30,
        reportsDays: 90
      }
    });
  }
}
