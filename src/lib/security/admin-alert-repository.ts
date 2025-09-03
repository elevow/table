import { createDatabasePool } from '../database/database-connection';
import type { AdminAlert, AlertStatus } from '../../types';

// Lazy singleton DB pool using environment for configuration via security-scheduler-db builder conventions
function getPool() {
  const { createDatabasePool: mk, DatabaseConfig } = require('../database/database-connection');
  const env = (n: string, fb?: string) => {
    const v = process.env[n];
    return v == null || v === '' ? fb : v;
  };
  const cfg: import('../database/database-connection').DatabaseConfig = {
    host: (env('DB_HOST') || env('PGHOST') || 'localhost') as string,
    port: Number(env('DB_PORT') || env('PGPORT') || 5432),
    database: (env('DB_NAME') || env('PGDATABASE') || 'app') as string,
    username: (env('DB_USER') || env('PGUSER') || 'postgres') as string,
    password: (env('DB_PASSWORD') || env('PGPASSWORD') || '') as string,
    ssl: ((env('DB_SSL') || env('PGSSLMODE')) || '').toLowerCase() === 'require'
  };
  return mk(cfg);
}

const pool = getPool();

export class AdminAlertRepository {
  async create(alert: AdminAlert): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO admin_alerts (id, type, severity, message, at, involved, source, status, evidence, created_at, updated_at)
         VALUES ($1,$2,$3,$4,TO_TIMESTAMP($5/1000.0),$6,$7,$8,$9,TO_TIMESTAMP($10/1000.0),TO_TIMESTAMP($11/1000.0))`,
        [
          alert.id,
          alert.type,
          alert.severity,
          alert.message,
          alert.at,
          JSON.stringify(alert.involved || []),
          alert.source,
          alert.status,
          JSON.stringify(alert.evidence || []),
          alert.createdAt,
          alert.updatedAt,
        ]
      );
    } finally {
      client.release();
    }
  }

  async list(): Promise<AdminAlert[]> {
    const client = await pool.connect();
    try {
      const res = await client.query(`SELECT * FROM admin_alerts ORDER BY created_at DESC LIMIT 1000`);
      return res.rows.map(this.mapRow);
    } finally {
      client.release();
    }
  }

  async get(id: string): Promise<AdminAlert | null> {
    const client = await pool.connect();
    try {
      const res = await client.query(`SELECT * FROM admin_alerts WHERE id = $1`, [id]);
      return res.rows[0] ? this.mapRow(res.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async updateStatus(id: string, status: AlertStatus): Promise<AdminAlert | null> {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `UPDATE admin_alerts SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, status]
      );
      return res.rows[0] ? this.mapRow(res.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  private mapRow = (r: any): AdminAlert => ({
    id: String(r.id),
    type: r.type,
    severity: r.severity,
    message: r.message,
    at: new Date(r.at).getTime(),
    involved: Array.isArray(r.involved) ? r.involved.map(String) : [],
    source: r.source,
    status: r.status,
    evidence: r.evidence ?? [],
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  });
}

export const adminAlertRepository = new AdminAlertRepository();
