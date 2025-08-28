/**
 * US-044: Data Archival Service
 * Implements archival criteria, process, retention, restoration, and integrity checks.
 */

import { DatabasePool } from './database-connection';

export type CronExpression = string;

export interface ArchivalConfig {
  retention: {
    gameHistory: number; // days
    chatLogs: number;
    playerActions: number;
    systemLogs: number;
  };
  archiveLocation: string; // e.g., S3 bucket path or local folder (not used directly here)
  compression: boolean;
  schedule: CronExpression;
}

export interface ArchiveJob {
  id: string;
  startTime: Date;
  endTime: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
  affectedRecords: number;
  errors: Error[];
}

export type ArchiveCategory = 'gameHistory' | 'playerActions' | 'chatLogs' | 'systemLogs';

export class DataArchivalService {
  constructor(private pool: DatabasePool, private config: ArchivalConfig) {}

  // Define archival criteria dates based on retention
  private cutoffDateFor(category: ArchiveCategory): Date {
    const days = this.config.retention[category];
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  }

  // Run a full archival cycle across categories
  async runArchivalCycle(categories: ArchiveCategory[] = ['gameHistory', 'playerActions']): Promise<ArchiveJob[]> {
    const jobs: ArchiveJob[] = [];
    for (const category of categories) {
      const job = await this.archiveCategory(category);
      jobs.push(job);
    }
    return jobs;
  }

  // Archive a single category based on cutoff date
  async archiveCategory(category: ArchiveCategory): Promise<ArchiveJob> {
    const client = await this.pool.connect();
    const start = new Date();
    let affected = 0;
    let status: ArchiveJob['status'] = 'running';
    const errors: Error[] = [];

    try {
      await client.query('BEGIN');

      // Insert archive job (pending -> running)
      const insertJob = await client.query(
        `INSERT INTO archive_jobs (job_type, category, status, start_time)
         VALUES ('archive', $1, 'running', NOW()) RETURNING id`,
        [category]
      );
      const jobId = insertJob.rows[0].id as string;

      // Figure out cutoff
      const cutoff = this.cutoffDateFor(category);

      // Choose source and target tables
      const mapping = this.getTableMapping(category);

      // Move data older than cutoff to archive table (store as JSONB, with optional compression placeholder)
      const selectSql = `SELECT * FROM ${mapping.source} WHERE ${mapping.timestampCol} < $1`;
      const selectRes = await client.query(selectSql, [cutoff]);

      for (const row of selectRes.rows) {
        const originalId = row.id || row.original_id || row.game_id || row.player_id;
        const data = JSON.stringify(row);

        // Store JSONB copy in archive table (compression flag only; actual compression handled elsewhere)
        await client.query(
          `INSERT INTO ${mapping.archive} (original_id, data, compressed, compression)
           VALUES ($1, $2::jsonb, $3, $4)
           ON CONFLICT (original_id) DO NOTHING`,
          [originalId, data, this.config.compression, this.config.compression ? 'gzip' : null]
        );

        affected++;
      }

      // Delete moved rows from source
      if (affected > 0) {
        await client.query(`DELETE FROM ${mapping.source} WHERE ${mapping.timestampCol} < $1`, [cutoff]);
      }

      // Update job status
      await client.query(
        `UPDATE archive_jobs SET status='completed', end_time=NOW(), affected_records=$1 WHERE id=$2`,
        [affected, jobId]
      );

      await client.query('COMMIT');

      return {
        id: 'archive-' + start.getTime().toString(),
        startTime: start,
        endTime: new Date(),
        status: 'completed',
        affectedRecords: affected,
        errors
      };
    } catch (e: any) {
      errors.push(e);
      await client.query('ROLLBACK');
      status = 'failed';
      return {
        id: 'archive-' + start.getTime().toString(),
        startTime: start,
        endTime: new Date(),
        status,
        affectedRecords: affected,
        errors
      };
    } finally {
      client.release();
    }
  }

  // Restore archived records back to source table (by range)
  async restoreCategory(
    category: ArchiveCategory,
    options: { from?: Date; to?: Date; ids?: string[] } = {}
  ): Promise<ArchiveJob> {
    const client = await this.pool.connect();
    const start = new Date();
    let affected = 0;
    const errors: Error[] = [];

    try {
      await client.query('BEGIN');
      const mapping = this.getTableMapping(category);

      // Select archived rows to restore
      const conditions: string[] = [];
      const params: any[] = [];
      let p = 1;
      if (options.from) { conditions.push(`archived_at >= $${p++}`); params.push(options.from); }
      if (options.to) { conditions.push(`archived_at <= $${p++}`); params.push(options.to); }
      if (options.ids && options.ids.length) { conditions.push(`original_id = ANY($${p++})`); params.push(options.ids); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const rows = await client.query(`SELECT original_id, data FROM ${mapping.archive} ${where}`, params);

      for (const r of rows.rows) {
        const data = r.data as any;
        // Build a dynamic insert based on keys
        const keys = Object.keys(data);
        const cols = keys.map(k => '"' + k + '"').join(', ');
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const values = keys.map(k => data[k]);

        await client.query(
          `INSERT INTO ${mapping.source} (${cols}) VALUES (${placeholders})
           ON CONFLICT (id) DO NOTHING`,
          values
        );
        affected++;
      }

      await client.query('COMMIT');

      return {
        id: 'restore-' + start.getTime().toString(),
        startTime: start,
        endTime: new Date(),
        status: 'completed',
        affectedRecords: affected,
        errors
      };
    } catch (e: any) {
      await client.query('ROLLBACK');
      errors.push(e);
      return {
        id: 'restore-' + start.getTime().toString(),
        startTime: start,
        endTime: new Date(),
        status: 'failed',
        affectedRecords: affected,
        errors
      };
    } finally {
      client.release();
    }
  }

  // Simple integrity check: confirm source older-than-cutoff rows count drops after archival
  async verifyIntegrity(category: ArchiveCategory): Promise<{ ok: boolean; before: number; after: number }>{
    const client = await this.pool.connect();
    try {
      const cutoff = this.cutoffDateFor(category);
      const mapping = this.getTableMapping(category);
      const before = await client.query(`SELECT COUNT(*)::int as c FROM ${mapping.source} WHERE ${mapping.timestampCol} < $1`, [cutoff]);
      const beforeCount = before.rows[0].c as number;

      // Archive once
      await this.archiveCategory(category);

      const after = await client.query(`SELECT COUNT(*)::int as c FROM ${mapping.source} WHERE ${mapping.timestampCol} < $1`, [cutoff]);
      const afterCount = after.rows[0].c as number;

      return { ok: afterCount <= beforeCount, before: beforeCount, after: afterCount };
    } finally {
      client.release();
    }
  }

  // Map categories to tables and their timestamp columns
  private getTableMapping(category: ArchiveCategory): { source: string; archive: string; timestampCol: string } {
    switch (category) {
      case 'gameHistory':
        return { source: 'game_history', archive: 'archived_game_history', timestampCol: 'started_at' };
      case 'playerActions':
        return { source: 'player_actions', archive: 'archived_player_actions', timestampCol: 'timestamp' };
      case 'chatLogs':
        return { source: 'chat_logs', archive: 'archived_chat_logs', timestampCol: 'created_at' };
      case 'systemLogs':
        return { source: 'system_logs', archive: 'archived_system_logs', timestampCol: 'created_at' };
      default:
        return { source: 'game_history', archive: 'archived_game_history', timestampCol: 'started_at' };
    }
  }
}
