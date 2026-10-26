import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { getAuthenticatedUserId } from '../../../src/lib/auth/auth-utils';
import { computeHudStats, type HudStats } from '../../../src/lib/shared/hud-stats';

// Recent shared hands per player: enough for stable numbers, small enough to stay quick
export const HUD_HAND_LIMIT = 500;
const MAX_SUBJECTS = 12;

/**
 * GET /api/stats/hud?subjects=id1,id2
 *
 * HUD numbers (VPIP, PFR, 3-bet, aggression) for other players, from the hands the signed-in
 * player was dealt into with each of them. Only the action lists are read, never cards, and a
 * player you never shared a hand with comes back with an empty sample.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const raw = typeof req.query.subjects === 'string' ? req.query.subjects : '';
  const subjects = Array.from(new Set(raw.split(',').map(s => s.trim()).filter(s => s && s.length <= 100))).slice(0, MAX_SUBJECTS);
  if (subjects.length === 0) return res.status(200).json({ stats: {} });

  try {
    // One round trip: the latest shared hands for each subject
    const result = await getPool().query(
      `SELECT s.subject, h.actions, h.variant, h.kind
       FROM unnest($2::text[]) AS s(subject)
       CROSS JOIN LATERAL (
         SELECT actions, variant, kind FROM hand_records
         WHERE player_ids @> ARRAY[$1, s.subject]::text[]
         ORDER BY ended_at DESC
         LIMIT $3
       ) h`,
      [userId, subjects, HUD_HAND_LIMIT]
    );
    const bySubject = new Map<string, Array<{ actions: any; variant: string | null; kind: string | null }>>();
    for (const row of result.rows) {
      const actions = typeof row.actions === 'string' ? safeParse(row.actions) : row.actions;
      const list = bySubject.get(row.subject) || [];
      list.push({ actions: Array.isArray(actions) ? actions : [], variant: row.variant, kind: row.kind });
      bySubject.set(row.subject, list);
    }
    const stats: Record<string, HudStats> = {};
    for (const id of subjects) stats[id] = computeHudStats(bySubject.get(id) || [], id);
    return res.status(200).json({ stats });
  } catch (err) {
    console.error('Error computing HUD stats:', err);
    return res.status(500).json({ error: 'Unable to load player stats' });
  }
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return []; }
}
