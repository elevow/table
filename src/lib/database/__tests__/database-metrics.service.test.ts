import { DatabaseMetricsService } from '../../database/database-metrics.service';

// Mock pg Pool and client
const connectMock = jest.fn();
const releaseMock = jest.fn();

jest.mock('pg', () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      connect: connectMock,
    })),
  };
});

// Helpers to set query behavior per test
function makeClient(responders: ((sql: string, params?: any[]) => any)[]) {
  return {
    query: jest.fn().mockImplementation((sql: string, params?: any[]) => {
      for (const r of responders) {
        const out = r(sql, params);
        if (out !== undefined) return Promise.resolve(out);
      }
      throw new Error('Unexpected SQL in test: ' + sql);
    }),
    release: releaseMock,
  };
}

describe('DatabaseMetricsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('collects metrics with expected shapes', async () => {
    const responders = [
      // pg_stat_statements aggregate
      (sql: string) => sql.includes('FROM pg_stat_statements') && sql.includes('SUM(total_exec_time)')
        ? { rows: [{ total_calls: 120, total_time_ms: 2400, avg_ms: 20, max_ms: 80 }] }
        : undefined,
      // slow queries
      (sql: string) => sql.includes('mean_exec_time >')
        ? { rows: [{ slow: 5 }] }
        : undefined,
      // connections
      (sql: string) => sql.includes('FROM pg_stat_activity') && sql.includes("state = 'active'")
        ? { rows: [{ active: 7, total: 15 }] }
        : undefined,
      // db size
      (sql: string) => sql.includes('pg_database_size')
        ? { rows: [{ db_size: 987654321 }] }
        : undefined,
      // waits (pg_stat_activity wait_event)
      (sql: string) => sql.includes('wait_event IS NOT NULL')
        ? { rows: [ { wait_ms: 5 }, { wait_ms: 12 }, { wait_ms: 130 } ] }
        : undefined,
      // locks waiting
      (sql: string) => sql.includes('FROM pg_locks')
        ? { rows: [{ waiting: 3 }] }
        : undefined,
      // deadlocks
      (sql: string) => sql.includes('FROM pg_stat_database')
        ? { rows: [{ deadlocks: 2 }] }
        : undefined,
    ];

    const client = makeClient(responders);
    connectMock.mockResolvedValue(client);

    const { Pool } = require('pg');
    const pool = new Pool();
    const svc = new DatabaseMetricsService(pool);
    const metrics = await svc.getMetrics();

    // queries
    expect(metrics.queries.throughput).toBe(120);
    expect(metrics.queries.errors.value).toBe(0);
    expect(metrics.queries.slow.value).toBe(5);
    expect(metrics.queries.latency.count).toBe(120);
    expect(metrics.queries.latency.sum).toBe(2400);
    // avg 20ms should land in the <= 25ms bucket by default
    const idx = metrics.queries.latency.buckets.findIndex((b) => b >= 20);
    expect(metrics.queries.latency.counts[idx]).toBe(120);

    // resources
    expect(metrics.resources.connections.value).toBe(7);
    expect(metrics.resources.diskSpace.value).toBe(987654321);
    expect(metrics.resources.cpu.value).toBe(0);
    expect(metrics.resources.memory.value).toBe(0);

    // locks
    expect(metrics.locks.contention.value).toBe(3);
    expect(metrics.locks.deadlocks.value).toBe(2);
    expect(metrics.locks.wait.count).toBe(3);
    // One wait of 5ms should be in <=5ms bucket by default config
    const waitIdx = metrics.locks.wait.buckets.findIndex((b) => b >= 5);
    expect(metrics.locks.wait.counts[waitIdx]).toBeGreaterThanOrEqual(1);
  });

  it('respects custom buckets and slow threshold', async () => {
    const responders = [
      // aggregate
      (sql: string) => sql.includes('FROM pg_stat_statements') && sql.includes('SUM(total_exec_time)')
        ? { rows: [{ total_calls: 10, total_time_ms: 600, avg_ms: 60, max_ms: 100 }] }
        : undefined,
      // slow count (threshold 50ms -> mean 60 counts as slow)
      () => ({ rows: [{ slow: 4 }] }),
      // connections
      (sql: string) => sql.includes('FROM pg_stat_activity') && sql.includes("state = 'active'")
        ? { rows: [{ active: 1, total: 2 }] }
        : undefined,
      // size
      (sql: string) => sql.includes('pg_database_size')
        ? { rows: [{ db_size: 1 }] }
        : undefined,
      // waits
      (sql: string) => sql.includes('wait_event IS NOT NULL')
        ? { rows: [ { wait_ms: 55 } ] }
        : undefined,
      // locks
      (sql: string) => sql.includes('FROM pg_locks')
        ? { rows: [{ waiting: 0 }] }
        : undefined,
      // deadlocks
      (sql: string) => sql.includes('FROM pg_stat_database')
        ? { rows: [{ deadlocks: 0 }] }
        : undefined,
    ];

    const client = makeClient(responders);
    connectMock.mockResolvedValue(client);

    const { Pool } = require('pg');
    const pool = new Pool();
    const svc = new DatabaseMetricsService(pool, { latencyBucketsMs: [10, 100], slowQueryThresholdMs: 50 });
    const metrics = await svc.getMetrics();

    expect(metrics.queries.throughput).toBe(10);
    expect(metrics.queries.slow.value).toBe(4);
    expect(metrics.queries.latency.buckets).toEqual([10, 100]);
    // avg 60 -> <=100 bucket gets the count
    expect(metrics.queries.latency.counts[1]).toBe(10);
  });
});
