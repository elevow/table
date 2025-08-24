/**
 * US-015: Performance Monitoring Service Tests
 * 
 * Comprehensive test suite for database performance monitoring functionality
 */

import { Pool, PoolClient } from 'pg';
import { PerformanceMonitoringService, PerformanceMonitoringFactory } from '../performance-monitoring-service';
import type { 
  QueryPerformanceMetrics, 
  ResourceMetrics, 
  Alert, 
  PerformanceReport,
  MonitoringConfiguration 
} from '../performance-monitoring-service';

// Mock pg module
jest.mock('pg');

describe('PerformanceMonitoringService', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockClient: jest.Mocked<PoolClient>;
  let performanceMonitor: PerformanceMonitoringService;
  let testConfig: MonitoringConfiguration;

  beforeEach(() => {
    // Setup mocks
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [], command: 'SELECT', rowCount: 0 }),
      release: jest.fn(),
    } as any;

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      end: jest.fn(),
    } as any;

    testConfig = {
      enabled: true,
      samplingIntervalMs: 1000,
      alertThresholds: {
        slowQueryTimeMs: 1000,
        cacheHitRatioMin: 95,
        cpuUsageMaxPercent: 85,
        memoryUsageMaxPercent: 90,
        diskUsageMaxPercent: 90,
        connectionUtilizationMax: 80,
        errorRateMax: 1
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

    performanceMonitor = new PerformanceMonitoringService(mockPool, testConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (performanceMonitor) {
      performanceMonitor.stopMonitoring();
    }
  });

  describe('Initialization', () => {
    it('should initialize performance monitoring system', async () => {
      // Mock table creation queries
      mockClient.query.mockResolvedValue({ rows: [], command: 'CREATE', rowCount: 0 } as any);

      await performanceMonitor.initialize();

      // Verify table creation calls
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS query_performance_metrics')
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS resource_metrics')
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS performance_alerts')
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS performance_reports')
      );
    });

    it('should setup pg_stat_statements extension', async () => {
      mockClient.query.mockResolvedValue({ rows: [], command: 'CREATE', rowCount: 0 } as any);

      await performanceMonitor.initialize();

      expect(mockClient.query).toHaveBeenCalledWith(
        'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT pg_stat_statements_reset()'
      );
    });

    it('should load existing unresolved alerts', async () => {
      const existingAlerts = [
        {
          alert_id: 'test-alert-1',
          severity: 'warning',
          metric: 'slow_queries',
          message: 'Test alert',
          threshold_value: '1000',
          current_value: '1500',
          timestamp: new Date(),
          acknowledged: false,
          resolved_at: null
        }
      ];

      // Create a new instance to avoid any previous initialization effects
      const testService = new PerformanceMonitoringService(mockPool, testConfig);
      
      // Mock the initialization process
      mockClient.query
        .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 }) // table creation
        .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 }) // table creation
        .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 }) // table creation
        .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 }) // table creation
        .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 }) // indexes
        .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 }) // indexes
        .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 }) // indexes
        .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 }) // indexes
        .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 }) // extension
        .mockResolvedValueOnce({ rows: [], command: 'SELECT', rowCount: 0 }) // reset stats
        .mockResolvedValueOnce({ rows: existingAlerts, command: 'SELECT', rowCount: 1 }); // load alerts

      await testService.initialize();

      const currentMetrics = testService.getCurrentMetrics();
      expect(currentMetrics.alerts).toHaveLength(1);
    });
  });

  describe('Query Performance Tracking', () => {
    it('should track query performance metrics', async () => {
      const mockQueryStats = [
        {
          query_id: '12345',
          query_text: 'SELECT * FROM users WHERE id = $1',
          calls: 100,
          total_time: 500.0,
          mean_time: 5.0,
          min_time: 1.0,
          max_time: 50.0,
          stddev_time: 10.0,
          rows: 100,
          cache_hits: 95,
          cache_misses: 5,
          last_executed: new Date()
        }
      ];

      mockClient.query
        .mockResolvedValueOnce({ rows: mockQueryStats, command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [], command: 'INSERT', rowCount: 1 } as any);

      const metrics = await performanceMonitor.trackQueryPerformance();

      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({
        query_id: '12345',
        query_text: 'SELECT * FROM users WHERE id = $1',
        calls: 100,
        total_time: 500.0,
        mean_time: 5.0
      });

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM pg_stat_statements')
      );
    });

    it('should calculate current query statistics', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ avg_execution_time: 15.5 }], command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [{ cache_hit_ratio: 98.5 }], command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [{ slow_queries: 3 }], command: 'SELECT', rowCount: 1 } as any);

      const stats = await performanceMonitor.getCurrentQueryStats();

      expect(stats).toEqual({
        avg_execution_time: 15.5,
        cache_hit_ratio: 98.5,
        slow_queries: 3
      });
    });

    it('should handle empty query statistics gracefully', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [], command: 'SELECT', rowCount: 0 } as any)
        .mockResolvedValueOnce({ rows: [], command: 'SELECT', rowCount: 0 } as any)
        .mockResolvedValueOnce({ rows: [], command: 'SELECT', rowCount: 0 } as any);

      const stats = await performanceMonitor.getCurrentQueryStats();

      expect(stats).toEqual({
        avg_execution_time: 0,
        cache_hit_ratio: 0,
        slow_queries: 0
      });
    });
  });

  describe('Resource Usage Monitoring', () => {
    it('should monitor database resource usage', async () => {
      const mockConnectionStats = [
        {
          total_connections: 20,
          active_connections: 15,
          idle_connections: 5
        }
      ];

      const mockDatabaseSize = [
        {
          db_size: '1073741824', // 1GB
          db_size_pretty: '1024 MB'
        }
      ];

      mockClient.query
        .mockResolvedValueOnce({ rows: mockConnectionStats, command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: mockDatabaseSize, command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [], command: 'INSERT', rowCount: 1 } as any);

      const metrics = await performanceMonitor.monitorResourceUsage();

      expect(metrics).toMatchObject({
        connection_count: 20,
        connection_utilization: 75, // 15/20 * 100
        disk_usage_bytes: 1073741824
      });

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM pg_stat_activity')
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_database_size')
      );
    });

    it('should store resource metrics in database', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ total_connections: 10, active_connections: 5, idle_connections: 5 }], command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [{ db_size: '500000000' }], command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [], command: 'INSERT', rowCount: 1 } as any);

      await performanceMonitor.monitorResourceUsage();

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO resource_metrics'),
        expect.any(Array)
      );
    });
  });

  describe('Anomaly Detection and Alerting', () => {
    it('should detect slow query anomalies', async () => {
      // Mock query stats showing slow queries
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ avg_execution_time: 5.0 }], command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [{ cache_hit_ratio: 98.0 }], command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [{ slow_queries: 5 }], command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [], command: 'SELECT', rowCount: 0 } as any) // latest resource metrics
        .mockResolvedValueOnce({ rows: [], command: 'INSERT', rowCount: 1 } as any); // store alert

      const alerts = await performanceMonitor.detectAnomalies();

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        severity: 'warning',
        metric: 'slow_queries',
        currentValue: 5
      });
    });

    it('should detect cache hit ratio anomalies', async () => {
      // Mock low cache hit ratio
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ avg_execution_time: 5.0 }], command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [{ cache_hit_ratio: 90.0 }], command: 'SELECT', rowCount: 1 } as any) // Below 95% threshold
        .mockResolvedValueOnce({ rows: [{ slow_queries: 0 }], command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [], command: 'SELECT', rowCount: 0 } as any)
        .mockResolvedValueOnce({ rows: [], command: 'INSERT', rowCount: 1 } as any);

      const alerts = await performanceMonitor.detectAnomalies();

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        severity: 'warning',
        metric: 'cache_hit_ratio',
        currentValue: 90.0,
        threshold: 95
      });
    });

    it('should detect high CPU usage anomalies', async () => {
      const highCpuResourceMetrics = {
        cpu_usage_percent: 90.0,
        memory_usage_percent: 70.0,
        connection_utilization: 60.0
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [{ avg_execution_time: 5.0 }], command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [{ cache_hit_ratio: 98.0 }], command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [{ slow_queries: 0 }], command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [highCpuResourceMetrics], command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [], command: 'INSERT', rowCount: 1 } as any);

      const alerts = await performanceMonitor.detectAnomalies();

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        severity: 'error',
        metric: 'cpu_usage',
        currentValue: 90.0,
        threshold: 85
      });
    });

    it('should acknowledge alerts', async () => {
      const testAlert: Alert = {
        id: 'test-alert-123',
        severity: 'warning',
        metric: 'slow_queries',
        message: 'Test alert',
        threshold: 1000,
        currentValue: 1500,
        timestamp: new Date(),
        acknowledged: false
      };

      // Manually add alert to monitor
      (performanceMonitor as any).alerts.set(testAlert.id, testAlert);

      mockClient.query.mockResolvedValueOnce({ rows: [], command: 'UPDATE', rowCount: 1 } as any);

      await performanceMonitor.acknowledgeAlert(testAlert.id, 'test-user');

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE performance_alerts'),
        expect.arrayContaining([true, 'test-user', testAlert.id])
      );
    });

    it('should resolve alerts', async () => {
      const testAlert: Alert = {
        id: 'test-alert-456',
        severity: 'error',
        metric: 'cpu_usage',
        message: 'High CPU usage',
        threshold: 85,
        currentValue: 95,
        timestamp: new Date(),
        acknowledged: true
      };

      (performanceMonitor as any).alerts.set(testAlert.id, testAlert);

      mockClient.query.mockResolvedValueOnce({ rows: [], command: 'UPDATE', rowCount: 1 } as any);

      await performanceMonitor.resolveAlert(testAlert.id, 'test-admin');

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE performance_alerts'),
        expect.arrayContaining([expect.any(Date), 'test-admin', testAlert.id])
      );

      const updatedAlert = (performanceMonitor as any).alerts.get(testAlert.id);
      expect(updatedAlert.resolvedAt).toBeInstanceOf(Date);
    });
  });

  describe('Performance Reporting', () => {
    it('should generate comprehensive performance report', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const mockQueryMetrics: QueryPerformanceMetrics[] = [
        {
          query_id: '1',
          query_text: 'SELECT * FROM users',
          calls: 1000,
          total_time: 5000,
          mean_time: 5,
          min_time: 1,
          max_time: 50,
          stddev_time: 10,
          rows_affected: 1000,
          cache_hits: 950,
          cache_misses: 50,
          last_executed: new Date()
        },
        {
          query_id: '2',
          query_text: 'SELECT * FROM orders',
          calls: 500,
          total_time: 10000,
          mean_time: 20,
          min_time: 5,
          max_time: 100,
          stddev_time: 25,
          rows_affected: 2500,
          cache_hits: 400,
          cache_misses: 100,
          last_executed: new Date()
        }
      ];

      const mockResourceMetrics: ResourceMetrics[] = [
        {
          timestamp: new Date(),
          cpu_usage_percent: 45.5,
          memory_usage_bytes: 2000000000,
          memory_usage_percent: 65.0,
          disk_usage_bytes: 50000000000,
          disk_usage_percent: 75.0,
          network_bytes_sent: 1000000,
          network_bytes_received: 2000000,
          connection_count: 25,
          connection_utilization: 50.0
        }
      ];

      // Mock database queries for report generation
      mockClient.query
        .mockResolvedValueOnce({ rows: mockQueryMetrics.map(m => ({ ...m, recorded_at: new Date() })), command: 'SELECT', rowCount: 2 } as any)
        .mockResolvedValueOnce({ rows: mockResourceMetrics, command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [], command: 'INSERT', rowCount: 1 } as any);

      const report = await performanceMonitor.generatePerformanceReport(startDate, endDate, true);

      expect(report).toMatchObject({
        reportId: expect.stringMatching(/^perf-report-\d+$/),
        generatedAt: expect.any(Date),
        period: {
          start: startDate,
          end: endDate
        }
      });

      expect(report.summary).toMatchObject({
        totalQueries: 1500, // 1000 + 500
        avgQueryTime: 12.5, // (5 + 20) / 2
        slowestQuery: expect.objectContaining({ mean_time: 20 }),
        fastestQuery: expect.objectContaining({ mean_time: 5 })
      });

      expect(report.queryAnalysis.topSlowQueries).toHaveLength(2);
      expect(report.queryAnalysis.mostFrequentQueries).toHaveLength(2);
      expect(report.queryAnalysis.queryPatterns).toBeDefined();

      expect(report.resourceAnalysis).toMatchObject({
        avgCpuUsage: 45.5,
        peakCpuUsage: 45.5,
        avgMemoryUsage: 65.0,
        peakMemoryUsage: 65.0
      });

      expect(report.recommendations).toBeInstanceOf(Array);
      expect(report.anomalies).toBeInstanceOf(Array);
    });

    it('should handle empty data in performance reports', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      mockClient.query
        .mockResolvedValueOnce({ rows: [], command: 'SELECT', rowCount: 0 } as any) // no query metrics
        .mockResolvedValueOnce({ rows: [], command: 'SELECT', rowCount: 0 } as any) // no resource metrics
        .mockResolvedValueOnce({ rows: [], command: 'INSERT', rowCount: 1 } as any); // store report

      const report = await performanceMonitor.generatePerformanceReport(startDate, endDate, false);

      expect(report.summary.totalQueries).toBe(0);
      expect(report.summary.avgQueryTime).toBe(0);
      expect(report.queryAnalysis.topSlowQueries).toHaveLength(0);
      expect(report.resourceAnalysis.avgCpuUsage).toBe(0);
      expect(report.recommendations).toHaveLength(0);
    });

    it('should generate appropriate recommendations', async () => {
      const queryMetrics: QueryPerformanceMetrics[] = [
        {
          query_id: 'slow-1',
          query_text: 'SELECT * FROM large_table WHERE unindexed_column = $1',
          calls: 100,
          total_time: 200000, // 200 seconds total
          mean_time: 2000, // 2 seconds average (above 1 second threshold)
          min_time: 1000,
          max_time: 5000,
          stddev_time: 500,
          rows_affected: 1000,
          cache_hits: 50, // Low cache hit ratio
          cache_misses: 50,
          last_executed: new Date()
        }
      ];

      const resourceMetrics: ResourceMetrics[] = [
        {
          timestamp: new Date(),
          cpu_usage_percent: 85.0, // High CPU usage
          memory_usage_bytes: 8000000000,
          memory_usage_percent: 95.0, // High memory usage
          disk_usage_bytes: 100000000000,
          disk_usage_percent: 80.0,
          network_bytes_sent: 1000000,
          network_bytes_received: 2000000,
          connection_count: 50,
          connection_utilization: 70.0
        }
      ];

      const recommendations = await (performanceMonitor as any).generateRecommendations(queryMetrics, resourceMetrics);

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations.find((r: string) => r.includes('Consider optimizing 1 slow queries'))).toBeDefined();
      expect(recommendations.find((r: string) => r.includes('Cache hit ratio is 50.00%'))).toBeDefined();
      expect(recommendations.find((r: string) => r.includes('High average CPU usage (85.00%)'))).toBeDefined();
      expect(recommendations.find((r: string) => r.includes('High average memory usage (95.00%)'))).toBeDefined();
    });
  });

  describe('Monitoring Control', () => {
    it('should start continuous monitoring', async () => {
      // Mock successful monitoring operations
      mockClient.query.mockResolvedValue({ rows: [], command: 'SELECT', rowCount: 0 } as any);

      await performanceMonitor.startMonitoring();

      expect((performanceMonitor as any).isMonitoring).toBe(true);
      expect((performanceMonitor as any).monitoringInterval).toBeDefined();

      // Wait for at least one monitoring cycle to complete (1000ms + buffer)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Stop monitoring
      performanceMonitor.stopMonitoring();
      
      expect(mockClient.query).toHaveBeenCalled();
    }, 6000);

    it('should stop continuous monitoring', async () => {
      jest.useFakeTimers();

      await performanceMonitor.startMonitoring();
      expect((performanceMonitor as any).isMonitoring).toBe(true);

      performanceMonitor.stopMonitoring();
      expect((performanceMonitor as any).isMonitoring).toBe(false);
      expect((performanceMonitor as any).monitoringInterval).toBeUndefined();

      jest.useRealTimers();
    });

    it('should not start monitoring if already running', async () => {
      await performanceMonitor.startMonitoring();
      const firstInterval = (performanceMonitor as any).monitoringInterval;

      await performanceMonitor.startMonitoring(); // Try to start again
      const secondInterval = (performanceMonitor as any).monitoringInterval;

      expect(firstInterval).toBe(secondInterval);
    });

    it('should emit monitoring events', async () => {
      const startedSpy = jest.fn();
      const stoppedSpy = jest.fn();
      const alertSpy = jest.fn();

      performanceMonitor.on('monitoringStarted', startedSpy);
      performanceMonitor.on('monitoringStopped', stoppedSpy);
      performanceMonitor.on('alert', alertSpy);

      await performanceMonitor.startMonitoring();
      expect(startedSpy).toHaveBeenCalledTimes(1);

      performanceMonitor.stopMonitoring();
      expect(stoppedSpy).toHaveBeenCalledTimes(1);

      // Manually emit alert to test event
      const testAlert: Alert = {
        id: 'test-alert',
        severity: 'warning',
        metric: 'test',
        message: 'Test alert',
        threshold: 100,
        currentValue: 150,
        timestamp: new Date(),
        acknowledged: false
      };

      performanceMonitor.emit('alert', testAlert);
      expect(alertSpy).toHaveBeenCalledWith(testAlert);
    });
  });

  describe('Current Metrics', () => {
    it('should return current metrics snapshot', () => {
      const metrics = performanceMonitor.getCurrentMetrics();

      expect(metrics).toMatchObject({
        queryStats: {
          avg_execution_time: expect.any(Number),
          cache_hit_ratio: expect.any(Number),
          slow_queries: expect.any(Number)
        },
        resources: {
          connections: expect.any(Number),
          disk_usage: expect.any(Number),
          cpu_usage: expect.any(Number)
        },
        alerts: expect.any(Array)
      });
    });

    it('should update current metrics when tracking performance', async () => {
      const mockQueryMetrics = [{
        query_id: '1',
        query_text: 'SELECT 1',
        calls: 1,
        total_time: 10,
        mean_time: 10,
        min_time: 10,
        max_time: 10,
        stddev_time: 0,
        rows: 1,
        cache_hits: 1,
        cache_misses: 0,
        last_executed: new Date()
      }];

      mockClient.query
        .mockResolvedValueOnce({ rows: mockQueryMetrics, command: 'SELECT', rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [], command: 'INSERT', rowCount: 1 } as any);

      await performanceMonitor.trackQueryPerformance();

      const metrics = performanceMonitor.getCurrentMetrics();
      expect(metrics.queryStats.avg_execution_time).toBe(10);
      expect(metrics.queryStats.cache_hit_ratio).toBe(100);
    });
  });
});

describe('PerformanceMonitoringFactory', () => {
  let mockPool: jest.Mocked<Pool>;

  beforeEach(() => {
    mockPool = {
      connect: jest.fn(),
      end: jest.fn(),
    } as any;
  });

  it('should create performance monitor with default configuration', () => {
    const monitor = PerformanceMonitoringFactory.createPerformanceMonitor(mockPool);

    expect(monitor).toBeInstanceOf(PerformanceMonitoringService);

    const config = (monitor as any).config;
    expect(config.enabled).toBe(true);
    expect(config.samplingIntervalMs).toBe(30000);
    expect(config.alertThresholds.slowQueryTimeMs).toBe(1000);
  });

  it('should create performance monitor with custom configuration', () => {
    const customConfig: Partial<MonitoringConfiguration> = {
      samplingIntervalMs: 60000,
      alertThresholds: {
        slowQueryTimeMs: 2000,
        cacheHitRatioMin: 95,
        cpuUsageMaxPercent: 85,
        memoryUsageMaxPercent: 90,
        diskUsageMaxPercent: 90,
        connectionUtilizationMax: 80,
        errorRateMax: 1
      }
    };

    const monitor = PerformanceMonitoringFactory.createPerformanceMonitor(mockPool, customConfig);

    const config = (monitor as any).config;
    expect(config.samplingIntervalMs).toBe(60000);
    expect(config.alertThresholds.slowQueryTimeMs).toBe(2000);
    // Should still have defaults for non-overridden values
    expect(config.alertThresholds.cacheHitRatioMin).toBe(95);
  });

  it('should create production monitor with production settings', () => {
    const monitor = PerformanceMonitoringFactory.createProductionMonitor(mockPool);

    const config = (monitor as any).config;
    expect(config.samplingIntervalMs).toBe(60000); // 1 minute
    expect(config.alertThresholds.slowQueryTimeMs).toBe(2000); // 2 seconds
    expect(config.alertThresholds.cacheHitRatioMin).toBe(98); // 98%
    expect(config.notifications.email).toBe(true);
    expect(config.notifications.slack).toBe(true);
  });

  it('should create development monitor with development settings', () => {
    const monitor = PerformanceMonitoringFactory.createDevelopmentMonitor(mockPool);

    const config = (monitor as any).config;
    expect(config.samplingIntervalMs).toBe(10000); // 10 seconds
    expect(config.alertThresholds.slowQueryTimeMs).toBe(500); // 500ms
    expect(config.alertThresholds.cpuUsageMaxPercent).toBe(95); // More lenient
    expect(config.retention.queryMetricsDays).toBe(7); // Shorter retention
  });
});

describe('Query Pattern Analysis', () => {
  let performanceMonitor: PerformanceMonitoringService;

  beforeEach(() => {
    const mockPool = {} as Pool;
    const testConfig = {
      enabled: false,
      samplingIntervalMs: 1000,
      alertThresholds: {
        slowQueryTimeMs: 1000,
        cacheHitRatioMin: 95,
        cpuUsageMaxPercent: 85,
        memoryUsageMaxPercent: 90,
        diskUsageMaxPercent: 90,
        connectionUtilizationMax: 80,
        errorRateMax: 1
      },
      retention: {
        queryMetricsDays: 30,
        resourceMetricsDays: 30,
        alertsDays: 90,
        reportsDays: 365
      },
      notifications: { email: false, slack: false }
    };

    performanceMonitor = new PerformanceMonitoringService(mockPool, testConfig);
  });

  it('should normalize query patterns correctly', () => {
    const testCases = [
      {
        input: 'SELECT * FROM users WHERE id = $1 AND status = $2',
        expected: 'SELECT * FROM users WHERE id = $? AND status = $?'
      },
      {
        input: 'INSERT INTO orders (user_id, amount) VALUES (123, 45.67)',
        expected: 'INSERT INTO orders (user_id, amount) VALUES (N, N.N)'
      },
      {
        input: "SELECT * FROM products WHERE name = 'test product'",
        expected: "SELECT * FROM products WHERE name = '?'"
      },
      {
        input: '  SELECT    *   FROM   table   WHERE   condition  ',
        expected: 'SELECT * FROM table WHERE condition'
      }
    ];

    for (const testCase of testCases) {
      const normalized = (performanceMonitor as any).normalizeQuery(testCase.input);
      expect(normalized).toBe(testCase.expected);
    }
  });

  it('should extract query patterns from metrics', () => {
    const mockMetrics: QueryPerformanceMetrics[] = [
      {
        query_id: '1',
        query_text: 'SELECT * FROM users WHERE id = $1',
        calls: 100,
        total_time: 1000,
        mean_time: 10,
        min_time: 5,
        max_time: 20,
        stddev_time: 3,
        rows_affected: 100,
        cache_hits: 90,
        cache_misses: 10,
        last_executed: new Date()
      },
      {
        query_id: '2',
        query_text: 'SELECT * FROM users WHERE id = $2',
        calls: 50,
        total_time: 500,
        mean_time: 10,
        min_time: 5,
        max_time: 15,
        stddev_time: 2,
        rows_affected: 50,
        cache_hits: 45,
        cache_misses: 5,
        last_executed: new Date()
      }
    ];

    const patterns = (performanceMonitor as any).extractQueryPatterns(mockMetrics);

    expect(patterns).toHaveLength(1); // Both queries should normalize to same pattern
    expect(patterns[0]).toMatchObject({
      pattern: 'SELECT * FROM users WHERE id = $?',
      count: 2,
      avgTime: expect.any(Number)
    });
  });
});

describe('Error Handling', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockClient: jest.Mocked<PoolClient>;
  let performanceMonitor: PerformanceMonitoringService;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    } as any;

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      end: jest.fn(),
    } as any;

    const testConfig = {
      enabled: true,
      samplingIntervalMs: 1000,
      alertThresholds: {
        slowQueryTimeMs: 1000,
        cacheHitRatioMin: 95,
        cpuUsageMaxPercent: 85,
        memoryUsageMaxPercent: 90,
        diskUsageMaxPercent: 90,
        connectionUtilizationMax: 80,
        errorRateMax: 1
      },
      retention: {
        queryMetricsDays: 30,
        resourceMetricsDays: 30,
        alertsDays: 90,
        reportsDays: 365
      },
      notifications: { email: false, slack: false }
    };

    performanceMonitor = new PerformanceMonitoringService(mockPool, testConfig);
  });

  it('should handle database connection errors gracefully', async () => {
    mockPool.connect.mockRejectedValueOnce(new Error('Connection failed'));

    await expect(performanceMonitor.trackQueryPerformance()).rejects.toThrow('Connection failed');
  });

  it('should handle query execution errors gracefully', async () => {
    mockClient.query.mockRejectedValueOnce(new Error('Query failed'));

    await expect(performanceMonitor.getCurrentQueryStats()).rejects.toThrow('Query failed');
  });

  it('should release client connection even when query fails', async () => {
    mockClient.query.mockRejectedValueOnce(new Error('Query failed'));

    try {
      await performanceMonitor.monitorResourceUsage();
    } catch (error) {
      // Expected to throw
    }

    expect(mockClient.release).toHaveBeenCalled();
  });

  it('should handle missing pg_stat_statements extension gracefully', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 } as any) // table creation success
      .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 } as any) // table creation success
      .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 } as any) // table creation success
      .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 } as any) // table creation success
      .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 } as any) // indexes
      .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 } as any) // indexes
      .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 } as any) // indexes
      .mockResolvedValueOnce({ rows: [], command: 'CREATE', rowCount: 0 } as any) // indexes
      .mockRejectedValueOnce(new Error('extension "pg_stat_statements" does not exist') as any);

    // Should not throw during initialization - extension error is caught
    await performanceMonitor.initialize();
    
    // Should complete initialization even with extension error
    expect(mockClient.query).toHaveBeenCalled();
  });

  it('should emit monitoring errors during continuous monitoring', async () => {
    const errorSpy = jest.fn();
    performanceMonitor.on('monitoringError', errorSpy);

    // Make the monitoring fail by rejecting the query
    mockClient.query.mockRejectedValue(new Error('Monitoring failed') as any);

    // Start monitoring
    await performanceMonitor.startMonitoring();

    // Wait for the monitoring cycle to run and emit error (1000ms + buffer)
    await new Promise(resolve => setTimeout(resolve, 1200));

    // Stop monitoring to clean up
    performanceMonitor.stopMonitoring();

    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
  }, 6000);
});
