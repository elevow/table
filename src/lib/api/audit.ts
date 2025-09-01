import { Pool } from 'pg';
import { DataProtectionFactory } from '../database/security-utilities';
import { logAccess } from '../database/rls-context';

export type AuditMetadata = Record<string, any>;
export type AuditFn = (
  userId: string,
  resource: string,
  action: string,
  success: boolean,
  metadata?: AuditMetadata
) => Promise<void>;

/**
 * Creates a best-effort audit logger bound to a pg Pool.
 * - Lazily initializes DataProtectionService per call.
 * - Swallows all errors so auditing never breaks core functionality.
 */
export function createSafeAudit(pool: Pool): AuditFn {
  return async (userId, resource, action, success, metadata) => {
    try {
      const dp = await DataProtectionFactory.createDataProtectionService(pool);
      await logAccess(dp, userId, resource, action, success, metadata);
    } catch {
      // ignore audit failures
    }
  };
}

/**
 * Convenience one-shot audit call without storing the function.
 */
export async function safeAudit(
  pool: Pool,
  userId: string,
  resource: string,
  action: string,
  success: boolean,
  metadata?: AuditMetadata
): Promise<void> {
  const fn = createSafeAudit(pool);
  await fn(userId, resource, action, success, metadata);
}
