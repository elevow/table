import { createDatabasePool, DatabaseConfig } from '../database/database-connection';
import type { LoginEvent } from '../../types';
import { configureSecurityScheduler } from './security-scheduler';

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v == null || v === '' ? fallback : v;
}

function buildDbConfig(): DatabaseConfig {
  const host = env('DB_HOST') || env('PGHOST') || 'localhost';
  const port = Number(env('DB_PORT') || env('PGPORT') || 5432);
  const database = env('DB_NAME') || env('PGDATABASE') || 'app';
  const username = env('DB_USER') || env('PGUSER') || 'postgres';
  const password = env('DB_PASSWORD') || env('PGPASSWORD') || '';
  const ssl = (env('DB_SSL') || env('PGSSLMODE'))?.toLowerCase() === 'require' ? true : false;
  return { host, port, database, username, password, ssl, poolSize: 10 };
}

const pool = createDatabasePool(buildDbConfig());

export async function fetchLoginsSince(sinceMs: number): Promise<LoginEvent[]> {
  const client = await pool.connect();
  try {
    // Pull recent session creations as proxy for login events
    const res = await client.query(
      `SELECT user_id, ip_address, user_agent, created_at
       FROM user_sessions
       WHERE created_at >= TO_TIMESTAMP($1 / 1000.0)
       ORDER BY created_at ASC
       LIMIT 10000`,
      [sinceMs]
    );
    return (res.rows || [])
      .filter(r => !!r.ip_address && !!r.user_id)
      .map(r => ({
        accountId: String(r.user_id),
        ip: String(r.ip_address),
        userAgent: r.user_agent ? String(r.user_agent) : null,
        fingerprint: null,
        timestamp: new Date(r.created_at).getTime(),
      }));
  } finally {
    client.release();
  }
}

// One-time wiring helper
export function initSecuritySchedulerDb(): void {
  configureSecurityScheduler(fetchLoginsSince);
}
