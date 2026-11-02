import { v4 as uuidv4 } from 'uuid';
import { validateTournamentConfig } from './tournament-utils';
import { bountyEnabled, collectWinnerBounty, forfeitBounty, payoutTable, postBounty, prizePool, remainingPlayers, settleKnockout } from './tournament-money';
import type { TournamentStore } from './tournament-store';
import { DEFAULT_SEATS_PER_TABLE, Random, balanceTables, drawSeats, seatLatePlayer, unseatPlayer } from './tournament-seating';
import { catchUpClock, endBreak, enterNextLevel, pauseClock, resumeClock, scheduleElapsedMs, startClock, stopClock } from './tournament-clock';
import type {
  TournamentState,
  CreateTournamentInput,
  RegisterPlayerInput,
  EliminatePlayerInput,
} from '../../types/tournament-management';
import type { TournamentConfig } from '../../types/tournament';

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

  /** Tournaments in any of `statuses` as of now, newest first. */
  async list(statuses: TournamentState['status'][], limit = 50): Promise<TournamentState[]> {
    const now = this.now();
    return (await this.store.list(statuses, limit)).map(t => {
      catchUpClock(t, now);
      finishIfDecided(t);
      return t;
    });
  }

  register(input: RegisterPlayerInput): Promise<TournamentState> {
    return this.change(input.tournamentId, (t, now) => {
      if (t.registeredPlayers.includes(input.userId)) return;
      if (!registrationOpen(t, now)) throw new Error(t.status === 'setup' ? 'Registration closed' : 'Late registration has closed');
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

  /** Withdraw before the start; the entry, and any bounty with it, is taken back. */
  unregister(input: RegisterPlayerInput): Promise<TournamentState> {
    return this.change(input.tournamentId, t => {
      if (!t.registeredPlayers.includes(input.userId)) return;
      if (t.status !== 'setup') throw new Error('You can only unregister before the tournament starts');
      withdraw(t, input.userId);
    });
  }

  /**
   * The director takes a player out: before the start it's as if they never registered; during play
   * they're eliminated with nobody credited, and in a knockout their bounty is forfeited.
   */
  removePlayer(input: RegisterPlayerInput): Promise<TournamentState> {
    return this.change(input.tournamentId, (t, now) => {
      if (!t.registeredPlayers.includes(input.userId)) throw new Error('Player not registered');
      if (t.status === 'setup') return withdraw(t, input.userId);
      this.knockOut(t, now, input.userId, undefined, true);
    }, { undoable: true });
  }

  /** Change the name or structure before the start. Bounties follow the new settings. */
  edit(input: { tournamentId: string; name?: string; config?: TournamentConfig }): Promise<TournamentState> {
    return this.change(input.tournamentId, t => {
      if (t.status !== 'setup') throw new Error('A tournament can only be edited before it starts');
      if (input.name !== undefined) {
        if (!input.name.trim()) throw new Error('Give the tournament a name');
        t.name = input.name.trim();
      }
      if (input.config) {
        const res = validateTournamentConfig(input.config);
        if (!res.valid) throw new Error(`Invalid tournament config: ${res.errors.join(', ')}`);
        if (input.config.maxPlayers && t.registeredPlayers.length > input.config.maxPlayers) {
          throw new Error(`${t.registeredPlayers.length} players have already registered, more than the new maximum`);
        }
        const config = input.config;
        t.config = config;
        t.bounties = bountyEnabled(config)
          ? Object.fromEntries(t.registeredPlayers.map(u => [u, config.bounty!.amount]))
          : undefined;
      }
    });
  }

  /** Call the tournament off. Nothing is paid out; what each player paid in shows as owed to them. */
  cancel(input: { tournamentId: string; reason?: string }): Promise<TournamentState> {
    return this.change(input.tournamentId, (t, now) => {
      if (t.status === 'completed' || t.status === 'cancelled') throw new Error('This tournament has already finished');
      t.status = 'cancelled';
      stopClock(t);
      t.cancelledAt = now;
      t.cancelReason = input.reason?.trim() || null;
    });
  }

  /**
   * Take back the most recent elimination, as long as nothing else has happened since: the player,
   * their seat and their bounty are restored exactly, even if it had ended the tournament.
   */
  undoElimination(tournamentId: string): Promise<TournamentState> {
    return this.change(tournamentId, t => {
      const before = t.lastElimination?.before;
      if (!before) throw new Error('Only the most recent elimination can be undone, before anything else changes');
      for (const key of Object.keys(t)) delete (t as any)[key];
      Object.assign(t, before);
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
      this.knockOut(t, now, input.userId, input.eliminatedBy || undefined, false);
    }, { undoable: true });
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
      const refused = whyNoRebuy(t, input.userId);
      if (refused) throw new Error(refused);
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
      const refused = whyNoAddOn(t, input.userId);
      if (refused) throw new Error(refused);
      (t.registrationTimeline = t.registrationTimeline || []).push({ at: now, type: 'addOn', userId: input.userId });
    });
  }

  /**
   * Take a player out of the field. `removed` is the director removing them: no knocker is needed,
   * and in a knockout their bounty is forfeited rather than paid.
   */
  private knockOut(t: TournamentState, now: number, userId: string, by: string | undefined, removed: boolean): void {
    if (t.status !== 'running' && t.status !== 'paused' && t.status !== 'on-break') {
      throw new Error('Players can only be eliminated while the tournament is in progress');
    }
    if (!t.registeredPlayers.includes(userId)) throw new Error('Player not registered');
    if (t.eliminatedPlayers.includes(userId)) {
      if (removed) throw new Error('That player is already out');
      return;
    }
    const remaining = remainingPlayers(t);
    if (remaining.length <= 1) throw new Error('Cannot eliminate the last remaining player');
    if (by !== undefined) {
      if (by === userId) throw new Error('A player cannot knock themselves out');
      if (!remaining.includes(by)) throw new Error('The player who made the knockout must still be in the tournament');
    } else if (bountyEnabled(t.config) && !removed) {
      throw new Error('Say who knocked the player out, so the bounty can be paid');
    }
    // Finishing place is the number of players left, counting the one going out
    t.eliminatedPlayers.push(userId);
    const bounty = by !== undefined ? settleKnockout(t, userId, by) : 0;
    const forfeited = removed ? forfeitBounty(t, userId) : 0;
    (t.eliminationRecords = t.eliminationRecords || []).push({
      userId,
      at: now,
      place: remaining.length,
      ...(by !== undefined ? { eliminatedBy: by } : {}),
      ...(bountyEnabled(t.config) && !removed ? { bounty } : {}),
      ...(removed ? { removed: true } : {}),
      ...(forfeited > 0 ? { forfeitedBounty: forfeited } : {}),
    });
    unseatPlayer(t.tables, userId);
    this.balance(t);
    finishIfDecided(t);
  }

  /**
   * Apply a change to the tournament as of now, after catching its clock up. An `undoable` change
   * that takes a player out keeps a copy of the tournament from just before it, which the next
   * change throws away.
   */
  private change(
    id: string,
    apply: (t: TournamentState, now: number) => void,
    options: { undoable?: boolean } = {}
  ): Promise<TournamentState> {
    return this.store.update(id, t => {
      const now = this.now();
      catchUpClock(t, now);
      // The rebuy period may have just closed with one player left
      finishIfDecided(t);
      const { lastElimination: _previous, ...current } = t;
      const before: TournamentState = JSON.parse(JSON.stringify(current));
      apply(t, now);
      if (options.undoable && t.eliminatedPlayers.length > before.eliminatedPlayers.length) {
        t.lastElimination = { before };
      } else {
        delete t.lastElimination;
      }
      t.updatedAt = now;
    });
  }

  /** Balance and break tables after the field changed, logging who moved where. */
  private balance(t: TournamentState): void {
    const { tables, moves } = balanceTables(t.tables, seatsPerTable(t), this.random);
    t.tables = tables;
    if (moves.length > 0) (t.tableMoves = t.tableMoves || []).push(...moves);
  }
}

function seatsPerTable(t: TournamentState): number {
  return t.config.seatsPerTable ?? DEFAULT_SEATS_PER_TABLE;
}

/**
 * Whether new players can join: any time before the start, then while late registration lasts,
 * which is through the end of its last level and the break right after it, and no longer than
 * its time limit of tournament time played.
 */
export function registrationOpen(t: TournamentState, now: number): boolean {
  if (t.status === 'setup') return true;
  if (t.status !== 'running' && t.status !== 'paused' && t.status !== 'on-break') return false;
  const late = t.config.lateRegistration;
  if (!late?.enabled) return false;
  if (currentLevelNumber(t) > late.endLevel) return false;
  return !(late.endTime > 0 && scheduleElapsedMs(t, now) > late.endTime * 60_000);
}

/** The level being played, or on a break the level just finished. */
function currentLevelNumber(t: TournamentState): number {
  return t.onBreak && t.currentBreakAfterLevel != null
    ? t.currentBreakAfterLevel
    : t.config.blindLevels[t.currentLevelIndex]?.level ?? 0;
}

/** Why a player can't rebuy right now, or null when they can. */
export function whyNoRebuy(t: TournamentState, userId: string): string | null {
  const cfg = t.config.rebuys;
  if (!cfg?.enabled) return 'Rebuys are not enabled';
  if (!t.registeredPlayers.includes(userId)) return 'Player not registered';
  if (t.status !== 'running' && t.status !== 'on-break') return 'Rebuys only allowed during running or break';
  if (!rebuyPeriodOpen(t)) return 'Rebuy period ended';
  // 0 or unset means unlimited
  const prior = (t.registrationTimeline || []).filter(e => e.type === 'rebuy' && e.userId === userId).length;
  if (cfg.maxPerPlayer && prior >= cfg.maxPerPlayer) return 'Rebuy limit reached';
  return null;
}

/** Why a player can't take the add-on right now, or null when they can: once, at the chosen break, while still in. */
export function whyNoAddOn(t: TournamentState, userId: string): string | null {
  const cfg = t.config.addOn;
  if (!cfg?.enabled) return 'Add-on is not enabled';
  if (!t.registeredPlayers.includes(userId)) return 'Player not registered';
  if (t.eliminatedPlayers.includes(userId)) return "Busted players can't take the add-on";
  if (!t.onBreak || t.status !== 'on-break') return 'Add-on only available during the specified break';
  if (cfg.availableAtBreakAfterLevel === undefined || cfg.availableAtBreakAfterLevel === null) return 'Add-on break level not specified';
  if (currentLevelNumber(t) !== cfg.availableAtBreakAfterLevel) return 'Add-on not available at this break';
  if ((t.registrationTimeline || []).some(e => e.type === 'addOn' && e.userId === userId)) return 'Add-on already taken';
  return null;
}

/**
 * Whether players can still rebuy: through the end of the last rebuy level and the break right
 * after it. With no last level set, rebuys stay open for the whole tournament.
 */
export function rebuyPeriodOpen(t: TournamentState): boolean {
  const cfg = t.config.rebuys;
  if (!cfg?.enabled) return false;
  if (cfg.availableUntilLevel === undefined || cfg.availableUntilLevel === null) return true;
  return currentLevelNumber(t) <= cfg.availableUntilLevel;
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

/** Take a player's entry back, before the start: as if they never registered. */
function withdraw(t: TournamentState, userId: string): void {
  t.registeredPlayers = t.registeredPlayers.filter(p => p !== userId);
  t.registrationTimeline = (t.registrationTimeline || []).filter(e => !(e.type === 'register' && e.userId === userId));
  if (t.bounties) delete t.bounties[userId];
}
