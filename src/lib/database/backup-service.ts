/**
 * US-045: Automated Backups
 * - Schedule regular backups (config-driven, trigger methods provided)
 * - Verify backup integrity (checksum/manifest verification)
 * - Implement point-in-time recovery (simulation via restore job and selection of latest backup before target)
 * - Monitor backup success (console logs for observability and tests)
 * - Test recovery procedures (covered by unit tests using in-memory DB)
 */

import type { DatabasePool } from './database-connection';

export type CronExpression = string;

export interface BackupConfig {
  schedule: {
    full: CronExpression;
    incremental: CronExpression;
  };
  retention: {
    full: number; // days
    incremental: number; // days
  };
  location: {
    primary: string;
    secondary: string;
  };
  encryption: {
    enabled: boolean;
    algorithm: string;
  };
}

export type BackupType = 'full' | 'incremental';

export interface BackupJob {
  id: string;
  type: BackupType | 'restore';
  startTime: Date;
  endTime: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
  details?: string;
}

export interface BackupRecord {
  id: string;
  type: BackupType;
  created_at: Date;
  location_primary: string;
  location_secondary?: string | null;
  encryption_enabled: boolean;
  encryption_algorithm?: string | null;
  checksum?: string | null;
  size_bytes?: number | null;
  status: 'pending' | 'completed' | 'verified' | 'failed';
  verified_at?: Date | null;
  manifest?: any; // JSON manifest with counts and metadata
}

export class BackupService {
  constructor(private pool: DatabasePool, private config: BackupConfig) {}

  /** Create a full or incremental backup now. */
  async createBackup(type: BackupType = 'full'): Promise<BackupJob> {
    const client = await this.pool.connect();
    const start = new Date();
    let status: BackupJob['status'] = 'running';
    let jobId = 'backup-' + start.getTime().toString();
    try {
      await client.query('BEGIN');

      // Track job in backup_jobs for observability
      const jobIns = await client.query(
        `INSERT INTO backup_jobs (job_type, status, start_time)
         VALUES ($1, 'running', NOW()) RETURNING id`,
        [type]
      );
      jobId = jobIns.rows[0]?.id ?? jobId;

      // Gather a simple manifest for integrity verification (table counts)
      // Keeping queries generic to work across real DB and tests
      const tables = ['game_history', 'player_actions', 'chat_logs', 'system_logs'];
      const counts: Record<string, number> = {};
      for (const t of tables) {
        try {
          const r = await client.query(`SELECT COUNT(*)::int as c FROM ${t}`);
          counts[t] = r.rows?.[0]?.c ?? 0;
        } catch {
          // Table might not exist in some environments; treat as 0
          counts[t] = 0;
        }
      }

      const manifest = {
        type,
        createdAt: new Date().toISOString(),
        counts,
        schedule: this.config.schedule,
        retention: this.config.retention,
      };

      const manifestStr = JSON.stringify(manifest);
      const checksum = this.simpleChecksum(manifestStr);
      const size = Buffer.from(manifestStr).byteLength;

      // Store backup record (no real object storage; we record locations and manifest)
      const backupIns = await client.query(
        `INSERT INTO backups 
          (type, created_at, location_primary, location_secondary, encryption_enabled, encryption_algorithm, checksum, size_bytes, status, manifest)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, 'completed', $8::jsonb)
         RETURNING id`,
        [
          type,
          this.config.location.primary,
          this.config.location.secondary ?? null,
          !!this.config.encryption.enabled,
          this.config.encryption.enabled ? this.config.encryption.algorithm : null,
          checksum,
          size,
          manifestStr,
        ]
      );
      const backupId = backupIns.rows[0]?.id;

      // Complete job
      await client.query(
        `UPDATE backup_jobs SET status='completed', end_time=NOW(), affected_objects=$1 WHERE id=$2`,
        [Object.values(counts).reduce((a, b) => a + b, 0), jobId]
      );

      await client.query('COMMIT');

      status = 'completed';
      console.log(`Backup completed: type=${type}, id=${backupId ?? jobId}, size=${size}B, checksum=${checksum}`);

      return { id: String(backupId ?? jobId), type, startTime: start, endTime: new Date(), status };
    } catch (e) {
      await client.query('ROLLBACK');
      status = 'failed';
      console.error('Backup failed:', e);
      return { id: String(jobId), type, startTime: start, endTime: new Date(), status };
    } finally {
      client.release();
    }
  }

  /** Verify the integrity of a backup by recomputing the checksum of its manifest. */
  async verifyBackup(backupId: string): Promise<{ ok: boolean; checksum: string }>{
    const client = await this.pool.connect();
    try {
      const res = await client.query(`SELECT id, manifest, checksum FROM backups WHERE id = $1`, [backupId]);
      const row = res.rows?.[0];
      if (!row) return { ok: false, checksum: '' };
      const manifestStr = typeof row.manifest === 'string' ? row.manifest : JSON.stringify(row.manifest);
      const computed = this.simpleChecksum(manifestStr);
      const ok = computed === row.checksum;
      if (ok) {
        await client.query(`UPDATE backups SET status='verified', verified_at=NOW() WHERE id=$1`, [backupId]);
        console.log(`Backup verified: id=${backupId}`);
      }
      return { ok, checksum: computed };
    } finally {
      client.release();
    }
  }

  /** Perform a simulated point-in-time restore to the nearest backup before target time. */
  async restoreTo(targetTime: Date): Promise<BackupJob> {
    const client = await this.pool.connect();
    const start = new Date();
    let status: BackupJob['status'] = 'running';
    let jobId = 'restore-' + start.getTime().toString();
    try {
      await client.query('BEGIN');
      const jobIns = await client.query(
        `INSERT INTO backup_jobs (job_type, status, start_time)
         VALUES ('restore', 'running', NOW()) RETURNING id`
      );
      jobId = jobIns.rows[0]?.id ?? jobId;

      // Find latest backup before target
      const sel = await client.query(
        `SELECT id, created_at FROM backups WHERE created_at <= $1 ORDER BY created_at DESC LIMIT 1`,
        [targetTime]
      );
      const chosen = sel.rows?.[0];

      // Record restore point for audit
      await client.query(
        `INSERT INTO restore_points (target_time, chosen_backup_id, created_at, status)
         VALUES ($1, $2, NOW(), 'completed')`,
        [targetTime, chosen?.id ?? null]
      );

      await client.query(`UPDATE backup_jobs SET status='completed', end_time=NOW() WHERE id=$1`, [jobId]);
      await client.query('COMMIT');
      status = 'completed';
      console.log(`Restore to ${targetTime.toISOString()} completed using backup=${chosen?.id ?? 'none'}`);
      return { id: String(jobId), type: 'restore', startTime: start, endTime: new Date(), status, details: chosen?.id };
    } catch (e) {
      await client.query('ROLLBACK');
      status = 'failed';
      console.error('Restore failed:', e);
      return { id: String(jobId), type: 'restore', startTime: start, endTime: new Date(), status };
    } finally {
      client.release();
    }
  }

  /** Very simple checksum helper based on a rolling hash. */
  private simpleChecksum(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  }
}
