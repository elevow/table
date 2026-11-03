import { getPool } from '../database/pool';
import * as GameSeats from '../shared/game-seats';

/*
 * Tournament seats in game rooms. Each change is one statement against the room's saved seats,
 * rather than saving a copy of all of them, so two tables changing a room's seats at once can't
 * undo each other's change (a moved player vanishing, or a busted one coming back). A move
 * between tables changes both rooms in one transaction: the player is never left at both tables
 * or at neither.
 */

export type SeatAssignment = { playerId: string; playerName: string; chips: number };

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const SEATS = `CASE WHEN jsonb_typeof(configuration->'seats') = 'object' THEN configuration->'seats' ELSE '{}'::jsonb END`;

// The room's seats with every seat held by player $2 emptied
const WITHOUT_PLAYER = `(SELECT COALESCE(jsonb_object_agg(s.key, CASE WHEN s.value->>'playerId' = $2::text THEN 'null'::jsonb ELSE s.value END), '{}'::jsonb)
  FROM jsonb_each(${SEATS}) s)`;

const WITH_MEMBER = `CASE
  WHEN jsonb_typeof(configuration->'members') IS DISTINCT FROM 'array' THEN jsonb_build_array($2::text)
  WHEN configuration->'members' ? $2::text THEN configuration->'members'
  ELSE (configuration->'members') || to_jsonb($2::text)
END`;

async function leave(db: Queryable, roomId: string, userId: string): Promise<unknown> {
  const result = await db.query(
    `UPDATE game_rooms SET configuration = jsonb_set(COALESCE(configuration, '{}'::jsonb), '{seats}', ${WITHOUT_PLAYER}, true)
     WHERE id = $1 RETURNING configuration->'seats' AS seats`,
    [roomId, userId]
  );
  return result.rows[0]?.seats;
}

async function take(db: Queryable, roomId: string, seatNumber: number, seat: SeatAssignment): Promise<unknown> {
  const result = await db.query(
    `UPDATE game_rooms SET configuration = jsonb_set(
       jsonb_set(COALESCE(configuration, '{}'::jsonb), '{seats}', ${WITHOUT_PLAYER} || jsonb_build_object($3::text, $4::jsonb), true),
       '{members}', ${WITH_MEMBER}, true)
     WHERE id = $1 RETURNING configuration->'seats' AS seats`,
    [roomId, seat.playerId, String(seatNumber), JSON.stringify(seat)]
  );
  return result.rows[0]?.seats;
}

/** Keep this instance's copy of a room's seats in step with what was saved. */
function remember(roomId: string, seats: unknown): void {
  if (seats && typeof seats === 'object') GameSeats.setRoomSeats(roomId, GameSeats.normalizeRoomSeats(seats));
}

/** Sit a player in a room's seat (leaving any other seat they hold there) and make them a member. */
export async function takeSeat(roomId: string, seatNumber: number, seat: SeatAssignment): Promise<void> {
  remember(roomId, await take(getPool(), roomId, seatNumber, seat));
}

/** Empty every seat a player holds in a room. */
export async function leaveSeat(roomId: string, userId: string): Promise<void> {
  remember(roomId, await leave(getPool(), roomId, userId));
}

/** Move a player from one room to a seat in another, both or neither. */
export async function moveSeat(fromRoomId: string, toRoomId: string, seatNumber: number, seat: SeatAssignment): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Lock both rooms in the same order every time, so two moves the opposite way can't deadlock
    await client.query(`SELECT id FROM game_rooms WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, [[fromRoomId, toRoomId]]);
    const from = await leave(client, fromRoomId, seat.playerId);
    const to = await take(client, toRoomId, seatNumber, seat);
    if (to === undefined) throw new Error(`Room ${toRoomId} not found`);
    await client.query('COMMIT');
    remember(fromRoomId, from);
    remember(toRoomId, to);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
