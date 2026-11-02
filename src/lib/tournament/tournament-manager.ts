import { v4 as uuidv4 } from 'uuid';
import { buildPayouts, validateTournamentConfig } from './tournament-utils';
import type { TournamentStore } from './tournament-store';
import type {
  TournamentState,
  CreateTournamentInput,
  RegisterPlayerInput,
  EliminatePlayerInput,
  TournamentTable,
} from '../../types/tournament-management';

export class TournamentManager {
  constructor(private store: TournamentStore) {}

  async create(input: CreateTournamentInput): Promise<TournamentState> {
    const res = validateTournamentConfig(input.config);
    if (!res.valid) throw new Error(`Invalid tournament config: ${res.errors.join(', ')}`);
    const id = uuidv4();
    const now = Date.now();
    const state: TournamentState = {
      id,
      name: input.name,
      config: input.config,
      status: 'setup',
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
      registeredPlayers: [],
      eliminatedPlayers: [],
      tables: [],
      currentLevelIndex: 0,
      currentLevelStartedAt: null,
      onBreak: false,
      breakEndsAt: null,
      registrationTimeline: [],
      eliminationRecords: [],
    };
    await this.store.insert(state);
    return state;
  }

  get(id: string): Promise<TournamentState | null> {
    return this.store.get(id);
  }

  register(input: RegisterPlayerInput): Promise<TournamentState> {
    return this.store.update(input.tournamentId, t => {
      if (t.status !== 'setup' && t.status !== 'running') throw new Error('Registration closed');
      if (!t.registeredPlayers.includes(input.userId)) {
        t.registeredPlayers.push(input.userId);
        t.updatedAt = Date.now();
        // Log timeline event for reporting
        (t.registrationTimeline = t.registrationTimeline || []).push({ at: Date.now(), type: 'register', userId: input.userId });
      }
    });
  }

  start(id: string): Promise<TournamentState> {
    return this.store.update(id, t => {
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
    });
  }

  pause(id: string): Promise<TournamentState> {
    return this.store.update(id, t => {
      if (t.status !== 'running') throw new Error('Only running tournaments can be paused');
      t.status = 'paused';
      t.updatedAt = Date.now();
    });
  }

  resume(id: string): Promise<TournamentState> {
    return this.store.update(id, t => {
      if (t.status !== 'paused') throw new Error('Only paused tournaments can be resumed');
      t.status = 'running';
      t.updatedAt = Date.now();
      if (!t.currentLevelStartedAt) t.currentLevelStartedAt = Date.now();
    });
  }

  advanceLevel(id: string): Promise<TournamentState> {
    return this.store.update(id, t => {
      if (t.status !== 'running') throw new Error('Can only advance level while running');
      const prevLevelIndex = t.currentLevelIndex;
      if (t.currentLevelIndex + 1 >= t.config.blindLevels.length) {
        // No further levels; tournament completes
        t.status = 'completed';
        t.updatedAt = Date.now();
        return;
      }
      // Move to next level
      t.currentLevelIndex += 1;
      t.currentLevelStartedAt = Date.now();
      t.updatedAt = Date.now();
      // Enter break if scheduled AFTER the level we just completed (prevLevelIndex)
      const prevLevel = t.config.blindLevels[prevLevelIndex];
      const afterLevel = t.config.breaks.find(b => b.afterLevel === prevLevel.level);
      if (afterLevel) {
        t.onBreak = true;
        t.breakEndsAt = Date.now() + afterLevel.durationMinutes * 60_000;
        t.status = 'on-break';
        t.currentBreakAfterLevel = prevLevel.level;
      }
    });
  }

  endBreak(id: string): Promise<TournamentState> {
    return this.store.update(id, t => {
      if (!t.onBreak) return;
      t.onBreak = false;
      t.breakEndsAt = null;
      t.currentBreakAfterLevel = null;
      if (t.status === 'on-break') t.status = 'running';
      t.updatedAt = Date.now();
    });
  }

  eliminate(input: EliminatePlayerInput): Promise<TournamentState> {
    return this.store.update(input.tournamentId, t => {
      if (t.status !== 'running' && t.status !== 'paused' && t.status !== 'on-break') {
        throw new Error('Players can only be eliminated while the tournament is in progress');
      }
      if (!t.registeredPlayers.includes(input.userId)) throw new Error('Player not registered');
      if (t.eliminatedPlayers.includes(input.userId)) return;
      const remaining = t.registeredPlayers.filter(p => !t.eliminatedPlayers.includes(p));
      if (remaining.length <= 1) throw new Error('Cannot eliminate the last remaining player');
      // Finishing place is the number of players left, counting the one going out
      t.eliminatedPlayers.push(input.userId);
      (t.eliminationRecords = t.eliminationRecords || []).push({ userId: input.userId, at: Date.now(), place: remaining.length });
      t.updatedAt = Date.now();
      // The tournament is over once one player remains, whether running, paused or on a break
      if (remaining.length - 1 <= 1) {
        t.status = 'completed';
        t.onBreak = false;
        t.breakEndsAt = null;
        t.currentBreakAfterLevel = null;
      }
    });
  }

  async payouts(id: string, prizePool: number) {
    const t = await this.store.get(id);
    if (!t) throw new Error('Tournament not found');
    return buildPayouts(prizePool, t.config.payoutStructure);
  }

  // --- Rebuy/Add-on operations ---
  rebuy(input: { tournamentId: string; userId: string }): Promise<TournamentState> {
    return this.store.update(input.tournamentId, t => {
      const cfg = t.config.rebuys;
      if (!cfg?.enabled) throw new Error('Rebuys are not enabled');
      if (!t.registeredPlayers.includes(input.userId)) throw new Error('Player not registered');
      if (t.status !== 'running' && t.status !== 'on-break') throw new Error('Rebuys only allowed during running or break');
      // Check level window
      const levelNumber = t.config.blindLevels[t.currentLevelIndex]?.level ?? 0;
      if (cfg.availableUntilLevel !== undefined && levelNumber > cfg.availableUntilLevel) {
        throw new Error('Rebuy period ended');
      }
      // Enforce per-player limit using timeline count; 0 or unset means unlimited
      const prior = (t.registrationTimeline || []).filter(e => e.type === 'rebuy' && e.userId === input.userId).length;
      if (cfg.maxPerPlayer && prior >= cfg.maxPerPlayer) {
        throw new Error('Rebuy limit reached');
      }
      (t.registrationTimeline = t.registrationTimeline || []).push({ at: Date.now(), type: 'rebuy', userId: input.userId });
      t.updatedAt = Date.now();
    });
  }

  addOn(input: { tournamentId: string; userId: string }): Promise<TournamentState> {
    return this.store.update(input.tournamentId, t => {
      const cfg = t.config.addOn;
      if (!cfg?.enabled) throw new Error('Add-on is not enabled');
      if (!t.registeredPlayers.includes(input.userId)) throw new Error('Player not registered');
      // Only at the designated break
      if (!t.onBreak || t.status !== 'on-break') throw new Error('Add-on only available during the specified break');
      const targetLevel = cfg.availableAtBreakAfterLevel;
      if (targetLevel === undefined || targetLevel === null) throw new Error('Add-on break level not specified');
      // Determine which break we are currently on
      const currentBreakAfterLevel = t.currentBreakAfterLevel ?? this.computeCurrentBreakAfterLevel(t);
      if (currentBreakAfterLevel !== targetLevel) throw new Error('Add-on not available at this break');
      // Only one add-on per player; check timeline
      const prior = (t.registrationTimeline || []).some(e => e.type === 'addOn' && e.userId === input.userId);
      if (prior) throw new Error('Add-on already taken');
      (t.registrationTimeline = t.registrationTimeline || []).push({ at: Date.now(), type: 'addOn', userId: input.userId });
      t.updatedAt = Date.now();
    });
  }

  private computeCurrentBreakAfterLevel(t: TournamentState): number | null {
    if (!t.onBreak) return null;
    // Based on when we set the break: it is scheduled after the previously completed level
    // We stored currentLevelIndex as the next level index; find previous level number
    const prevIdx = Math.max(0, t.currentLevelIndex - 1);
    return t.config.blindLevels[prevIdx]?.level ?? null;
  }
}
