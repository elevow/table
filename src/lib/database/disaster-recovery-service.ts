/**
 * US-046: Disaster Recovery Service
 * - Define recovery procedures (via plan.procedures)
 * - Setup failover systems (active pool switching primary<->replica)
 * - Implement data replication (sync/async simulation with lag)
 * - Test recovery scenarios (runTestingScenarios returning results)
 * - Document recovery steps (console logs + types; separate docs file recommended)
 */

import type { DatabasePool } from './database-connection';

export type RecoveryStep = {
  id: string;
  description: string;
};

export type TestProcedure = {
  id: string;
  scenario: string;
  steps: RecoveryStep[];
  expectedOutcome: string;
};

export interface DisasterRecoveryPlan {
  rpo: number; // minutes
  rto: number; // minutes
  replication: {
    type: 'sync' | 'async';
    location: string;
    lag: number; // milliseconds (target/expected)
  };
  procedures: {
    failover: RecoveryStep[];
    failback: RecoveryStep[];
    testing: TestProcedure[];
  };
}

export interface ReplicationStatus {
  type: 'sync' | 'async';
  lagMs: number;
  lastReplicatedAt?: Date;
  pendingOps: number;
}

export interface RecoveryResult {
  ok: boolean;
  rtoMs: number;
  message: string;
}

type PendingOp = { sql: string; params?: any[]; enqueuedAt: number };

export class DisasterRecoveryService {
  private active: 'primary' | 'replica' = 'primary';
  private pendingReplication: PendingOp[] = [];
  private lastReplicatedAt?: Date;
  private lastReplicationLagMs = 0;

  constructor(
    private primaryPool: DatabasePool,
    private replicaPool: DatabasePool,
    private plan: DisasterRecoveryPlan
  ) {}

  getActivePool(): DatabasePool {
    return this.active === 'primary' ? this.primaryPool : this.replicaPool;
  }

  getReplicationStatus(): ReplicationStatus {
    return {
      type: this.plan.replication.type,
      lagMs: this.lastReplicationLagMs,
      lastReplicatedAt: this.lastReplicatedAt,
      pendingOps: this.pendingReplication.length,
    };
  }

  async replicate(sql: string, params?: any[]): Promise<{ primary: number; replica: number; lagMs: number }>{
    // Always apply to primary immediately
    const primaryClient = await this.primaryPool.connect();
    try {
      const res = await primaryClient.query(sql, params);
      const rowCount = res.rowCount ?? 0;
      if (this.plan.replication.type === 'sync') {
        // Apply immediately to replica
        const replicaClient = await this.replicaPool.connect();
        try {
          const r = await replicaClient.query(sql, params);
          this.lastReplicationLagMs = 0;
          this.lastReplicatedAt = new Date();
          return { primary: rowCount, replica: r.rowCount ?? 0, lagMs: 0 };
        } finally {
          replicaClient.release();
        }
      } else {
        // Async: enqueue and report lag ~ configured
        this.pendingReplication.push({ sql, params, enqueuedAt: Date.now() });
        this.lastReplicationLagMs = Math.max(this.lastReplicationLagMs, this.plan.replication.lag);
        return { primary: rowCount, replica: 0, lagMs: this.lastReplicationLagMs };
      }
    } finally {
      primaryClient.release();
    }
  }

  /** Apply pending async replication operations (for deterministic tests). */
  async applyPendingReplication(): Promise<number> {
    if (this.plan.replication.type !== 'async') return 0;
    let applied = 0;
    while (this.pendingReplication.length) {
      const op = this.pendingReplication.shift()!;
      const client = await this.replicaPool.connect();
      try {
        await client.query(op.sql, op.params);
        applied++;
      } finally {
        client.release();
      }
      this.lastReplicationLagMs = Date.now() - op.enqueuedAt;
      this.lastReplicatedAt = new Date();
    }
    return applied;
  }

  /** Perform a failover from primary to replica and measure RTO. */
  async failover(): Promise<RecoveryResult> {
    const start = Date.now();
    console.log('Failover initiated: switching from primary to replica');
    // Execute documented steps (no-ops here, but logged for traceability)
    for (const step of this.plan.procedures.failover) {
      console.log(`Failover step: ${step.id} - ${step.description}`);
    }
    this.active = 'replica';
    const rtoMs = Date.now() - start;
    const ok = rtoMs <= this.plan.rto * 60_000;
    console.log(`Failover completed in ${rtoMs}ms (RTO target: ${this.plan.rto}m)`);
    return { ok, rtoMs, message: ok ? 'RTO met' : 'RTO exceeded' };
  }

  /** Perform a failback from replica to primary. */
  async failback(): Promise<RecoveryResult> {
    const start = Date.now();
    console.log('Failback initiated: switching from replica to primary');
    for (const step of this.plan.procedures.failback) {
      console.log(`Failback step: ${step.id} - ${step.description}`);
    }
    this.active = 'primary';
    const rtoMs = Date.now() - start;
    const ok = rtoMs <= this.plan.rto * 60_000;
    console.log(`Failback completed in ${rtoMs}ms (RTO target: ${this.plan.rto}m)`);
    return { ok, rtoMs, message: ok ? 'RTO met' : 'RTO exceeded' };
  }

  /**
   * Evaluate whether RPO is currently met, based on pending async replication.
   * For sync replication, RPO is always met (lag 0).
   */
  isRpoMet(): boolean {
    if (this.plan.replication.type === 'sync') return true;
    if (!this.pendingReplication.length) return true;
    // If there are pending ops older than RPO window, RPO is not met
    const oldest = this.pendingReplication[0]?.enqueuedAt ?? Date.now();
    const ageMs = Date.now() - oldest;
    return ageMs <= this.plan.rpo * 60_000;
  }

  /** Run documented test procedures and return a compact report. */
  async runTestingScenarios(): Promise<{ total: number; passed: number; details: Array<{ id: string; ok: boolean }> }>{
    const details: Array<{ id: string; ok: boolean }> = [];
    for (const proc of this.plan.procedures.testing) {
      console.log(`Testing scenario: ${proc.id} - ${proc.scenario}`);
      // Simulate execution of steps
      for (const step of proc.steps) {
        console.log(`Test step: ${step.id} - ${step.description}`);
      }
      // For now, consider a scenario passed if RPO and current RTO expectations are met
      const rpoOk = this.isRpoMet();
      // RTO is time to switch; simulate instantly here
      const rtoOk = true;
      details.push({ id: proc.id, ok: rpoOk && rtoOk });
    }
    const passed = details.filter(d => d.ok).length;
    return { total: details.length, passed, details };
  }
}
