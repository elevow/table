/**
 * Shared locking mechanism to prevent concurrent next-hand starts.
 * Used by both next-hand and rebuy-decision endpoints to avoid race conditions.
 */

const NEXT_HAND_LOCK_KEY = '__NEXT_HAND_LOCKS__';

function getNextHandLocks(): Set<string> {
  const g = globalThis as any;
  if (!g[NEXT_HAND_LOCK_KEY]) {
    g[NEXT_HAND_LOCK_KEY] = new Set<string>();
  }
  return g[NEXT_HAND_LOCK_KEY] as Set<string>;
}

/**
 * Attempt to acquire a lock for starting the next hand.
 * Returns true if lock was acquired, false if already locked.
 */
export function acquireNextHandLock(tableId: string): boolean {
  const locks = getNextHandLocks();
  if (locks.has(tableId)) {
    return false;
  }
  locks.add(tableId);
  return true;
}

/**
 * Release the next-hand lock for a table.
 */
export function releaseNextHandLock(tableId: string): void {
  getNextHandLocks().delete(tableId);
}

/**
 * Check if a table currently has a next-hand lock.
 */
export function hasNextHandLock(tableId: string): boolean {
  return getNextHandLocks().has(tableId);
}
