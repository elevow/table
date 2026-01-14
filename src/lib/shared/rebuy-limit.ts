import { getPool } from '../database/pool';
import { GameService } from '../services/game-service';
import { BASE_REBUY_CHIPS } from '../server/rebuy-state';

export type RebuyLimit = number | 'unlimited';

const LIMIT_CACHE_TTL_MS = 60 * 1000;
const limitCache: Map<string, { limit: RebuyLimit; fetchedAt: number }> = new Map();
const amountCache: Map<string, { amount: number; fetchedAt: number }> = new Map();

let cachedService: GameService | null = null;
let lastServiceInitFailedAt: number | null = null;

function getGameService(): GameService | null {
  if (cachedService) return cachedService;
  if (lastServiceInitFailedAt) {
    const elapsed = Date.now() - lastServiceInitFailedAt;
    if (elapsed < 30_000) {
      return null;
    }
    lastServiceInitFailedAt = null;
  }
  try {
    const pool = getPool();
    cachedService = new GameService(pool as any);
    return cachedService;
  } catch (err) {
    lastServiceInitFailedAt = Date.now();
    console.warn('[rebuy-limit] Unable to initialize GameService:', (err as any)?.message || err);
    return null;
  }
}

export function normalizeRebuyLimit(value: any): RebuyLimit {
  if (typeof value === 'number' && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.toLowerCase() === 'unlimited') {
    return 'unlimited';
  }
  return 'unlimited';
}

export function primeRoomRebuyLimit(roomId: string, limit: RebuyLimit): void {
  limitCache.set(roomId, { limit, fetchedAt: Date.now() });
}

export function clearRoomRebuyLimit(roomId: string): void {
  limitCache.delete(roomId);
  amountCache.delete(roomId);
}

export async function fetchRoomRebuyLimit(roomId: string): Promise<RebuyLimit> {
  const cached = limitCache.get(roomId);
  if (cached && Date.now() - cached.fetchedAt < LIMIT_CACHE_TTL_MS) {
    return cached.limit;
  }

  let limit: RebuyLimit = 'unlimited';

  const service = getGameService();
  if (service) {
    try {
      const room = await service.getRoomById(roomId);
      const rawLimit = (room?.configuration as any)?.numberOfRebuys;
      limit = normalizeRebuyLimit(rawLimit);
    } catch (err) {
      console.warn(`[rebuy-limit] Failed to fetch room ${roomId} configuration:`, (err as any)?.message || err);
    }
  }

  limitCache.set(roomId, { limit, fetchedAt: Date.now() });
  return limit;
}

export async function fetchRoomRebuyAmount(roomId: string): Promise<number> {
  const cached = amountCache.get(roomId);
  if (cached && Date.now() - cached.fetchedAt < LIMIT_CACHE_TTL_MS) {
    return cached.amount;
  }

  let amount = BASE_REBUY_CHIPS; // Use shared default

  const service = getGameService();
  if (service) {
    try {
      const room = await service.getRoomById(roomId);
      const configAmount = room?.configuration?.rebuyAmount;
      if (typeof configAmount === 'number' && configAmount > 0) {
        amount = configAmount;
      }
    } catch (err) {
      console.warn(`[rebuy-limit] Failed to fetch room ${roomId} rebuy amount:`, (err as any)?.message || err);
    }
  }

  amountCache.set(roomId, { amount, fetchedAt: Date.now() });
  return amount;
}
