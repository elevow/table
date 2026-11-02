import { TournamentManager } from './tournament-manager';
import { PgTournamentStore } from './pg-tournament-store';

// Shared TournamentManager for the API handlers; tournaments live in Postgres
export const tournamentManager = new TournamentManager(new PgTournamentStore());
