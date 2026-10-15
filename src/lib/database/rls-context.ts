// US-066: User Data Privacy - RLS helpers
// Utilities to run queries with a per-request user context to enable RLS policies

import { Pool, PoolClient } from 'pg';
import { DataProtectionService } from './data-protection-service';

export interface RlsRunOptions {
  userId: string; // authenticated user id
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Run a callback with app.current_user_id set so RLS policies can apply.
 * The setting is transaction-scoped, so it is cleared when the connection returns to the pool.
 */
export async function withRlsUserContext<T>(
  pool: Pool,
  opts: RlsRunOptions,
  cb: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SET cannot take a bind parameter ("SET LOCAL x = $1" is a syntax error); set_config can.
    // The third argument makes it local to this transaction.
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [opts.userId]);
    const result = await cb(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Minimal access logger that delegates to DataProtectionService.auditAccess.
 */
export async function logAccess(
  dataProtection: DataProtectionService,
  userId: string,
  resource: string,
  action: string,
  success: boolean,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    await dataProtection.auditAccess(userId, resource, action, success, undefined, metadata);
  } catch {
    // Swallow logging errors per policy
  }
}
