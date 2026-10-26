import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { getAuthenticatedUserId } from '../../../src/lib/auth/auth-utils';
import { fetchRoomNames } from '../../../src/lib/server/room-names';
import { buildProfitSeries, groupSessions, type ProfitHand } from '../../../src/lib/shared/profit-sessions';

// Most recent hands used for the graph and sessions
export const PROFIT_HAND_LIMIT = 5000;

/**
 * GET /api/stats/profit
 *
 * The signed-in player's results over time: a running total by hand and their sessions
 * (per table, split by breaks of more than two hours). Only their own net per hand is read.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  try {
    const pool = getPool();
    // Pull just this player's net out of the players list, so no one's cards leave the database
    const result = await pool.query(
      `SELECT id, room_id, started_at, ended_at,
         (SELECT (elem->>'net')::numeric FROM jsonb_array_elements(players) elem WHERE elem->>'id' = $1 LIMIT 1) AS net
       FROM hand_records
       WHERE player_ids @> ARRAY[$1]::text[]
       ORDER BY ended_at DESC
       LIMIT $2`,
      [userId, PROFIT_HAND_LIMIT]
    );
    const hands: ProfitHand[] = result.rows.map(row => ({
      handId: String(row.id),
      roomId: String(row.room_id),
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      endedAt: new Date(row.ended_at).toISOString(),
      net: Number(row.net) || 0,
    }));
    const series = buildProfitSeries(hands);
    const sessions = groupSessions(hands);
    const roomNames = await fetchRoomNames(pool, sessions.map(s => s.roomId));
    return res.status(200).json({
      series,
      sessions,
      roomNames,
      totals: { hands: hands.length, net: series.length ? series[series.length - 1].cumulative : 0 },
      truncated: hands.length === PROFIT_HAND_LIMIT,
    });
  } catch (err) {
    console.error('Error loading profit history:', err);
    return res.status(500).json({ error: 'Unable to load your results' });
  }
}
