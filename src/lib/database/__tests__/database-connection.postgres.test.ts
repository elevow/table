// Branch coverage: exercise the real Postgres pool path by mocking 'pg'

import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';

describe('Database Connection (Postgres path via mocked pg)', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    jest.resetModules();
    // Replace env object to avoid assigning to readonly typed properties
    process.env = {
      ...process.env,
      NODE_ENV: 'production',
      USE_MOCK_DB: 'false'
    } as any;

    jest.doMock('pg', () => {
      class MockPool {
        totalCount: number;
        idleCount: number;
        waitingCount: number;
        options: { max: number };
        constructor(opts: any) {
          this.totalCount = 5;
          this.idleCount = 2;
          this.waitingCount = 1;
          this.options = { max: opts?.max ?? 10 };
        }
        async connect() {
          return {
            query: async () => ({ rows: [{ id: 1 }], rowCount: 1 }),
            release: jest.fn()
          };
        }
        async end() { /* no-op */ }
      }
      return { Pool: MockPool };
    }, { virtual: true });
  });

  afterAll(() => {
    jest.unmock('pg');
    process.env = originalEnv;
  });

  test('creates a Postgres-backed pool and exposes stats/connect', async () => {
    // Load after mocking
    const { createDatabasePool, MockDatabasePool } = await import('../database-connection');

    const pool = createDatabasePool({
      host: 'localhost',
      port: 5432,
      database: 'prod_db',
      username: 'prod_user',
      password: 'prod_pass',
      ssl: false,
      maxPoolSize: 20
    });

    // Should not fall back to Mock when pg is available
    expect(pool).not.toBeInstanceOf(MockDatabasePool);
    expect(typeof (pool as any).getStats).toBe('function');

    const stats = (pool as any).getStats();
    expect(stats).toEqual(expect.objectContaining({ total: 5, idle: 2, waiting: 1, max: 20 }));

    const client = await pool.connect();
    const res = await client.query('SELECT 1');
    expect(res.rows).toHaveLength(1);
    client.release();

    await pool.end();
  });
});
