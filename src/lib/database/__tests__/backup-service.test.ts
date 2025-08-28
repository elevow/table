import { BackupService, BackupConfig } from '../backup-service';
import type { DatabasePool, DatabaseClient } from '../database-connection';

// In-memory DB to simulate minimal SQL patterns used by BackupService
class InMemoryClient implements DatabaseClient {
  constructor(private tables: Record<string, any[]>) {}

  async query(text: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }>{
    const sql = text.trim().toLowerCase();
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [], rowCount: 0 };

    // backup_jobs insert
    if (sql.startsWith('insert into backup_jobs') && sql.includes('returning id')) {
  const id = `job-${(this.tables as any)._seq++}`;
      this.tables.backup_jobs.push({ id, job_type: params[0] ?? 'restore', status: 'running', start_time: new Date() });
      return { rows: [{ id }], rowCount: 1 };
    }

    // backup_jobs update
    if (sql.startsWith("update backup_jobs set status='completed'")) {
      const affected = params[0];
      const id = params[1];
      const job = this.tables.backup_jobs.find((j: any) => j.id === id);
      if (job) { job.status = 'completed'; job.end_time = new Date(); job.affected_objects = affected; }
      return { rows: [], rowCount: job ? 1 : 0 };
    }

    // backups insert
    if (sql.startsWith('insert into backups') && sql.includes('returning id')) {
  const id = `b-${(this.tables as any)._seq++}`;
      const [type, primary, secondary, encEnabled, encAlgo, checksum, size, manifest] = params;
      this.tables.backups.push({ id, type, created_at: new Date(), location_primary: primary, location_secondary: secondary, encryption_enabled: encEnabled, encryption_algorithm: encAlgo, checksum, size_bytes: size, status: 'completed', manifest: JSON.parse(manifest) });
      return { rows: [{ id }], rowCount: 1 };
    }

    // backups select by id
    if (sql.startsWith('select id, manifest, checksum from backups where id =')) {
      const id = params[0];
      const row = this.tables.backups.find((b: any) => b.id === id);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    // backups update verified
    if (sql.startsWith("update backups set status='verified'")) {
      const id = params[0];
      const row = this.tables.backups.find((b: any) => b.id === id);
      if (row) { row.status = 'verified'; row.verified_at = new Date(); }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    // backups select by created_at
    if (sql.startsWith('select id, created_at from backups where created_at <=')) {
      const target = params[0];
      const rows = [...this.tables.backups]
        .filter((b: any) => b.created_at <= target)
        .sort((a: any, b: any) => b.created_at - a.created_at)
        .slice(0, 1)
        .map((b: any) => ({ id: b.id, created_at: b.created_at }));
      return { rows, rowCount: rows.length };
    }

    // restore_points insert
    if (sql.startsWith('insert into restore_points')) {
      const [target, chosen] = params;
  this.tables.restore_points.push({ id: `rp-${(this.tables as any)._seq++}`, target_time: target, chosen_backup_id: chosen, created_at: new Date(), status: 'completed' });
      return { rows: [], rowCount: 1 };
    }

    // generic count queries for manifest
    if (sql.startsWith('select count(*)::int as c from')) {
      const table = sql.replace('select count(*)::int as c from', '').trim();
      const rows = this.tables[table] || [];
      return { rows: [{ c: rows.length }], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }
  release(): void {}
}

class InMemoryPool implements DatabasePool {
  tables: Record<string, any[]> & { _seq: number };
  constructor(seed?: Partial<Record<string, any[]>>) {
    this.tables = {
      _seq: 1,
      backups: [],
      backup_jobs: [],
      restore_points: [],
      game_history: [],
      player_actions: [],
      chat_logs: [],
      system_logs: [],
      ...seed,
    } as any;
  }
  async connect(): Promise<DatabaseClient> { return new InMemoryClient(this.tables); }
  async end(): Promise<void> {}
}

const config: BackupConfig = {
  schedule: { full: '0 0 * * *', incremental: '*/15 * * * *' },
  retention: { full: 14, incremental: 3 },
  location: { primary: 's3://primary', secondary: 's3://secondary' },
  encryption: { enabled: true, algorithm: 'aes-256-gcm' },
};

describe('BackupService (US-045)', () => {
  test('createBackup records manifest and logs completion', async () => {
    const pool = new InMemoryPool({ game_history: [{ id: 'g1' }, { id: 'g2' }], player_actions: [{ id: 'a1' }] });
    const svc = new BackupService(pool, config);
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const job = await svc.createBackup('full');
    expect(job.status).toBe('completed');
    expect(job.type).toBe('full');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Backup completed'));
    logSpy.mockRestore();

    const client = await pool.connect();
    const backups = (client as any).tables.backups;
    expect(backups.length).toBe(1);
    expect(backups[0].manifest.counts.game_history).toBe(2);
    expect(backups[0].manifest.counts.player_actions).toBe(1);
    expect(backups[0].checksum).toBeDefined();
  });

  test('verifyBackup recomputes checksum and marks as verified', async () => {
    const pool = new InMemoryPool();
    const svc = new BackupService(pool, config);
    const job = await svc.createBackup('incremental');
    const result = await svc.verifyBackup(job.id);
    expect(result.ok).toBe(true);
  });

  test('restoreTo selects latest backup before target and logs', async () => {
    const pool = new InMemoryPool();
    const svc = new BackupService(pool, config);
    const b1 = await svc.createBackup('full');
    // ensure second backup has later timestamp
    await new Promise(r => setTimeout(r, 5));
    const b2 = await svc.createBackup('incremental');
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const target = new Date();
    const job = await svc.restoreTo(target);
    expect(job.status).toBe('completed');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Restore to'));
    logSpy.mockRestore();

    const client = await pool.connect();
    const rps = (client as any).tables.restore_points;
    expect(rps.length).toBe(1);
    expect(rps[0].chosen_backup_id).toBeDefined();
  });
});
