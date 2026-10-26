import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { getAuthenticatedUserId } from '../../../src/lib/auth/auth-utils';
import { redactHandRecord, rowToHandRecord } from '../../../src/lib/server/hand-records';
import { fetchRoomNames } from '../../../src/lib/server/room-names';
import { formatPokerStarsHands } from '../../../src/lib/shared/pokerstars-export';

export const EXPORT_HAND_LIMIT = 1000;

const isTime = (v: unknown): v is string => typeof v === 'string' && !!v && !Number.isNaN(Date.parse(v));

/**
 * GET /api/history/export?handId=          one hand
 * GET /api/history/export?roomId=&from=&to= many hands (newest 1000 that match)
 *
 * Hands the signed-in player was dealt into, as a PokerStars-format .txt download. Each hand is
 * redacted for the viewer first, so only their own cards and cards shown at the table appear.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const handId = typeof req.query.handId === 'string' ? req.query.handId : '';
  const roomId = typeof req.query.roomId === 'string' && req.query.roomId ? req.query.roomId : null;
  if (handId && !/^[0-9a-f-]{36}$/i.test(handId)) return res.status(400).json({ error: 'Invalid hand id' });
  if ((req.query.from && !isTime(req.query.from)) || (req.query.to && !isTime(req.query.to))) {
    return res.status(400).json({ error: 'Invalid date' });
  }

  try {
    const pool = getPool();
    const params: unknown[] = [userId];
    let where = 'player_ids @> ARRAY[$1]::text[]';
    if (handId) {
      params.push(handId);
      where += ` AND id = $${params.length}`;
    } else {
      if (roomId) {
        params.push(roomId);
        where += ` AND room_id = $${params.length}`;
      }
      if (isTime(req.query.from)) {
        params.push(req.query.from);
        where += ` AND ended_at >= $${params.length}`;
      }
      if (isTime(req.query.to)) {
        params.push(req.query.to);
        where += ` AND ended_at <= $${params.length}`;
      }
    }
    params.push(handId ? 1 : EXPORT_HAND_LIMIT);
    const result = await pool.query(
      `SELECT * FROM hand_records WHERE ${where} ORDER BY ended_at DESC LIMIT $${params.length}`,
      params
    );
    // Not found and not yours look the same, so hand ids can't be probed
    if (handId && result.rows.length === 0) return res.status(404).json({ error: 'Hand not found' });

    const hands = result.rows.map(row => redactHandRecord(rowToHandRecord(row), userId));
    const roomNames = await fetchRoomNames(pool, hands.map(h => h.roomId));
    const text = formatPokerStarsHands(hands, h => ({ viewerId: userId, tableName: roomNames[h.roomId] }));
    const name = handId
      ? `hand-${hands[0].handNumber}-${handId.slice(0, 8)}`
      : `hands-${roomId ? roomId.replace(/[^\w-]/g, '').slice(0, 24) + '-' : ''}${new Date().toISOString().slice(0, 10)}`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.txt"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(text);
  } catch (err) {
    console.error('Error exporting hands:', err);
    return res.status(500).json({ error: 'Unable to export hands' });
  }
}
