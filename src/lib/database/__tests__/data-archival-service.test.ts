import { DataArchivalService, ArchivalConfig, ArchiveCategory } from '../data-archival-service';
import type { DatabasePool, DatabaseClient } from '../database-connection';

// Simple in-memory mock DB to simulate the minimal SQL used by the service
class InMemoryClient implements DatabaseClient {
  private tables: Record<string, any[]>;
  private jobSeq = 0;

  constructor(tables: Record<string, any[]>) {
    this.tables = tables;
  }

  async query(text: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const sql = text.trim().toLowerCase();

    // Transaction statements are no-ops here
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
      return { rows: [], rowCount: 0 };
    }

    // Insert archive job and return id
    if (sql.startsWith('insert into archive_jobs') && sql.includes('returning id')) {
      const id = `job-${++this.jobSeq}`;
      this.tables.archive_jobs.push({ id, status: 'running', start_time: new Date(), end_time: null, affected_records: 0 });
      return { rows: [{ id }], rowCount: 1 };
    }

    // Update archive job with completion details
    if (sql.startsWith('update archive_jobs set status')) {
      const affected = params[0];
      const id = params[1];
      const job = this.tables.archive_jobs.find(j => j.id === id);
      if (job) {
        job.status = 'completed';
        job.end_time = new Date();
        job.affected_records = affected;
      }
      return { rows: [], rowCount: job ? 1 : 0 };
    }

    // SELECT * FROM <source> WHERE <ts> < $1
    if (sql.startsWith('select * from')) {
      // crude parse: select * from <name> where <ts> < $1
      const fromIdx = sql.indexOf('from') + 5;
      const whereIdx = sql.indexOf('where');
      const table = sql.substring(fromIdx, whereIdx).trim();
      const tsCol = sql.substring(whereIdx + 5).split('<')[0].trim();
      const cutoff: Date = params[0];
      const rows = (this.tables[table] || []).filter((r: any) => new Date(r[tsCol]) < cutoff);
      return { rows, rowCount: rows.length };
    }

    // DELETE FROM <source> WHERE <ts> < $1
    if (sql.startsWith('delete from')) {
      const fromIdx = 'delete from'.length;
      const whereIdx = sql.indexOf('where');
      const table = sql.substring(fromIdx, whereIdx).trim();
      const tsCol = sql.substring(whereIdx + 5).split('<')[0].trim();
      const cutoff: Date = params[0];
      const before = this.tables[table].length;
      this.tables[table] = this.tables[table].filter((r: any) => !(new Date(r[tsCol]) < cutoff));
      const removed = before - this.tables[table].length;
      return { rows: [], rowCount: removed };
    }

    // INSERT INTO <archive> (original_id, data, compressed, compression) VALUES ... ON CONFLICT DO NOTHING
    if (sql.startsWith('insert into archived_')) {
      const table = sql.substring('insert into '.length, sql.indexOf('(')).trim();
      const [originalId, data, compressed, compression] = params;
      const exists = this.tables[table].some((r: any) => r.original_id === originalId);
      if (!exists) {
        this.tables[table].push({ original_id: originalId, data, compressed, compression, archived_at: new Date() });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // SELECT original_id, data FROM <archive> [WHERE ...]
    if (sql.startsWith('select original_id, data from')) {
      const table = sql.substring('select original_id, data from'.length).split('where')[0].trim();
      let rows = [...(this.tables[table] || [])];
      // Basic filters support: archived_at >= $1 AND archived_at <= $2 AND original_id = ANY($3)
      if (sql.includes('where')) {
        const paramsCopy = [...params];
        if (sql.includes('archived_at >=')) {
          const from = paramsCopy.shift();
          rows = rows.filter((r: any) => new Date(r.archived_at) >= from);
        }
        if (sql.includes('archived_at <=')) {
          const to = paramsCopy.shift();
          rows = rows.filter((r: any) => new Date(r.archived_at) <= to);
        }
        if (sql.includes('original_id = any')) {
          const ids = paramsCopy.shift();
          rows = rows.filter((r: any) => ids.includes(r.original_id));
        }
      }
      return { rows, rowCount: rows.length };
    }

    // Dynamic INSERT into source built from data keys, with ON CONFLICT (id) DO NOTHING
    if (sql.startsWith('insert into game_history') || sql.startsWith('insert into player_actions')) {
      const table = sql.substring('insert into '.length, sql.indexOf('(')).trim();
      const columns = sql.substring(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(s => s.trim().replace(/"/g, ''));
      const record: any = {};
      columns.forEach((c, i) => (record[c] = params[i]));
      const exists = this.tables[table].some((r: any) => r.id === record.id);
      if (!exists) this.tables[table].push(record);
      return { rows: [], rowCount: exists ? 0 : 1 };
    }

    // COUNT(*)::int as c FROM <source> WHERE <ts> < $1
    if (sql.startsWith('select count(*)::int as c from')) {
      const fromIdx = 'select count(*)::int as c from'.length;
      const whereIdx = sql.indexOf('where');
      const table = sql.substring(fromIdx, whereIdx).trim();
      const tsCol = sql.substring(whereIdx + 5).split('<')[0].trim();
      const cutoff: Date = params[0];
      const count = (this.tables[table] || []).filter((r: any) => new Date(r[tsCol]) < cutoff).length;
      return { rows: [{ c: count }], rowCount: 1 };
    }

    // Default empty response
    return { rows: [], rowCount: 0 };
  }

  release(): void {}
}

class InMemoryPool implements DatabasePool {
  tables: Record<string, any[]>;
  constructor(seed?: Partial<Record<string, any[]>>) {
    const now = Date.now();
    this.tables = {
      // sources
      game_history: [],
      player_actions: [],
      chat_logs: [],
      system_logs: [],
      // archives
      archived_game_history: [],
      archived_player_actions: [],
      archived_chat_logs: [],
      archived_system_logs: [],
      archive_jobs: [],
      ...seed,
    } as any;

    // Decorate provided date strings to Date if needed
    for (const t of Object.keys(this.tables)) {
      this.tables[t] = (this.tables[t] || []).map((r: any) => {
        const out = { ...r };
        if (out.started_at && !(out.started_at instanceof Date)) out.started_at = new Date(out.started_at);
        if (out.timestamp && !(out.timestamp instanceof Date)) out.timestamp = new Date(out.timestamp);
        if (out.created_at && !(out.created_at instanceof Date)) out.created_at = new Date(out.created_at);
        return out;
      });
    }
  }

  async connect(): Promise<DatabaseClient> {
    return new InMemoryClient(this.tables);
  }
  async end(): Promise<void> {}
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

const baseConfig: ArchivalConfig = {
  retention: { gameHistory: 30, chatLogs: 15, playerActions: 20, systemLogs: 7 },
  archiveLocation: 's3://bucket/path',
  compression: true,
  schedule: '* * * * *',
};

describe('DataArchivalService', () => {
  test('archiveCategory moves old game history rows and updates job status', async () => {
    const pool = new InMemoryPool({
      game_history: [
        { id: 'g1', started_at: daysAgo(45), table: 'A' },
        { id: 'g2', started_at: daysAgo(10), table: 'B' },
      ],
    });
    const svc = new DataArchivalService(pool, baseConfig);

    const job = await svc.archiveCategory('gameHistory');
    expect(job.status).toBe('completed');
    expect(job.affectedRecords).toBe(1);

    const client = await pool.connect();
    const archived = (client as any).tables.archived_game_history;
    const source = (client as any).tables.game_history;
    expect(archived.length).toBe(1);
    expect(archived[0].original_id).toBe('g1');
    expect(source.find((r: any) => r.id === 'g1')).toBeUndefined();
    expect(source.find((r: any) => r.id === 'g2')).toBeDefined();
  });

  test('restoreCategory reinserts rows from archive into source', async () => {
    const archivedRows = [
      { original_id: 'g10', data: { id: 'g10', started_at: daysAgo(100), foo: 'bar' }, archived_at: daysAgo(1) },
      { original_id: 'g11', data: { id: 'g11', started_at: daysAgo(90), foo: 'baz' }, archived_at: daysAgo(1) },
    ];
    const pool = new InMemoryPool({
      archived_game_history: archivedRows,
      game_history: [],
    });
    const svc = new DataArchivalService(pool, baseConfig);

    const job = await svc.restoreCategory('gameHistory');
    expect(job.status).toBe('completed');
    expect(job.affectedRecords).toBe(2);

    const client = await pool.connect();
    const source = (client as any).tables.game_history;
    expect(source.map((r: any) => r.id).sort()).toEqual(['g10', 'g11']);
  });

  test('runArchivalCycle archives multiple categories', async () => {
    const pool = new InMemoryPool({
      game_history: [
        { id: 'g20', started_at: daysAgo(60) },
        { id: 'g21', started_at: daysAgo(5) },
      ],
      player_actions: [
        { id: 'a1', timestamp: daysAgo(25), type: 'bet' },
        { id: 'a2', timestamp: daysAgo(10), type: 'fold' },
      ],
    });
    const svc = new DataArchivalService(pool, baseConfig);
    const jobs = await svc.runArchivalCycle();
    expect(jobs).toHaveLength(2);
    expect(jobs.every(j => j.status === 'completed')).toBe(true);

    const client = await pool.connect();
    const archivedGH = (client as any).tables.archived_game_history;
    const archivedPA = (client as any).tables.archived_player_actions;
    expect(archivedGH.length).toBe(1);
    expect(archivedGH[0].original_id).toBe('g20');
    expect(archivedPA.length).toBe(1);
    expect(archivedPA[0].original_id).toBe('a1');
  });

  test('verifyIntegrity reports fewer or equal rows after archival', async () => {
    const pool = new InMemoryPool({
      game_history: [
        { id: 'g30', started_at: daysAgo(80) },
        { id: 'g31', started_at: daysAgo(70) },
        { id: 'g32', started_at: daysAgo(5) },
      ],
    });
    const svc = new DataArchivalService(pool, baseConfig);
    const result = await svc.verifyIntegrity('gameHistory');
    expect(result.ok).toBe(true);
    expect(result.before).toBeGreaterThanOrEqual(result.after);
  });
});
