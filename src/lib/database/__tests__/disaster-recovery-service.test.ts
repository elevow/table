import { DisasterRecoveryService, DisasterRecoveryPlan } from '../disaster-recovery-service';
import type { DatabasePool, DatabaseClient } from '../database-connection';

class InMemoryClient implements DatabaseClient {
  constructor(private tables: Record<string, any[]>) {}
  async query(text: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }>{
    const sql = text.trim().toLowerCase();
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [], rowCount: 0 };
    if (sql.startsWith('insert into')) {
      const table = sql.substring('insert into '.length, sql.indexOf('(')).trim();
      const cols = sql.substring(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(s => s.trim().replace(/"/g, ''));
      const rec: any = {};
      cols.forEach((c, i) => rec[c] = params[i]);
      this.tables[table] = this.tables[table] || [];
      this.tables[table].push(rec);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('update')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
  release(): void {}
}

class InMemoryPool implements DatabasePool {
  constructor(public tables: Record<string, any[]> = {}) {}
  async connect(): Promise<DatabaseClient> { return new InMemoryClient(this.tables); }
  async end(): Promise<void> {}
}

const plan: DisasterRecoveryPlan = {
  rpo: 5, // minutes
  rto: 10, // minutes
  replication: { type: 'async', location: 'region-b', lag: 500 },
  procedures: {
    failover: [ { id: 'f1', description: 'Promote replica' }, { id: 'f2', description: 'Redirect traffic' } ],
    failback: [ { id: 'b1', description: 'Re-sync primary' }, { id: 'b2', description: 'Switch traffic back' } ],
    testing: [ { id: 't1', scenario: 'Zone outage', steps: [{ id: 's1', description: 'Disable zone' }], expectedOutcome: 'Traffic on replica' } ],
  },
};

describe('DisasterRecoveryService (US-046)', () => {
  test('async replication enqueues then applies on demand; RPO check', async () => {
    const primary = new InMemoryPool({ orders: [] });
    const replica = new InMemoryPool({ orders: [] });
    const dr = new DisasterRecoveryService(primary, replica, plan);

    const r1 = await dr.replicate('INSERT INTO orders(id, amount) VALUES ($1, $2)', ['o1', 10]);
    expect(r1.primary).toBe(1);
    expect(r1.replica).toBe(0);
    expect(dr.getReplicationStatus().pendingOps).toBe(1);
    expect(dr.isRpoMet()).toBe(true);

    const applied = await dr.applyPendingReplication();
    expect(applied).toBe(1);
    expect(dr.getReplicationStatus().pendingOps).toBe(0);
  });

  test('failover and failback meet RTO and switch active pool', async () => {
    const primary = new InMemoryPool();
    const replica = new InMemoryPool();
    const dr = new DisasterRecoveryService(primary, replica, { ...plan, replication: { ...plan.replication, type: 'sync' } });

    const over = await dr.failover();
    expect(over.ok).toBe(true);
    expect(dr.getActivePool()).toBe(replica);

    const back = await dr.failback();
    expect(back.ok).toBe(true);
    expect(dr.getActivePool()).toBe(primary);
  });

  test('runTestingScenarios returns results for procedures', async () => {
    const primary = new InMemoryPool();
    const replica = new InMemoryPool();
    const dr = new DisasterRecoveryService(primary, replica, plan);
    const res = await dr.runTestingScenarios();
    expect(res.total).toBe(1);
    expect(res.passed).toBe(1);
  });
});
