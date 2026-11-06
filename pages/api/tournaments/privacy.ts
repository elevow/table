import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { requireOrganizer } from '../../../src/lib/tournament/require-organizer';
import { directorInviteCode } from '../../../src/lib/tournament/tournament-privacy';
import { apiHandler } from '../../../src/lib/api/handler';

/**
 * POST /api/tournaments/privacy, for the director:
 *   { tournamentId, action: 'set-visibility', visibility: 'public' | 'private' }
 *   { tournamentId, action: 'new-invite-code' }: the old link stops working
 * Returns { visibility, inviteCode } (the code with its dash, null when public).
 */
export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 30, message: 'Too many requests' } }, async (req, res) => {
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
});
