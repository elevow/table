import { rateLimit } from '../../../src/lib/api/rate-limit';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';
import { getPool } from '../../../src/lib/database/pool';
import { DEFAULT_DISPLAY_SETTINGS, pickDisplaySettings } from '../../../src/lib/shared/display-settings';
import { apiHandler } from '../../../src/lib/api/handler';

/**
 * GET /api/profile/preferences -> { display }
 * PUT /api/profile/preferences { display: { highContrastCards?, showPotOdds?, showStackInBB?, showHandValue? } } -> { display }
 *
 * The signed-in user's table display settings, which every table starts from. A PUT changes only
 * the settings it sends.
 */
export default apiHandler({ methods: ['GET', 'PUT'] }, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  const userId = await requirePlayer(req, res);
  if (!userId) return;

  try {
    const pool = getPool();
    let saved: unknown;
    if (req.method === 'PUT') {
      const changes = pickDisplaySettings(req.body?.display);
      if (Object.keys(changes).length === 0) return res.status(400).json({ error: 'No display settings to save' });
      const result = await pool.query(
        `INSERT INTO user_preferences (user_id, preferences) VALUES ($1, jsonb_build_object('display', $2::jsonb))
         ON CONFLICT (user_id) DO UPDATE SET
           preferences = jsonb_set(user_preferences.preferences, '{display}',
             COALESCE(user_preferences.preferences->'display', '{}'::jsonb) || $2::jsonb, true),
           updated_at = NOW()
         RETURNING preferences->'display' AS display`,
        [userId, JSON.stringify(changes)]
      );
      saved = result.rows[0]?.display;
    } else {
      const result = await pool.query(`SELECT preferences->'display' AS display FROM user_preferences WHERE user_id = $1`, [userId]);
      saved = result.rows[0]?.display;
    }
    return res.status(200).json({ display: { ...DEFAULT_DISPLAY_SETTINGS, ...pickDisplaySettings(saved) } });
  } catch (err) {
    console.error('Error with display preferences:', err);
    return res.status(500).json({ error: 'Unable to load your settings' });
  }
});
