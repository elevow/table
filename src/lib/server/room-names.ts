import type { Pool } from 'pg';

/**
 * Names of the given rooms, for labelling sessions and exported hands. Best effort: rooms that
 * were deleted, or ids that are not room ids at all, are simply left out.
 */
export async function fetchRoomNames(pool: Pool, roomIds: string[]): Promise<Record<string, string>> {
  const ids = Array.from(new Set(roomIds.filter(Boolean)));
  if (ids.length === 0) return {};
  try {
    const result = await pool.query('SELECT id::text AS id, name FROM game_rooms WHERE id::text = ANY($1::text[])', [ids]);
    const names: Record<string, string> = {};
    for (const row of result.rows) if (row?.id && row?.name) names[row.id] = String(row.name);
    return names;
  } catch {
    return {};
  }
}
