import { formatMoney, ordinal } from './format';
import type { TournamentEvent } from './tournament-events';

/**
 * What to tell a viewer about tournament events: their own moves, bust-out and win, and news
 * everyone cares about (the start, the money bubble, the end). Other players' busts aren't news.
 * `stillIn` is whether the viewer is registered and hasn't busted.
 */
export function noticesFor(events: TournamentEvent[], viewerId: string | null, stillIn: boolean): string[] {
  const notices: string[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'started':
        notices.push(stillIn ? 'The tournament has started. Go to your table.' : 'The tournament has started.');
        break;
      case 'moved':
        if (e.userId === viewerId) notices.push(`You're moving to table ${e.table}, seat ${e.seat}, after this hand.`);
        break;
      case 'eliminated':
        if (e.userId === viewerId) notices.push(`You finished ${ordinal(e.place)}${e.prize > 0 ? `, winning ${formatMoney(e.prize)}` : ''}.`);
        break;
      case 'in_the_money':
        notices.push(stillIn ? `You're in the money! The last ${e.paidPlaces} players are all paid.` : 'The money bubble has burst.');
        break;
      case 'finished':
        notices.push(e.winnerId && e.winnerId === viewerId ? 'You won the tournament!' : 'The tournament is over.');
        break;
      case 'cancelled':
        notices.push(`The tournament was cancelled${e.reason ? `: ${e.reason}` : '.'}`);
        break;
    }
  }
  return notices;
}
