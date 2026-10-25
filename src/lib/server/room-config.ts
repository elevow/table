import { getPool } from '../database/pool';

export interface SeatRequest {
  playerId: string;
  playerName: string;
  seatNumber: number;
  requestedAt: number;
}

export interface WaitlistEntry {
  playerId: string;
  playerName: string;
  joinedAt: number;
}

/** A seat held for the first player on the waitlist until expiresAt. */
export interface SeatOffer {
  playerId: string;
  seatNumber: number;
  expiresAt: number;
}

/** Table settings and queues kept in game_rooms.configuration, next to the seats. */
export interface TableExtrasConfig {
  requireSeatApproval?: boolean;
  allowStraddle?: boolean;
  seatRequests?: SeatRequest[];
  waitlist?: WaitlistEntry[];
  seatOffer?: SeatOffer | null;
}

/** How long a waitlisted player has to take a seat offered to them. */
export const SEAT_OFFER_MS = 60_000;

export async function loadRoom(roomId: string): Promise<{ createdBy: string | null; maxPlayers: number; configuration: Record<string, any> } | null> {
  const result = await getPool().query('SELECT created_by, max_players, configuration FROM game_rooms WHERE id = $1 LIMIT 1', [roomId]);
  const row = result.rows[0];
  if (!row) return null;
  const configuration = row.configuration && typeof row.configuration === 'object' ? row.configuration : {};
  return {
    createdBy: row.created_by ? String(row.created_by) : null,
    maxPlayers: Math.min(9, Math.max(2, Number(row.max_players) || 9)),
    configuration,
  };
}

/** Empty seat numbers within the room's size. */
export function freeSeatNumbers(seats: Record<number, unknown>, maxPlayers: number): number[] {
  const free: number[] = [];
  for (let n = 1; n <= maxPlayers; n++) if (!seats[n]) free.push(n);
  return free;
}

/** Merge fields into the room configuration. */
export async function updateRoomConfig(roomId: string, patch: Partial<TableExtrasConfig> & Record<string, unknown>): Promise<void> {
  await getPool().query(
    `UPDATE game_rooms SET configuration = COALESCE(configuration, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [roomId, JSON.stringify(patch)]
  );
}

/** Whether the caller is the room's host (its creator). */
export async function isRoomHost(roomId: string, userId: string): Promise<boolean> {
  const room = await loadRoom(roomId);
  return !!room?.createdBy && room.createdBy === userId;
}

/**
 * Move the waitlist along: a player who let their offer expire is dropped from the waitlist, and
 * a free seat is offered to whoever is next in line. Returns the updated values; the caller saves
 * them when `changed` is true.
 */
export function advanceSeatOffer(
  config: TableExtrasConfig,
  freeSeats: number[],
  now: number
): { waitlist: WaitlistEntry[]; seatOffer: SeatOffer | null; changed: boolean } {
  let waitlist = [...(config.waitlist || [])];
  let seatOffer = config.seatOffer || null;
  let changed = false;

  if (seatOffer && (now >= seatOffer.expiresAt || !freeSeats.includes(seatOffer.seatNumber))) {
    // Took too long (or the seat is gone): they leave the waitlist and the offer moves on
    if (now >= seatOffer.expiresAt) {
      const lapsed = seatOffer.playerId;
      waitlist = waitlist.filter(w => w.playerId !== lapsed);
    }
    seatOffer = null;
    changed = true;
  }
  if (!seatOffer && waitlist.length > 0 && freeSeats.length > 0) {
    seatOffer = { playerId: waitlist[0].playerId, seatNumber: freeSeats[0], expiresAt: now + SEAT_OFFER_MS };
    changed = true;
  }
  return { waitlist, seatOffer, changed };
}
