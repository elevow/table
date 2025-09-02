import { v4 as uuidv4 } from 'uuid';
import { buildPayouts, validateTournamentConfig } from './tournament-utils';
import type {
  TournamentState,
  CreateTournamentInput,
  RegisterPlayerInput,
  EliminatePlayerInput,
  TournamentTable,
} from '../../types/tournament-management';

export class TournamentManager {
  private tournaments = new Map<string, TournamentState>();

  create(input: CreateTournamentInput): TournamentState {
    const res = validateTournamentConfig(input.config);
    if (!res.valid) throw new Error(`Invalid tournament config: ${res.errors.join(', ')}`);
    const id = uuidv4();
    const now = Date.now();
    const state: TournamentState = {
      id,
      name: input.name,
      config: input.config,
      status: 'setup',
      createdAt: now,
      updatedAt: now,
      registeredPlayers: [],
      eliminatedPlayers: [],
      tables: [],
      currentLevelIndex: 0,
      currentLevelStartedAt: null,
      onBreak: false,
      breakEndsAt: null,
    };
    this.tournaments.set(id, state);
    return state;
  }

  get(id: string): TournamentState | null {
    return this.tournaments.get(id) || null;
  }

  register(input: RegisterPlayerInput): TournamentState {
    const t = this.require(input.tournamentId);
    if (t.status !== 'setup' && t.status !== 'running') throw new Error('Registration closed');
    if (!t.registeredPlayers.includes(input.userId)) {
      t.registeredPlayers.push(input.userId);
      t.updatedAt = Date.now();
    }
    return t;
  }

  start(id: string): TournamentState {
    const t = this.require(id);
    if (t.status !== 'setup' && t.status !== 'paused') throw new Error('Cannot start in current status');
    t.status = 'running';
    t.currentLevelIndex = t.currentLevelIndex || 0;
    t.currentLevelStartedAt = Date.now();
    t.updatedAt = Date.now();
    if (t.tables.length === 0) {
      // naive single table start; table management can be expanded later
      const table: TournamentTable = { id: `tbl-${uuidv4()}`, players: [...t.registeredPlayers], maxSeats: 9 };
      t.tables = [table];
    }
    return t;
  }

  pause(id: string): TournamentState {
    const t = this.require(id);
    if (t.status !== 'running') throw new Error('Only running tournaments can be paused');
    t.status = 'paused';
    t.updatedAt = Date.now();
    return t;
  }

  resume(id: string): TournamentState {
    const t = this.require(id);
    if (t.status !== 'paused') throw new Error('Only paused tournaments can be resumed');
    t.status = 'running';
    t.updatedAt = Date.now();
    if (!t.currentLevelStartedAt) t.currentLevelStartedAt = Date.now();
    return t;
  }

  advanceLevel(id: string): TournamentState {
    const t = this.require(id);
    if (t.status !== 'running') throw new Error('Can only advance level while running');
    const prevLevelIndex = t.currentLevelIndex;
    let completed = false;
    if (t.currentLevelIndex + 1 >= t.config.blindLevels.length) {
      // No further levels; tournament completes
      t.status = 'completed';
      completed = true;
    } else {
      // Move to next level
      t.currentLevelIndex += 1;
      t.currentLevelStartedAt = Date.now();
    }
    t.updatedAt = Date.now();
    // Enter break if scheduled AFTER the level we just completed (prevLevelIndex)
    if (!completed) {
      const prevLevel = t.config.blindLevels[prevLevelIndex];
      const afterLevel = t.config.breaks.find(b => b.afterLevel === prevLevel.level);
      if (afterLevel) {
        t.onBreak = true;
        t.breakEndsAt = Date.now() + afterLevel.durationMinutes * 60_000;
        t.status = 'on-break';
        // Optionally mark that the next level hasn't effectively started yet
        // t.currentLevelStartedAt = null;
      }
    }
    return t;
  }

  endBreak(id: string): TournamentState {
    const t = this.require(id);
    if (!t.onBreak) return t;
    t.onBreak = false;
    t.breakEndsAt = null;
    if (t.status === 'on-break') t.status = 'running';
    t.updatedAt = Date.now();
    return t;
  }

  eliminate(input: EliminatePlayerInput): TournamentState {
    const t = this.require(input.tournamentId);
    if (!t.registeredPlayers.includes(input.userId)) throw new Error('Player not registered');
    if (!t.eliminatedPlayers.includes(input.userId)) {
      t.eliminatedPlayers.push(input.userId);
      t.updatedAt = Date.now();
    }
    // auto-complete when one remains
    const remaining = t.registeredPlayers.filter(p => !t.eliminatedPlayers.includes(p));
    if (t.status === 'running' && remaining.length <= 1) {
      t.status = 'completed';
    }
    return t;
  }

  payouts(id: string, prizePool: number) {
    const t = this.require(id);
    return buildPayouts(prizePool, t.config.payoutStructure);
  }

  private require(id: string): TournamentState {
    const t = this.tournaments.get(id);
    if (!t) throw new Error('Tournament not found');
    return t;
  }
}
