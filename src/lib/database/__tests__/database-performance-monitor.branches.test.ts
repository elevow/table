import { DatabasePerformanceMonitor } from '../../database/database-performance-monitor';
import type { DatabasePool } from '../../database/database-connection';

describe('DatabasePerformanceMonitor - branch coverage', () => {
  const makePool = (opts?: { stats?: { total: number; idle: number; waiting: number; max: number } | (() => never) }) => {
    const pool = {
      async connect() {
        throw new Error('not used in these tests');
      },
      async end() {
        // no-op
      },
    } as unknown as DatabasePool;
    if (opts?.stats) {
      if (typeof opts.stats === 'function') {
        (pool as any).getStats = opts.stats as any;
      } else {
        (pool as any).getStats = () => opts.stats;
      }
    }
    return pool;
  };

  const baseConfig = {
    enabled: false, // don't start intervals in tests
    samplingInterval: 5,
    alertThresholds: {
      slowQueryTime: 10,
      connectionUtilization: 50,
      errorRate: 0, // make any error trigger the alert
      cacheHitRatio: 70,
      lockWaitTime: 500,
    },
    retentionPeriod: 7,
    enableRealTimeAlerts: true,
  } as const;

  test('creates slow_query and error_rate alerts via recordQueryExecution', () => {
    const monitor = new DatabasePerformanceMonitor(makePool(), { ...baseConfig });

    // Slow successful query triggers slow_query
    monitor.recordQueryExecution('SELECT 1', 15, true);
    // Failed query triggers error_rate (threshold 0)
    monitor.recordQueryExecution('SELECT 2', 5, false, 'boom');

    const active = monitor.getActiveAlerts();
    const metrics = monitor.getCurrentMetrics();

    expect(active.some(a => a.metric === 'slow_query')).toBe(true);
    expect(active.some(a => a.metric === 'error_rate')).toBe(true);
    expect(metrics.queries.totalExecuted).toBeGreaterThan(0);

    // acknowledge one alert
    const toAck = active.find(a => a.metric === 'slow_query');
    expect(toAck).toBeDefined();
    if (toAck) {
      monitor.acknowledgeAlert(toAck.id);
      expect(monitor.getActiveAlerts().some(a => a.id === toAck.id)).toBe(false);
    }
  });

  test('uses dbPool.getStats when available and triggers connection_utilization alert', async () => {
    const stats = { total: 10, idle: 0, waiting: 0, max: 1 }; // utilization = 1000%
    const monitor = new DatabasePerformanceMonitor(makePool({ stats }), { ...baseConfig });

    // call private method through any cast to update connection metrics via getStats()
    await (monitor as any).updateConnectionMetrics();
    const metrics = monitor.getCurrentMetrics();
    expect(metrics.connections.total).toBe(stats.total);
    expect(metrics.connections.utilization).toBeGreaterThan(100);

    // trigger alert evaluation
    monitor.recordQueryExecution('SELECT now()', 1, true);
    expect(monitor.getActiveAlerts().some(a => a.metric === 'connection_utilization')).toBe(true);
  });

  test('collectMetrics handles getStats errors gracefully (catch branch)', async () => {
    // stats throws -> updateConnectionMetrics try/catch path
    const monitor = new DatabasePerformanceMonitor(
      makePool({ stats: (() => { throw new Error('stats failed'); }) as unknown as never }),
      { ...baseConfig }
    );

    await (monitor as any).collectMetrics();
    // no throw means catch branch executed; verify metrics object exists
    const metrics = monitor.getCurrentMetrics();
    expect(metrics.connections.maxCapacity).toBeGreaterThan(0);
  });

  test('exporters and recommendations reflect recorded history', () => {
    const monitor = new DatabasePerformanceMonitor(makePool(), { ...baseConfig });

    // Populate history: slow queries to drive indexRecommendations
    for (let i = 0; i < 5; i++) {
      monitor.recordQueryExecution('SELECT * FROM players WHERE id = $1', 1200, true);
    }

    // Force analytics update so recommendations see topSlowQueries
    monitor.getQueryAnalytics();
    const recs = monitor.getPerformanceRecommendations();
    expect(recs.indexRecommendations.length).toBeGreaterThan(0);

    const exported = monitor.exportMetrics();
    expect(typeof exported.prometheus).toBe('string');
    expect((exported.csv.split('\n')[0] || '')).toContain('timestamp');
    expect((exported.json as any).metrics).toBeDefined();
  });

  test('extractQueryPattern returns UNKNOWN for empty input and SELECT for query', () => {
    const monitor = new DatabasePerformanceMonitor(makePool(), { ...baseConfig });
    // call private through any cast
    const pattern = (monitor as any).extractQueryPattern('');
    expect(pattern).toBe('UNKNOWN');
    const pattern2 = (monitor as any).extractQueryPattern('  select * from t');
    expect(pattern2).toBe('SELECT');
  });

  test('cleanup removes old alerts and history when retention is 0 days', () => {
    const monitor = new DatabasePerformanceMonitor(makePool(), { ...baseConfig, retentionPeriod: 0 });
    // generate an alert and some history
    monitor.recordQueryExecution('SELECT 1', 50, false, 'error');
    expect(monitor.getActiveAlerts().length).toBeGreaterThan(0);
    // cleanup should purge as retentionDate == now
    monitor.cleanup();
    expect(monitor.getActiveAlerts().length).toBe(0);
    expect(monitor.getCurrentMetrics().queries.totalExecuted).toBeGreaterThanOrEqual(0);
  });
});
