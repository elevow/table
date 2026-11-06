import { getPool } from '../../../src/lib/database/pool';
import { logAdminAction, requirePermission } from '../../../src/lib/auth/access-control';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { apiHandler } from '../../../src/lib/api/handler';

/**
 * Players taken off the leaderboard, with admin.leaderboard. Hiding only affects the leaderboard:
 * the player's own results, history and stats are unchanged, and they can be put back.
 *   GET                         the hidden players
 *   POST { userId, hidden }     hide or restore one
 */
export default apiHandler({ methods: ['GET', 'POST'] }, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  const actor = await requirePermission(req, res, 'admin.leaderboard');
  if (!actor) return;
  const pool = getPool();

  try {
    if (req.method === 'GET') {
      const { rows } = await pool.query(
        `SELECT ps.user_id, u.username, ps.hands_played
         FROM player_statistics ps LEFT JOIN users u ON u.id = ps.user_id
         WHERE ps.leaderboard_hidden
         ORDER BY u.username NULLS LAST`
      );
      return res.status(200).json({
        hidden: rows.map(r => ({ userId: String(r.user_id), username: r.username ?? null, handsPlayed: Number(r.hands_played) || 0 })),
      });
    }

    const { userId, hidden } = req.body || {};
    if (typeof userId !== 'string' || !userId || typeof hidden !== 'boolean') {
      return res.status(400).json({ error: 'Send { userId, hidden: true | false }' });
    }
    const { rowCount } = await pool.query(
      `UPDATE player_statistics SET leaderboard_hidden = $2 WHERE user_id::text = $1`,
      [userId, hidden]
    );
    if (!rowCount) return res.status(404).json({ error: 'That player has no statistics' });
    await logAdminAction(actor.userId, hidden ? 'leaderboard.hide' : 'leaderboard.restore', 'user', userId);
    return res.status(200).json({ userId, hidden });
  } catch (err) {
    console.error('Error changing the leaderboard:', err);
    return res.status(500).json({ error: 'Unable to change the leaderboard' });
  }
});
