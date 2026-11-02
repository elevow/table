import { v4 as uuidv4 } from 'uuid';
import { validateTournamentConfig } from './tournament-utils';
import { bountyEnabled, collectWinnerBounty, payoutTable, postBounty, prizePool, remainingPlayers, settleKnockout } from './tournament-money';
import type { TournamentStore } from './tournament-store';
import { DEFAULT_SEATS_PER_TABLE, Random, balanceTables, drawSeats, seatLatePlayer, unseatPlayer } from './tournament-seating';
import { catchUpClock, endBreak, enterNextLevel, pauseClock, resumeClock, startClock, stopClock } from './tournament-clock';
import type {
  TournamentState,
  CreateTournamentInput,
  RegisterPlayerInput,
  EliminatePlayerInput,
} from '../../types/tournament-management';

export class TournamentManager {
  constructor(
    private store: TournamentStore,
    private random: Random = Math.random,
    private now: () => number = Date.now
  ) {}

  async create(input: CreateTournamentInput): Promise<TournamentState> {
    const res = validateTournamentConfig(input.config);
    if (!res.valid) throw new Error(`Invalid tournament config: ${res.errors.join(', ')}`);
    const id = uuidv4();
    const now = this.now();
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

  /** The tournament as of now: levels whose time ran out have moved on, even if nothing was saved since. */
  async get(id: string): Promise<TournamentState | null> {
    const t = await this.store.get(id);
    if (t) {
      catchUpClock(t, this.now());
      finishIfDecided(t);
    }
    return t;
  }

  register(input: RegisterPlayerInput): Promise<TournamentState> {
    return this.change(input.tournamentId, (t, now) => {
      if (t.status !== 'setup' && t.status !== 'running') throw new Error('Registration closed');
      if (t.registeredPlayers.includes(input.userId)) return;
      if (t.config.maxPlayers && t.registeredPlayers.length >= t.config.maxPlayers) throw new Error('Tournament is full');
      t.registeredPlayers.push(input.userId);
      postBounty(t, input.userId);
      // Log timeline event for reporting
      (t.registrationTimeline = t.registrationTimeline || []).push({ at: now, type: 'register', userId: input.userId });
      // Late registrants take a seat straight away; a new table may need balancing
      if (t.tables.length > 0) {
        seatLatePlayer(t.tables, input.userId, seatsPerTable(t), this.random);
        this.balance(t);
      }
    });
  }

  start(id: string): Promise<TournamentState> {
    return this.change(id, (t, now) => {
      if (t.status !== 'setup') throw new Error(t.status === 'paused' ? 'Tournament is paused; resume it instead' : 'Tournament has already started');
      if (t.registeredPlayers.length < 2) throw new Error('At least 2 players are needed to start');
      startClock(t, now);
      t.tables = drawSeats(t.registeredPlayers, seatsPerTable(t), this.random);
    });
  }

  pause(id: string): Promise<TournamentState> {
    return this.change(id, (t, now) => pauseClock(t, now));
  }

  resume(id: string): Promise<TournamentState> {
    return this.change(id, (t, now) => resumeClock(t, now));
  }

  /** Move to the next level now, ahead of the clock. */
  advanceLevel(id: string): Promise<TournamentState> {
    return this.change(id, (t, now) => {
      if (t.status !== 'running') throw new Error('Can only advance level while running');
      enterNextLevel(t, now);
    });
  }

  /** End the break now, ahead of the clock. */
  endBreak(id: string): Promise<TournamentState> {
    return this.change(id, (t, now) => {
      if (t.onBreak) endBreak(t, now);
    });
  }

  eliminate(input: EliminatePlayerInput): Promise<TournamentState> {
    return this.change(input.tournamentId, (t, now) => {
      if (t.status !== 'running' && t.status !== 'paused' && t.status !== 'on-break') {
        throw new Error('Players can only be eliminated while the tournament is in progress');
      }
      if (!t.registeredPlayers.includes(input.userId)) throw new Error('Player not registered');
      if (t.eliminatedPlayers.includes(input.userId)) return;
      const remaining = remainingPlayers(t);
      if (remaining.length <= 1) throw new Error('Cannot eliminate the last remaining player');
      const by = input.eliminatedBy || undefined;
      if (by !== undefined) {
        if (by === input.userId) throw new Error('A player cannot knock themselves out');
        if (!remaining.includes(by)) throw new Error('The player who made the knockout must still be in the tournament');
      } else if (bountyEnabled(t.config)) {
        throw new Error('Say who knocked the player out, so the bounty can be paid');
      }
      // Finishing place is the number of players left, counting the one going out
      t.eliminatedPlayers.push(input.userId);
      const bounty = by !== undefined ? settleKnockout(t, input.userId, by) : 0;
      (t.eliminationRecords = t.eliminationRecords || []).push({
        userId: input.userId,
        at: now,
        place: remaining.length,
        ...(by !== undefined ? { eliminatedBy: by } : {}),
        ...(bountyEnabled(t.config) ? { bounty } : {}),
      });
      unseatPlayer(t.tables, input.userId);
      this.balance(t);
      finishIfDecided(t);
    });
  }

  /** The prize pool so far and what each paid place wins from it. */
  async payouts(id: string) {
    const t = await this.get(id);
    if (!t) throw new Error('Tournament not found');
    return { prizePool: prizePool(t), payouts: payoutTable(t) };
  }

  // --- Rebuy/Add-on operations ---
  rebuy(input: { tournamentId: string; userId: string }): Promise<TournamentState> {
    return this.change(input.tournamentId, (t, now) => {
      const cfg = t.config.rebuys;
      if (!cfg?.enabled) throw new Error('Rebuys are not enabled');
      if (!t.registeredPlayers.includes(input.userId)) throw new Error('Player not registered');
      if (t.status !== 'running' && t.status !== 'on-break') throw new Error('Rebuys only allowed during running or break');
      if (!rebuyPeriodOpen(t)) throw new Error('Rebuy period ended');
      // Enforce per-player limit using timeline count; 0 or unset means unlimited
      const prior = (t.registrationTimeline || []).filter(e => e.type === 'rebuy' && e.userId === input.userId).length;
      if (cfg.maxPerPlayer && prior >= cfg.maxPerPlayer) {
        throw new Error('Rebuy limit reached');
      }
      (t.registrationTimeline = t.registrationTimeline || []).push({ at: now, type: 'rebuy', userId: input.userId });
      // Each rebuy buys a bounty too: a fresh one for a returning player, added to the bounty of one still in
      postBounty(t, input.userId);
      // A busted player buys back in: back in the field, with their elimination undone and a new seat
      if (t.eliminatedPlayers.includes(input.userId)) {
        t.eliminatedPlayers = t.eliminatedPlayers.filter(p => p !== input.userId);
        const records = t.eliminationRecords || [];
        const last = records.map(r => r.userId).lastIndexOf(input.userId);
        if (last >= 0) t.eliminationRecords = records.filter((_, i) => i !== last);
        seatLatePlayer(t.tables, input.userId, seatsPerTable(t), this.random);
        this.balance(t);
      }
    });
  }

  addOn(input: { tournamentId: string; userId: string }): Promise<TournamentState> {
    return this.change(input.tournamentId, (t, now) => {
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
      (t.registrationTimeline = t.registrationTimeline || []).push({ at: now, type: 'addOn', userId: input.userId });
    });
  }

  /** Apply a change to the tournament as of now, after catching its clock up. */
  private change(id: string, apply: (t: TournamentState, now: number) => void): Promise<TournamentState> {
    return this.store.update(id, t => {
      const now = this.now();
      catchUpClock(t, now);
      // The rebuy period may have just closed with one player left
      finishIfDecided(t);
      apply(t, now);
      t.updatedAt = now;
    });
  }

  /** Balance and break tables after the field changed, logging who moved where. */
  private balance(t: TournamentState): void {
    const { tables, moves } = balanceTables(t.tables, seatsPerTable(t), this.random);
    t.tables = tables;
    if (moves.length > 0) (t.tableMoves = t.tableMoves || []).push(...moves);
  }

  private computeCurrentBreakAfterLevel(t: TournamentState): number | null {
    if (!t.onBreak) return null;
    // Based on when we set the break: it is scheduled after the previously completed level
    // We stored currentLevelIndex as the next level index; find previous level number
    const prevIdx = Math.max(0, t.currentLevelIndex - 1);
    return t.config.blindLevels[prevIdx]?.level ?? null;
  }
}

function seatsPerTable(t: TournamentState): number {
  return t.config.seatsPerTable ?? DEFAULT_SEATS_PER_TABLE;
}

/**
 * Whether players can still rebuy: through the end of the last rebuy level and the break right
 * after it. With no last level set, rebuys stay open for the whole tournament.
 */
export function rebuyPeriodOpen(t: TournamentState): boolean {
  const cfg = t.config.rebuys;
  if (!cfg?.enabled) return false;
  if (cfg.availableUntilLevel === undefined || cfg.availableUntilLevel === null) return true;
  // On a break, the level that counts is the one just finished
  const level = t.onBreak && t.currentBreakAfterLevel != null
    ? t.currentBreakAfterLevel
    : t.config.blindLevels[t.currentLevelIndex]?.level ?? 0;
  return level <= cfg.availableUntilLevel;
}

/**
 * End the tournament once one player is left, unless the rebuy period is still open: a player who
 * busted can still buy back in, so the result isn't settled until it closes.
 */
function finishIfDecided(t: TournamentState): void {
  if (t.status !== 'running' && t.status !== 'paused' && t.status !== 'on-break') return;
  const remaining = remainingPlayers(t);
  if (remaining.length > 1 || rebuyPeriodOpen(t)) return;
  t.status = 'completed';
  stopClock(t);
  if (remaining.length === 1) collectWinnerBounty(t, remaining[0]);
}
