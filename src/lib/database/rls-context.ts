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
 * Run a callback with app.current_user_id set for the session so RLS policies can apply.
 * Ensures setting is reset on release.
 */
export async function withRlsUserContext<T>(
  pool: Pool,
  opts: RlsRunOptions,
  cb: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    // Set a scoped parameter used by our RLS policies
    await client.query(`SET LOCAL app.current_user_id = $1`, [opts.userId]);
    return await cb(client);
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
