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
