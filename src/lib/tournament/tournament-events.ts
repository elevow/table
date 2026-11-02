import { payoutTable, remainingPlayers } from './tournament-money';
import type { TournamentState } from '../../types/tournament-management';

/** What happened in a change to a tournament, for live updates and notifications. */
export type TournamentEvent =
  | { type: 'started' }
  | { type: 'moved'; userId: string; table: number; seat: number }
  | { type: 'eliminated'; userId: string; place: number; prize: number }
  | { type: 'in_the_money'; paidPlaces: number }
  | { type: 'finished'; winnerId: string | null }
  | { type: 'cancelled'; reason: string | null };

const IN_PLAY = new Set(['running', 'paused', 'on-break']);

/** The events between two versions of a tournament, in the order they matter to players. */
export function tournamentEvents(before: TournamentState, after: TournamentState): TournamentEvent[] {
  const events: TournamentEvent[] = [];
  if (before.status === 'setup' && IN_PLAY.has(after.status)) events.push({ type: 'started' });

  const payouts = payoutTable(after);
  const prizeFor = (place: number) => payouts.find(p => p.place === place)?.amount ?? 0;
  const seen = new Set((before.eliminationRecords || []).map(r => `${r.userId}:${r.at}`));
  for (const r of after.eliminationRecords || []) {
    if (!seen.has(`${r.userId}:${r.at}`)) events.push({ type: 'eliminated', userId: r.userId, place: r.place, prize: prizeFor(r.place) });
  }

  for (const move of (after.tableMoves || []).slice((before.tableMoves || []).length)) {
    const table = after.tables.find(tb => tb.id === move.toTableId);
    if (table && table.seats.includes(move.userId)) events.push({ type: 'moved', userId: move.userId, table: table.number, seat: move.seat });
  }

  const paid = payouts.length;
  const leftBefore = remainingPlayers(before).length;
  const leftAfter = remainingPlayers(after).length;
  if (IN_PLAY.has(after.status) && leftBefore > paid && leftAfter <= paid && leftAfter > 1) events.push({ type: 'in_the_money', paidPlaces: paid });

  if (before.status !== 'completed' && after.status === 'completed') {
    const left = remainingPlayers(after);
    events.push({ type: 'finished', winnerId: left.length === 1 ? left[0] : null });
  }
  if (before.status !== 'cancelled' && after.status === 'cancelled') events.push({ type: 'cancelled', reason: after.cancelReason ?? null });
  return events;
}
