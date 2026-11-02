import type { NextApiRequest, NextApiResponse } from 'next';
import { hasPermission, requirePermission } from '../auth/access-control';
import type { UserAccess } from '../auth/access-control';
import { tournamentManager } from './manager-instance';
import type { TournamentState } from '../../types/tournament-management';

/** Whoever created a tournament runs it; tournament.manage_any lets staff run anyone's. */
export function canRunTournament(access: Pick<UserAccess, 'userId' | 'permissions'>, t: TournamentState): boolean {
  return (!!t.createdBy && t.createdBy === access.userId) || hasPermission(access as UserAccess, 'tournament.manage_any');
}

/** Whether to offer the caller the director controls: they hold tournament.manage and run this one. */
export function canManageTournament(access: Pick<UserAccess, 'userId' | 'permissions'>, t: TournamentState): boolean {
  return hasPermission(access as UserAccess, 'tournament.manage') && canRunTournament(access, t);
}

/**
 * For organizer actions: the caller needs `permission` and must run this tournament.
 * Sends 401/403/400/404 and returns null when they can't act.
 */
export async function requireOrganizer(
  req: NextApiRequest,
  res: NextApiResponse,
  permission: string,
  tournamentId: unknown
): Promise<{ access: UserAccess & { userId: string }; tournament: TournamentState } | null> {
  const access = await requirePermission(req, res, permission);
  if (!access) return null;
  if (!tournamentId) {
    res.status(400).json({ error: 'Missing tournamentId' });
    return null;
  }
  const tournament = await tournamentManager.get(String(tournamentId));
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found' });
    return null;
  }
  if (!canRunTournament(access, tournament)) {
    res.status(403).json({ error: 'Only the tournament director can do this', code: 'NOT_ORGANIZER' });
    return null;
  }
  return { access, tournament };
}
