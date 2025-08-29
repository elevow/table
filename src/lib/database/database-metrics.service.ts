import { Pool } from 'pg';

// US-049: Database Metrics shapes
export interface Histogram {
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

export interface Counter {
  value: number;
}

export interface Gauge {
  value: number;
}

export interface DatabaseMetrics {
  queries: {
    throughput: number; // total calls
    latency: Histogram; // ms buckets
    errors: Counter;    // best-effort
    slow: Counter;      // count of slow queries over threshold
  };
  resources: {
    connections: Gauge; // active/total utilization proxy
    diskSpace: Gauge;   // bytes
    cpu: Gauge;         // percent
    memory: Gauge;      // percent
  };
  locks: {
    contention: Counter; // waiting locks
    wait: Histogram;      // wait times in ms (approx)
    deadlocks: Counter;   // deadlocks from pg_stat_database
  };
}

export interface DatabaseMetricsOptions {
  slowQueryThresholdMs?: number;
  latencyBucketsMs?: number[];
}

export class DatabaseMetricsService {
  private slowMs: number;
  private buckets: number[];

  constructor(private pool: Pool, opts: DatabaseMetricsOptions = {}) {
    this.slowMs = opts.slowQueryThresholdMs ?? 1000;
    this.buckets = opts.latencyBucketsMs ?? [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  }

  async getMetrics(): Promise<DatabaseMetrics> {
    const [queries, resources, locks] = await Promise.all([
      this.collectQueryMetrics(),
      this.collectResourceMetrics(),
      this.collectLockMetrics()
    ]);

    return { queries, resources, locks };
  }

  private async collectQueryMetrics(): Promise<DatabaseMetrics['queries']> {
    const client = await this.pool.connect();
    try {
      const agg = await client.query(`
        SELECT 
          COALESCE(SUM(calls),0) as total_calls,
          COALESCE(SUM(total_exec_time),0) as total_time_ms,
          COALESCE(AVG(mean_exec_time),0) as avg_ms,
          COALESCE(MAX(max_exec_time),0) as max_ms
        FROM pg_stat_statements
      `);

      const slow = await client.query(
        `SELECT COUNT(*)::int as slow FROM pg_stat_statements WHERE mean_exec_time > $1`,
        [this.slowMs]
      );

      const errors = 0; // pg_stat_statements does not track errors; would require log parsing or extensions

      const totalCalls = Number(agg.rows[0]?.total_calls || 0);
      const totalTime = Number(agg.rows[0]?.total_time_ms || 0);
      const avgMs = Number(agg.rows[0]?.avg_ms || 0);
      const maxMs = Number(agg.rows[0]?.max_ms || 0);

      const latency = this.buildLatencyHistogram(totalCalls, totalTime, avgMs, maxMs);

      return {
        throughput: totalCalls,
        latency,
        errors: { value: errors },
        slow: { value: Number(slow.rows[0]?.slow || 0) }
      };
    } finally {
      client.release();
    }
  }

  private async collectResourceMetrics(): Promise<DatabaseMetrics['resources']> {
    const client = await this.pool.connect();
    try {
      const conns = await client.query(`
        SELECT 
          COUNT(*) FILTER (WHERE state = 'active')::int as active,
          COUNT(*)::int as total
        FROM pg_stat_activity
        WHERE datname = current_database()
      `);

      const size = await client.query(`
        SELECT pg_database_size(current_database())::bigint as db_size
      `);

      // System CPU/memory percent are not directly available from Postgres; default to 0 and allow user override via environment collectors.
      const cpuPercent = 0;
      const memPercent = 0;

      return {
        connections: { value: Number(conns.rows[0]?.active || 0) },
        diskSpace: { value: Number(size.rows[0]?.db_size || 0) },
        cpu: { value: cpuPercent },
        memory: { value: memPercent }
      };
    } finally {
      client.release();
    }
  }

  private async collectLockMetrics(): Promise<DatabaseMetrics['locks']> {
    const client = await this.pool.connect();
    try {
      const lockStats = await client.query(`
        SELECT 
          COUNT(*) FILTER (WHERE granted = false)::int as waiting
        FROM pg_locks
      `);

      const deadlocks = await client.query(`
        SELECT COALESCE(SUM(deadlocks),0)::int as deadlocks
        FROM pg_stat_database
        WHERE datname = current_database()
      `);

      const waits = await client.query(`
        SELECT EXTRACT(EPOCH FROM (now() - query_start))*1000 as wait_ms
        FROM pg_stat_activity
        WHERE wait_event IS NOT NULL AND state <> 'idle'
      `);

      const waitHistogram = this.buildWaitHistogram(waits.rows.map(r => Number(r.wait_ms || 0)));

      return {
        contention: { value: Number(lockStats.rows[0]?.waiting || 0) },
        wait: waitHistogram,
        deadlocks: { value: Number(deadlocks.rows[0]?.deadlocks || 0) }
      };
    } finally {
      client.release();
    }
  }

  private buildLatencyHistogram(totalCalls: number, totalTimeMs: number, avgMs: number, maxMs: number): Histogram {
    // With only aggregates, approximate by placing all calls in the bucket containing avgMs and setting sum/count
    const counts = this.buckets.map(() => 0);
    const idx = this.findBucketIndex(avgMs);
    if (idx >= 0 && totalCalls > 0) counts[idx] = totalCalls;
    return { buckets: this.buckets, counts, sum: totalTimeMs, count: totalCalls };
  }

  private buildWaitHistogram(samplesMs: number[]): Histogram {
    const counts = this.buckets.map(() => 0);
    for (const v of samplesMs) {
      const idx = this.findBucketIndex(v);
      if (idx >= 0) counts[idx]++;
    }
    const sum = samplesMs.reduce((a, b) => a + b, 0);
    return { buckets: this.buckets, counts, sum, count: samplesMs.length };
  }

  private findBucketIndex(valueMs: number): number {
    for (let i = 0; i < this.buckets.length; i++) {
      if (valueMs <= this.buckets[i]) return i;
    }
    return this.buckets.length - 1;
  }
}
