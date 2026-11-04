/** Where an invite code leads, from /api/games/rooms/join's reply: the table or the tournament. */
export function inviteDestination(joined: { roomId?: string; tournamentId?: string }): string | null {
  if (joined?.tournamentId) return `/tournaments/${joined.tournamentId}`;
  if (joined?.roomId) return `/game/${joined.roomId}`;
  return null;
}
