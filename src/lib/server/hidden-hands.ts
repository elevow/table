// Players can delete sessions from their own results (permission stats.delete_sessions). A hand
// is shared by everyone at the table, so deleting only hides it from that player: their id goes
// into the hand's hidden_for, and their lifetime statistics lose the hand's result. Everyone
// else's history, the table's ledger and other players' HUD stats are unchanged.
import type { Pool } from 'pg';

/** SQL for "hands $1 played and hasn't deleted", for queries where $1 is the player's id. */
export const PLAYER_HANDS_SQL = `player_ids @> ARRAY[$1]::text[] AND NOT (hidden_for @> ARRAY[$1]::text[])`;

export type SessionSelection =
  | { all: true }
  // A session from /api/stats/profit: its table, and epoch ms of its first hand's start and last hand's end
  | { roomId: string; start: number; end: number };

// The session's hands ended between its start and end; a second either side covers rounding
const EDGE_MS = 1000;

/**
 * Hide the selected hands from the player and take them out of their lifetime statistics.
 * Returns how many hands were removed and their net result for the player.
 */
export async function deleteSessions(pool: Pool, userId: string, selection: SessionSelection): Promise<{ hands: number; net: number }> {
  const params: unknown[] = [userId];
  let where = PLAYER_HANDS_SQL;
  if (!('all' in selection)) {
    params.push(selection.roomId, new Date(selection.start - EDGE_MS).toISOString(), new Date(selection.end + EDGE_MS).toISOString());
    where += ' AND room_id = $2 AND ended_at >= $3 AND ended_at <= $4';
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Hide them, and add up what they were worth to this player, in one statement so a hand
    // can't be counted twice by two deletes at once
    const hidden = await client.query(
      `WITH hidden AS (
         UPDATE hand_records SET hidden_for = array_append(hidden_for, $1::text)
         WHERE ${where}
         RETURNING players
       )
       SELECT COUNT(*)::int AS hands,
              COALESCE(SUM(me.net), 0) AS net,
              COUNT(*) FILTER (WHERE me.won > 0)::int AS won
       FROM hidden
       LEFT JOIN LATERAL (
         SELECT (elem->>'net')::numeric AS net, COALESCE((elem->>'won')::numeric, 0) AS won
         FROM jsonb_array_elements(hidden.players) elem WHERE elem->>'id' = $1 LIMIT 1
       ) me ON TRUE`,
      params
    );
    const hands = Number(hidden.rows[0]?.hands) || 0;
    const net = Number(hidden.rows[0]?.net) || 0;
    const won = Number(hidden.rows[0]?.won) || 0;
    if (hands > 0) {
      await client.query(
        `UPDATE player_statistics
         SET hands_played = GREATEST(0, hands_played - $2),
             hands_won = GREATEST(0, hands_won - $3),
             total_profit = total_profit - $4,
             last_updated = NOW()
         WHERE user_id = $1`,
        [userId, hands, won, net]
      );
    }
    await client.query('COMMIT');
    return { hands, net: Math.round(net * 100) / 100 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
