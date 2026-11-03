import { TournamentManager } from './tournament-manager';
import { PgTournamentStore } from './pg-tournament-store';
import { tournamentEvents } from './tournament-events';
import { publishTournamentUpdate } from '../realtime/publisher';
import type { TournamentState } from '../../types/tournament-management';

/** Every saved change is broadcast on the tournament's channel, with what happened. */
function broadcastChange(before: TournamentState, after: TournamentState): void {
  publishTournamentUpdate(after.id, { status: after.status, events: tournamentEvents(before, after) })
    .catch(err => console.warn('[tournament] Could not broadcast the change:', err));
}

// Shared TournamentManager for the API handlers; tournaments live in Postgres
export const tournamentManager = new TournamentManager(new PgTournamentStore(), Math.random, Date.now, broadcastChange);
