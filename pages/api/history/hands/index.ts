import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../../src/lib/database/pool';
import { getAuthenticatedUserId } from '../../../../src/lib/auth/auth-utils';
import { rowToHandRecord, summarizeHand } from '../../../../src/lib/server/hand-records';

/**
 * GET /api/history/hands?roomId=&limit=&before=
 *
 * Hands the signed-in player was dealt into, newest first, optionally for one table.
 * `before` (ISO time) pages back through older hands.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const roomId = typeof req.query.roomId === 'string' && req.query.roomId ? req.query.roomId : null;
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 25));
  const before = typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : null;

  try {
    const params: unknown[] = [userId, limit];
    let where = 'player_ids @> ARRAY[$1]::text[]';
    if (roomId) {
      params.push(roomId);
      where += ` AND room_id = $${params.length}`;
    }
    if (before) {
      params.push(before);
      where += ` AND ended_at < $${params.length}`;
    }
    const result = await getPool().query(
      `SELECT * FROM hand_records WHERE ${where} ORDER BY ended_at DESC LIMIT $2`,
      params
    );
    const hands = result.rows.map(row => summarizeHand(rowToHandRecord(row), userId));
    return res.status(200).json({ hands, nextBefore: hands.length === limit ? hands[hands.length - 1].endedAt : null });
  } catch (err) {
    console.error('Error listing hands:', err);
    return res.status(500).json({ error: 'Unable to load hand history' });
  }
}
