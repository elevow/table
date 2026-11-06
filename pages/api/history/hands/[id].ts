import { getPool } from '../../../../src/lib/database/pool';
import { getAuthenticatedUserId } from '../../../../src/lib/auth/auth-utils';
import { redactHandRecord, rowToHandRecord } from '../../../../src/lib/server/hand-records';
import { apiHandler } from '../../../../src/lib/api/handler';

/**
 * GET /api/history/hands/:id
 *
 * One hand for the replayer. Only players dealt into the hand can see it, with their own cards
 * and any cards shown at the table.
 */
export default apiHandler({ methods: 'GET' }, async (req, res) => {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid hand id' });

  try {
    const result = await getPool().query('SELECT * FROM hand_records WHERE id = $1', [id]);
    const row = result.rows[0];
    // Not found and not yours look the same, so hand ids can't be probed
    // A hand the player deleted from their results is gone for them too
    const hidden = Array.isArray(row?.hidden_for) && row.hidden_for.includes(userId);
    if (!row || !Array.isArray(row.player_ids) || !row.player_ids.includes(userId) || hidden) {
      return res.status(404).json({ error: 'Hand not found' });
    }
    return res.status(200).json({ hand: redactHandRecord(rowToHandRecord(row), userId) });
  } catch (err) {
    console.error('Error loading hand:', err);
    return res.status(500).json({ error: 'Unable to load hand' });
  }
});
