import type { Broadcaster } from '../broadcaster';
import { publishSeatState, publishSeatVacated } from '../realtime/publisher';
import * as GameSeats from '../shared/game-seats';
import { recordBuyin } from '../shared/rebuy-tracker';
import { fetchRoomRebuyAmount } from '../shared/rebuy-limit';
import type { TableState } from '../../types/poker';

export async function autoStandPlayer(
  io: Broadcaster | null,
  tableId: string,
  playerId: string,
  reason: string = 'auto_stand'
): Promise<void> {
  try {
    const seats = GameSeats.getRoomSeats(tableId);
    const entry = Object.entries(seats).find(([, assignment]) => assignment?.playerId === playerId);
    if (!entry) return;
    const [seatStr] = entry;
    const seatNumber = parseInt(seatStr, 10);
    seats[seatNumber] = null;
    GameSeats.setRoomSeats(tableId, seats);
    const payload = { seatNumber, playerId, reason };
    io?.to(`table_${tableId}`).emit('seat_vacated', payload);
    await Promise.all([
      publishSeatVacated(tableId, payload),
      publishSeatState(tableId, { seats })
    ]);
  } catch (err) {
    console.warn('autoStandPlayer failed:', err);
  }
}

export async function applyRebuy(
  io: Broadcaster | null,
  emitGameStateUpdate: (io: Broadcaster, tableId: string, state: TableState, lastAction: Record<string, unknown>) => void,
  tableId: string,
  playerId: string,
  chipsOverride?: number
) {
  interface GameEngine {
    getState: () => TableState;
  }
  
  const globalWithGames = global as typeof globalThis & { activeGames?: Map<string, GameEngine> };
  const engine = globalWithGames.activeGames?.get(tableId);
  if (!engine || typeof engine.getState !== 'function') {
    throw new Error('No active game available for this table');
  }
  const state = engine.getState();
  if (!state || !Array.isArray(state.players)) {
    throw new Error('Table state unavailable');
  }
  const player = state.players.find((p: any) => p.id === playerId);
  if (!player) {
    throw new Error('Player not seated in the active game');
  }

  // Use override chips if provided, otherwise fetch from room configuration
  const chips = chipsOverride ?? await fetchRoomRebuyAmount(tableId);

  const trackerRecord = recordBuyin(tableId, playerId);

  player.stack = chips;
  player.currentBet = 0;
  player.isAllIn = false;
  player.isFolded = false;
  player.hasActed = false;

  const seats = GameSeats.getRoomSeats(tableId);
  for (const [seatStr, assignment] of Object.entries(seats)) {
    if (assignment?.playerId === playerId) {
      const seatNumber = parseInt(seatStr, 10);
      seats[seatNumber] = { ...assignment, chips };
      GameSeats.setRoomSeats(tableId, seats);
      const seatPayload = { seatNumber, playerId, playerName: assignment.playerName, chips };
      io?.to(`table_${tableId}`).emit('seat_stack_updated', seatPayload);
      try {
        await publishSeatState(tableId, { seats });
      } catch (err) {
        console.warn('Failed to publish seat_state after rebuy:', err);
      }
      break;
    }
  }

  if (io) {
    emitGameStateUpdate(io, tableId, state, { action: 'rebuy', playerId, amount: chips });
  }

  return { record: trackerRecord, chips };
}
