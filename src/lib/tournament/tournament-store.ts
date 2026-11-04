import type { TournamentState } from '../../types/tournament-management';

/**
 * Where tournaments live. `update` runs `apply` against the current state with no other update
 * to the same tournament in between, saves the result and returns it; if `apply` throws, nothing
 * is saved and the error reaches the caller.
 */
export interface TournamentStore {
  insert(state: TournamentState): Promise<void>;
  get(id: string): Promise<TournamentState | null>;
  update(id: string, apply: (t: TournamentState) => void): Promise<TournamentState>;
  /** Tournaments in any of `statuses`, newest first. */
  list(statuses: TournamentState['status'][], limit: number): Promise<TournamentState[]>;
  /** The private tournament an invite code (without its dash) opens, if any. */
  findByInviteCode(code: string): Promise<TournamentState | null>;
}

/** Tournaments in process memory, for tests. Hands out copies so callers can't change stored state. */
export class MemoryTournamentStore implements TournamentStore {
  private tournaments = new Map<string, TournamentState>();

  async insert(state: TournamentState): Promise<void> {
    this.tournaments.set(state.id, copy(state));
  }

  async get(id: string): Promise<TournamentState | null> {
    const t = this.tournaments.get(id);
    return t ? copy(t) : null;
  }

  async update(id: string, apply: (t: TournamentState) => void): Promise<TournamentState> {
    const current = this.tournaments.get(id);
    if (!current) throw new Error('Tournament not found');
    const next = copy(current);
    apply(next);
    this.tournaments.set(id, next);
    return copy(next);
  }

  async list(statuses: TournamentState['status'][], limit: number): Promise<TournamentState[]> {
    return [...this.tournaments.values()]
      .filter(t => statuses.includes(t.status))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(copy);
  }

  async findByInviteCode(code: string): Promise<TournamentState | null> {
    const t = [...this.tournaments.values()].find(x => x.visibility === 'private' && x.inviteCode === code);
    return t ? copy(t) : null;
  }
}

// Round-trips through JSON like the JSONB column does, so tests see what Postgres would return
function copy(state: TournamentState): TournamentState {
  return JSON.parse(JSON.stringify(state));
}
