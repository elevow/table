import { getPool } from '../../../../src/lib/database/pool';
import { requirePermission } from '../../../../src/lib/auth/access-control';
import { deleteSessions, type SessionSelection } from '../../../../src/lib/server/hidden-hands';
import { apiHandler } from '../../../../src/lib/api/handler';

/**
 * POST /api/stats/sessions/delete, with stats.delete_sessions:
 *   { roomId, start, end }  one session from /api/stats/profit (epoch ms)
 *   { all: true }           every session
 * Removes the hands from the signed-in player's own results, hand history and leaderboard
 * totals. Other players at the table keep them. Returns { hands, net } removed.
 */
export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 30, message: 'Too many requests' } }, async (req, res) => {
  const access = await requirePermission(req, res, 'stats.delete_sessions');
  if (!access) return;

  const body = req.body || {};
  let selection: SessionSelection;
  if (body.all === true) {
    selection = { all: true };
  } else {
    const start = Number(body.start);
    const end = Number(body.end);
    if (typeof body.roomId !== 'string' || !body.roomId || !Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return res.status(400).json({ error: 'Send { roomId, start, end } for one session, or { all: true }' });
    }
    selection = { roomId: body.roomId, start, end };
  }

  try {
    const removed = await deleteSessions(getPool(), access.userId, selection);
    return res.status(200).json(removed);
  } catch (err) {
    console.error('Error deleting sessions:', err);
    return res.status(500).json({ error: 'Unable to delete the sessions' });
  }
});
