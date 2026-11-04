import type { NextApiRequest, NextApiResponse } from 'next';
import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { requireOrganizer } from '../../../src/lib/tournament/require-organizer';
import { directorInviteCode } from '../../../src/lib/tournament/tournament-privacy';

/**
 * POST /api/tournaments/privacy, for the director:
 *   { tournamentId, action: 'set-visibility', visibility: 'public' | 'private' }
 *   { tournamentId, action: 'new-invite-code' }: the old link stops working
 * Returns { visibility, inviteCode } (the code with its dash, null when public).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  const { tournamentId, action, visibility } = req.body || {};
  const organizer = await requireOrganizer(req, res, 'tournament.manage', tournamentId);
  if (!organizer) return;
  try {
    let t;
    if (action === 'set-visibility') {
      if (visibility !== 'public' && visibility !== 'private') {
        return res.status(400).json({ error: 'visibility must be public or private' });
      }
      t = await tournamentManager.setVisibility(organizer.tournament.id, visibility);
    } else if (action === 'new-invite-code') {
      t = await tournamentManager.replaceInviteCode(organizer.tournament.id);
    } else {
      return res.status(400).json({ error: 'action must be set-visibility or new-invite-code' });
    }
    return res.status(200).json({ visibility: t.visibility ?? 'public', inviteCode: directorInviteCode(t) });
  } catch (err) {
    return sendTournamentError(res, err);
  }
}
