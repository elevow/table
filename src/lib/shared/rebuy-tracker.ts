export interface RebuyRecord {
  buyins: number;
  rebuys: number;
  lastBuyinAt: number;
}

const roomRebuyMap: Map<string, Map<string, RebuyRecord>> = new Map();

function getOrCreateRoomMap(roomId: string): Map<string, RebuyRecord> {
  let room = roomRebuyMap.get(roomId);
  if (!room) {
    room = new Map<string, RebuyRecord>();
    roomRebuyMap.set(roomId, room);
  }
  return room;
}

export function getPlayerRebuyInfo(roomId: string, playerId: string): RebuyRecord | undefined {
  return roomRebuyMap.get(roomId)?.get(playerId);
}

export function recordBuyin(roomId: string, playerId: string): RebuyRecord {
  const room = getOrCreateRoomMap(roomId);
  const existing = room.get(playerId);
  const now = Date.now();

  if (!existing) {
    const record: RebuyRecord = {
      buyins: 1,
      rebuys: 0,
      lastBuyinAt: now,
    };
    room.set(playerId, record);
    return record;
  }

  existing.buyins += 1;
  existing.rebuys += 1;
  existing.lastBuyinAt = now;
  return existing;
}

export function getRoomRebuySnapshot(roomId: string): Array<{
  playerId: string;
  buyins: number;
  rebuys: number;
  lastBuyinAt: number;
}> {
  const room = roomRebuyMap.get(roomId);
  if (!room) return [];
  return Array.from(room.entries()).map(([playerId, record]) => ({
    playerId,
    buyins: record.buyins,
    rebuys: record.rebuys,
    lastBuyinAt: record.lastBuyinAt,
  }));
}

export function clearRoomRebuys(roomId: string): void {
  roomRebuyMap.delete(roomId);
}

export function resetAllRebuyTracking(): void {
  roomRebuyMap.clear();
}
