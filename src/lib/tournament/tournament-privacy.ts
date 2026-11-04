// Private tournaments: hidden from the lobby and open only to the director, players who used the
// tournament's invite link (its members) or registered, and staff with table.view_private.
// Public is the default, so tournaments created before this existed stay public. The invite code
// uses the same format as private tables', and /join/<code> redeems either.
import type { UserAccess } from '../auth/access-control';
import { formatInviteCode } from '../shared/invite-code';
import type { TournamentState } from '../../types/tournament-management';

export const PRIVATE_TOURNAMENT_RESPONSE = {
  error: 'This tournament is private. Ask the director for an invite link.',
  code: 'PRIVATE_TOURNAMENT',
} as const;

type Access = Pick<UserAccess, 'userId' | 'permissions'> | null;

export function isPrivateTournament(t: Pick<TournamentState, 'visibility'>): boolean {
  return t.visibility === 'private';
}

function isInvited(t: TournamentState, userId: string): boolean {
  return t.createdBy === userId || (t.members ?? []).includes(userId) || t.registeredPlayers.includes(userId);
}

/** Whether the user may see the tournament: always for public ones. */
export function canSeeTournament(access: Access, t: TournamentState): boolean {
  if (!isPrivateTournament(t)) return true;
  const userId = access?.userId;
  if (!userId) return false;
  return isInvited(t, userId) || !!access?.permissions.has('table.view_private') || !!access?.permissions.has('tournament.manage_any');
}

/** Whether the user may register: in a private tournament only the invited, or staff with table.join_private. */
export function canRegisterForTournament(access: Access, t: TournamentState): boolean {
  if (!isPrivateTournament(t)) return true;
  const userId = access?.userId;
  if (!userId) return false;
  return isInvited(t, userId) || !!access?.permissions.has('table.join_private');
}

/** The invite code shown to the director, with its dash; null for public tournaments. */
export function directorInviteCode(t: TournamentState): string | null {
  return isPrivateTournament(t) && t.inviteCode ? formatInviteCode(t.inviteCode) : null;
}

/** The tournament without the invite code and member list, for anyone but the director. */
export function withoutTournamentInvite(t: TournamentState): TournamentState {
  const { inviteCode: _code, members: _members, ...rest } = t;
  return rest as TournamentState;
}
