import { getSessionUser } from '../../../../src/lib/auth/auth-utils';
import { addRoomMember, findRoomByInviteCode, normalizeInviteCode } from '../../../../src/lib/server/room-privacy';
import { tournamentManager } from '../../../../src/lib/tournament/manager-instance';
import { apiHandler } from '../../../../src/lib/api/handler';

/**
 * POST /api/games/rooms/join { code }
 *
 * Redeem a private table's or tournament's invite code (from its link, or typed on the dashboard):
 * the signed-in user becomes a member and may watch, chat and sit at the table, or see and register
 * for the tournament, from then on. Returns { roomId } or { tournamentId } to open.
 * 404 when the code doesn't open anything, including a link the host has since replaced.
 */
export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 20, message: 'Too many attempts. Try again in a minute.' } }, async (req, res) => {
  // Low, since every request is a guess at a code

  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to join this table', code: 'SIGN_IN_REQUIRED' });

  const code = normalizeInviteCode(req.body?.code);
  if (!code) return res.status(404).json({ error: 'That invite code isn\'t valid', code: 'INVITE_NOT_FOUND' });

  try {
    const room = await findRoomByInviteCode(code);
    if (room) {
      await addRoomMember(room.id, user.id);
      return res.status(200).json({ roomId: room.id, name: room.name });
    }
    // Private tournaments' invite codes look the same, so one link format and join box serve both
    const tournament = await tournamentManager.findByInviteCode(code);
    if (tournament) {
      await tournamentManager.addMember(tournament.id, user.id);
      return res.status(200).json({ tournamentId: tournament.id, name: tournament.name });
    }
    return res.status(404).json({ error: 'That invite link has expired or isn\'t valid. Ask the host for a new one.', code: 'INVITE_NOT_FOUND' });
  } catch (err) {
    console.error('Error joining by invite code:', err);
    return res.status(500).json({ error: 'Unable to join the table' });
  }
});
