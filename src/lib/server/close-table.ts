import type { NextApiResponse } from 'next';
import type { TableState } from '../../types/poker';
import { getPool } from '../database/pool';
import * as GameSeats from '../shared/game-seats';
import { getOrRestoreEngine } from '../poker/engine-persistence';
import { leaveTable } from './seat-actions';

/**
 * Whether a hand is being played. Closing a table lets it finish: the table is deleted once it
 * is over, or straight away when no hand is under way.
 */
export function handInPlay(state: Pick<TableState, 'stage'> | null | undefined): boolean {
  return !!state && state.stage !== 'showdown' && state.stage !== 'awaiting-dealer-choice';
}

// Rows tied to the room that go with it. Hand records and the chip ledger stay: they belong to
// the players' history, and the ledger still settles the night after the table is gone
const DEPENDENT_TABLES = ['chat_messages', 'friend_game_invites', 'active_games'];

/**
 * Delete a closed table. Everyone still seated stands up first, so the chips in front of them are
 * recorded as cashed out and the night's settlement still adds up. Then the room and its game go,
 * and this server forgets them.
 */
export async function deleteClosedTable(roomId: string, res: NextApiResponse): Promise<void> {
  const seats = await GameSeats.loadPersistedRoomSeats(roomId) || GameSeats.getRoomSeats(roomId);
  const seated = Object.values(seats || {}).filter(a => !!a?.playerId).map(a => a!.playerId);
  for (const playerId of seated) {
    await leaveTable({ roomId, playerId, reason: 'table_closed', res });
  }

  const pool = getPool();
  for (const table of DEPENDENT_TABLES) {
    try {
      await pool.query(`DELETE FROM ${table} WHERE room_id::text = $1`, [roomId]);
    } catch (err: any) {
      // A table this database doesn't have holds nothing to delete
      // A fixed message, with the room id (which comes from the request) logged as data on one line
      if (err?.code !== '42P01') console.warn('[close-table] Could not clear a related table', { table, roomId: roomId.replace(/[\r\n]/g, '') }, err);
    }
  }
  await pool.query('DELETE FROM game_rooms WHERE id::text = $1', [roomId]);

  const g: any = global as any;
  g.activeGames?.delete?.(roomId);
  g.roomConfigs?.delete?.(roomId);
  GameSeats.getGameSeats().delete(roomId);
}

/** Delete the table now if no hand is being played; otherwise it goes once the hand is over. */
export async function deleteClosedTableIfIdle(roomId: string, res: NextApiResponse): Promise<boolean> {
  const engine = await getOrRestoreEngine(roomId).catch(() => null);
  if (handInPlay(engine?.getState())) return false;
  await deleteClosedTable(roomId, res);
  return true;
}
