import { fetchRoomRebuyLimit } from '../shared/rebuy-limit';
import { getPlayerRebuyInfo } from '../shared/rebuy-tracker';

export type RebuyLimitValue = number | 'unlimited';

export interface PendingRebuyEntry {
  issuedAt: number;
  rebuysUsed: number;
  rebuyLimit: RebuyLimitValue;
}

const globalKey = '__pendingRebuyDecisions';
const globalObj = globalThis as typeof globalThis & {
  [globalKey]?: Map<string, Map<string, PendingRebuyEntry>>;
};

if (!globalObj[globalKey]) {
  globalObj[globalKey] = new Map<string, Map<string, PendingRebuyEntry>>();
}

const pendingRebuys = globalObj[globalKey]!;

const DEFAULT_BUYIN = Number(process.env.NEXT_PUBLIC_DEFAULT_BUYIN);
export const BASE_REBUY_CHIPS = Number.isFinite(DEFAULT_BUYIN) && DEFAULT_BUYIN > 0 ? DEFAULT_BUYIN : 20;

// Rebuy timeout in seconds for games with more than 2 players
const DEFAULT_REBUY_TIMEOUT = Number(process.env.NEXT_PUBLIC_REBUY_TIMEOUT_SECONDS);
export const REBUY_TIMEOUT_MS = Number.isFinite(DEFAULT_REBUY_TIMEOUT) && DEFAULT_REBUY_TIMEOUT > 0
  ? DEFAULT_REBUY_TIMEOUT * 1000
  : 20000; // Default: 20 seconds

export function getPendingRebuys(tableId: string): Map<string, PendingRebuyEntry> | undefined {
  return pendingRebuys.get(tableId);
}

export function setPendingRebuy(tableId: string, playerId: string, entry: PendingRebuyEntry): void {
  if (!pendingRebuys.has(tableId)) {
    pendingRebuys.set(tableId, new Map<string, PendingRebuyEntry>());
  }
  pendingRebuys.get(tableId)!.set(playerId, entry);
}

export function clearPendingRebuy(tableId: string, playerId: string): void {
  const tableMap = pendingRebuys.get(tableId);
  if (!tableMap) return;
  tableMap.delete(playerId);
  if (tableMap.size === 0) {
    pendingRebuys.delete(tableId);
  }
}

export function hasPendingRebuy(tableId: string, playerId: string): boolean {
  return pendingRebuys.get(tableId)?.has(playerId) ?? false;
}

export function pendingRebuyCount(tableId: string): number {
  return pendingRebuys.get(tableId)?.size ?? 0;
}

export async function getRebuyAvailability(tableId: string, playerId: string, limitOverride?: RebuyLimitValue) {
  const rebuyLimit = limitOverride ?? (await fetchRoomRebuyLimit(tableId));
  const record = getPlayerRebuyInfo(tableId, playerId);
  const rebuysUsed = record?.rebuys ?? 0;
  const numericLimit = rebuyLimit === 'unlimited' ? Number.POSITIVE_INFINITY : rebuyLimit;
  const canRebuy = rebuysUsed < numericLimit;
  const remaining = rebuyLimit === 'unlimited'
    ? 'unlimited'
    : Math.max(numericLimit - rebuysUsed, 0);
  return { rebuyLimit, rebuysUsed, canRebuy, remaining };
}

export function resetPendingRebuys(): void {
  pendingRebuys.clear();
}

/**
 * Check if a pending rebuy has expired based on player count
 * For 2-player games: never expires (returns false)
 * For >2 player games: expires after REBUY_TIMEOUT_MS
 */
export function isRebuyExpired(tableId: string, playerId: string, playerCount: number): boolean {
  // For 2-player games, wait indefinitely
  if (playerCount <= 2) {
    return false;
  }

  const entry = pendingRebuys.get(tableId)?.get(playerId);
  if (!entry) {
    return false;
  }

  const elapsed = Date.now() - entry.issuedAt;
  return elapsed >= REBUY_TIMEOUT_MS;
}

/**
 * Get all expired pending rebuys for a table (only for >2 player games)
 */
export function getExpiredRebuys(tableId: string, playerCount: number): string[] {
  if (playerCount <= 2) {
    return [];
  }

  const tableMap = pendingRebuys.get(tableId);
  if (!tableMap) {
    return [];
  }

  const now = Date.now();
  const expired: string[] = [];

  for (const [playerId, entry] of tableMap.entries()) {
    const elapsed = now - entry.issuedAt;
    if (elapsed >= REBUY_TIMEOUT_MS) {
      expired.push(playerId);
    }
  }

  return expired;
}
