import { getPool } from '../database/pool';
import { GameService } from '../services/game-service';

const BUYIN_CACHE_TTL_MS = 60 * 1000;
const buyinCache: Map<string, { buyIn: number; fetchedAt: number }> = new Map();

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
    console.warn('[buyin-amount] Unable to initialize GameService:', (err as any)?.message || err);
    return null;
  }
}

export function normalizeBuyIn(value: any): number {
  if (typeof value === 'number' && value > 0) {
    return value;
  }
  // Default to 1000 if not specified
  return 1000;
}

export function primeRoomBuyIn(roomId: string, buyIn: number): void {
  buyinCache.set(roomId, { buyIn, fetchedAt: Date.now() });
}

export function clearRoomBuyIn(roomId: string): void {
  buyinCache.delete(roomId);
}

// For testing purposes
export function resetServiceCache(): void {
  cachedService = null;
  lastServiceInitFailedAt = null;
}

export async function fetchRoomBuyIn(roomId: string): Promise<number> {
  const cached = buyinCache.get(roomId);
  if (cached && Date.now() - cached.fetchedAt < BUYIN_CACHE_TTL_MS) {
    return cached.buyIn;
  }

  let buyIn: number = 1000;

  const service = getGameService();
  if (service) {
    try {
      const room = await service.getRoomById(roomId);
      const rawBuyIn = (room?.configuration as any)?.buyIn;
      buyIn = normalizeBuyIn(rawBuyIn);
    } catch (err) {
      console.warn(`[buyin-amount] Failed to fetch room ${roomId} configuration:`, (err as any)?.message || err);
    }
  }

  buyinCache.set(roomId, { buyIn, fetchedAt: Date.now() });
  return buyIn;
}
