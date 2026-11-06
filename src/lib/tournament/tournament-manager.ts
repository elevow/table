import { randomUUID } from 'crypto';
import { validateTournamentConfig } from './tournament-utils';
import { bountyEnabled, collectWinnerBounty, forfeitBounty, payoutTable, postBounty, prizePool, remainingPlayers, settleKnockout } from './tournament-money';
import type { TournamentStore } from './tournament-store';
import { DEFAULT_SEATS_PER_TABLE, Random, balanceTables, drawSeats, seatLatePlayer, seatedPlayers, unseatPlayer } from './tournament-seating';
import { catchUpClock, endBreak, enterNextLevel, pauseClock, resumeClock, scheduleElapsedMs, startClock, stopClock } from './tournament-clock';
import type {
  TournamentState,
  CreateTournamentInput,
  RegisterPlayerInput,
  EliminatePlayerInput,
} from '../../types/tournament-management';
import type { TournamentConfig } from '../../types/tournament';
import { newInviteCode } from '../shared/invite-code';
import { isPrivateTournament } from './tournament-privacy';

export class TournamentManager {
  /**
   * `onChange` hears about every saved change, with the tournament before and after it (used to
   * push live updates). It must not throw; it isn't awaited.
   */
  constructor(
    private store: TournamentStore,
    private random: Random = Math.random,
    private now: () => number = Date.now,
    private onChange?: (before: TournamentState, after: TournamentState) => void
  ) {}

  async create(input: CreateTournamentInput): Promise<TournamentState> {
    const res = validateTournamentConfig(input.config);
    if (!res.valid) throw new Error(`Invalid tournament config: ${res.errors.join(', ')}`);
    if (input.config.startsAt !== undefined && input.config.startsAt < this.now() - 60_000) throw new Error('The start time has already passed');
    const id = randomUUID();
    const now = this.now();
    const state: TournamentState = {
      id,
      name: input.name,
      config: input.config,
      status: 'setup',
      createdBy: input.createdBy ?? null,
      ...(input.visibility === 'private' ? { visibility: 'private' as const, inviteCode: newInviteCode(), members: [] } : {}),
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
        addPendingChips(t, input.userId, t.config.startingStack);
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
      // Who's invited isn't part of the elimination: keep anyone who joined or a new link since
      const { visibility, inviteCode, members } = t;
      for (const key of Object.keys(t)) delete (t as any)[key];
      Object.assign(t, before, { visibility, inviteCode, members });
      for (const key of ['visibility', 'inviteCode', 'members'] as const) if (t[key] === undefined) delete t[key];
    });
  }

  /** The private tournament an invite code opens, if any. */
  findByInviteCode(code: string): Promise<TournamentState | null> {
    return this.store.findByInviteCode(code);
  }

  /*
   * Who's invited changes outside play, so these save without going through `change`: they don't
   * throw away the director's undo or tell the tables anything happened.
   */

  /** Someone redeemed the invite link: they may see the tournament and register from now on. */
  addMember(tournamentId: string, userId: string): Promise<TournamentState> {
    return this.store.update(tournamentId, t => {
      if (!isPrivateTournament(t)) return;
      const members = t.members ?? [];
      if (!members.includes(userId)) t.members = [...members, userId];
    });
  }

  /** Make the tournament private (with a fresh invite link if it has none) or public again. */
  setVisibility(tournamentId: string, visibility: 'public' | 'private'): Promise<TournamentState> {
    return this.store.update(tournamentId, t => {
      if (t.status === 'completed' || t.status === 'cancelled') throw new Error('This tournament has already finished');
      if (visibility === 'private') {
        t.visibility = 'private';
        t.inviteCode = t.inviteCode || newInviteCode();
        t.members = t.members ?? [];
      } else {
        delete t.visibility;
      }
      t.updatedAt = this.now();
    });
  }

  /** Replace the invite link; the old one stops working, but everyone who used it stays invited. */
  replaceInviteCode(tournamentId: string): Promise<TournamentState> {
    return this.store.update(tournamentId, t => {
      if (!isPrivateTournament(t)) throw new Error('Only a private tournament has an invite link');
      t.inviteCode = newInviteCode();
      t.updatedAt = this.now();
    });
  }

  start(id: string): Promise<TournamentState> {
    return this.change(id, (t, now) => {
      if (t.status !== 'setup') throw new Error(t.status === 'paused' ? 'Tournament is paused; resume it instead' : 'Tournament has already started');
      if (t.registeredPlayers.length < 2) throw new Error('At least 2 players are needed to start');
      this.begin(t, now);
    });
  }

  /**
   * A tournament with a start time starts by itself once it's due, or is cancelled if too few
   * players registered. Nothing runs in the background, so pages that show tournaments call this.
   * Returns the tournament, and whether this call started it.
   */
  async startIfDue(id: string): Promise<{ tournament: TournamentState | null; started: boolean }> {
    const current = await this.get(id);
    const at = current?.config.startsAt;
    if (!current || current.status !== 'setup' || at === undefined || this.now() < at) return { tournament: current, started: false };
    let started = false;
    const tournament = await this.change(id, (t, now) => {
      if (t.status !== 'setup') return;
      const needed = Math.max(2, t.config.minPlayers ?? 2);
      if (t.registeredPlayers.length >= needed) {
        this.begin(t, now);
        started = true;
      } else {
        t.status = 'cancelled';
        t.cancelledAt = now;
        t.cancelReason = `Not enough players: ${t.registeredPlayers.length} registered, ${needed} needed`;
      }
    });
    return { tournament, started };
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
      addPendingChips(t, input.userId, t.config.rebuys?.stack ?? 0);
      // A busted player buys back in: back in the field, with their elimination undone and a new seat
      if (t.eliminatedPlayers.includes(input.userId)) this.returnToField(t, input.userId);
    });
  }

  /**
   * The director closes rebuys now. Without it, rebuys that last to the end of the schedule would
   * keep a tournament that is down to one player from ever finishing.
   */
  closeRebuys(id: string): Promise<TournamentState> {
    return this.change(id, (t, now) => {
      if (!t.config.rebuys?.enabled) throw new Error('Rebuys are not enabled');
      if (t.status !== 'running' && t.status !== 'paused' && t.status !== 'on-break') throw new Error('Rebuys can only be closed while the tournament is on');
      if (!rebuyPeriodOpen(t)) throw new Error('Rebuys are already closed');
      t.rebuysClosedAt = now;
      finishIfDecided(t);
    });
  }

  addOn(input: { tournamentId: string; userId: string }): Promise<TournamentState> {
    return this.change(input.tournamentId, (t, now) => {
      const refused = whyNoAddOn(t, input.userId);
      if (refused) throw new Error(refused);
      (t.registrationTimeline = t.registrationTimeline || []).push({ at: now, type: 'addOn', userId: input.userId });
      addPendingChips(t, input.userId, t.config.addOn?.stack ?? 0);
    });
  }

  /**
   * A table finished a hand: record everyone's stack, and eliminate the players who busted, in
   * order (the smallest starting stack first, so it finishes lowest), crediting who won their chips.
   * Busts recorded this way can't be undone: the chips have already moved at the table.
   *
   * With `tableId` and `handNumber` (the hand just finished) the table also takes its turn hand for
   * hand on the bubble (see handForHandWaits); busts in a hand-for-hand round wait for it to end.
   */
  reportHand(input: {
    tournamentId: string;
    stacks: Record<string, number>;
    busted: { userId: string; eliminatedBy?: string; startStack?: number }[];
    tableId?: string;
    handNumber?: number;
  }): Promise<TournamentState> {
    return this.change(input.tournamentId, (t, now) => {
      if (t.status !== 'running' && t.status !== 'paused' && t.status !== 'on-break') return;
      const chips = (t.chips = t.chips || {});
      for (const [userId, stack] of Object.entries(input.stacks)) {
        if (t.registeredPlayers.includes(userId) && !t.eliminatedPlayers.includes(userId)) chips[userId] = Math.max(0, stack);
      }
      const { tableId } = input;
      const handNumber = input.handNumber ?? 0;
      const h = t.handForHand;
      if (h && tableId !== undefined && h.dealtAfter[tableId] !== undefined && handNumber > h.dealtAfter[tableId]) {
        // This table's hand of the round is over; its busts wait for the other tables
        for (const bust of input.busted) {
          if (!h.busts.some(b => b.userId === bust.userId)) h.busts.push({ ...bust, startStack: bust.startStack ?? 0 });
        }
        if (!h.finished.includes(tableId)) h.finished.push(tableId);
      } else {
        this.eliminateBusts(t, now, input.busted);
      }
      if (tableId !== undefined) this.takeHandForHandTurn(t, now, tableId, handNumber);
    });
  }

  /**
   * A busted player buys a new entry while late registration is open: the buy-in goes to the
   * prize pool, they count as another entry, and they're dealt back in with a starting stack.
   */
  reenter(input: { tournamentId: string; userId: string }): Promise<TournamentState> {
    return this.change(input.tournamentId, (t, now) => {
      const refused = whyNoReentry(t, input.userId, now);
      if (refused) throw new Error(refused);
      (t.registrationTimeline = t.registrationTimeline || []).push({ at: now, type: 'reentry', userId: input.userId });
      postBounty(t, input.userId);
      addPendingChips(t, input.userId, t.config.startingStack);
      this.returnToField(t, input.userId);
    });
  }

  /** Eliminate players who busted at a table, in the order given, crediting who won their chips. */
  private eliminateBusts(t: TournamentState, now: number, busted: { userId: string; eliminatedBy?: string }[]): void {
    for (const bust of busted) {
      // An earlier bust in this hand may have ended the tournament
      if ((t.status as TournamentState['status']) === 'completed') break;
      if (t.eliminatedPlayers.includes(bust.userId) || !t.registeredPlayers.includes(bust.userId)) continue;
      if (remainingPlayers(t).length <= 1) break;
      const by = bust.eliminatedBy && bust.eliminatedBy !== bust.userId && remainingPlayers(t).includes(bust.eliminatedBy)
        ? bust.eliminatedBy
        : undefined;
      this.knockOut(t, now, bust.userId, by, false, true);
    }
  }

  /**
   * Hand for hand: end the round once every table playing has finished its hand (eliminating the
   * round's busts, the smallest starting stack at any table finishing lowest), start a round when
   * the tournament is on the bubble, and let this table deal its hand of the round if it hasn't.
   */
  private takeHandForHandTurn(t: TournamentState, now: number, tableId: string, handNumber: number): void {
    let h = t.handForHand ?? null;
    const round = h?.round ?? 0;
    if (h && playingTables(t).every(tb => h!.finished.includes(tb.id))) {
      const busts = [...h.busts].sort((a, b) => a.startStack - b.startStack);
      t.handForHand = h = null;
      this.eliminateBusts(t, now, busts);
    }
    if (!h && handForHandDue(t)) t.handForHand = h = { round: round + 1, dealtAfter: {}, finished: [], busts: [] };
    if (!h) delete t.handForHand;
    if (h && t.status === 'running' && h.dealtAfter[tableId] === undefined && playingTables(t).some(tb => tb.id === tableId)) {
      h.dealtAfter[tableId] = handNumber;
    }
  }

  /** Remember the game room a table plays in. */
  setTableRoom(input: { tournamentId: string; tableId: string; roomId: string }): Promise<TournamentState> {
    return this.change(input.tournamentId, t => {
      const table = t.tables.find(tb => tb.id === input.tableId);
      if (table && !table.roomId) table.roomId = input.roomId;
    });
  }

  /** Chips bought earlier reached a table: they're part of the player's stack now. */
  ackChips(input: { tournamentId: string; delivered: Record<string, number> }): Promise<TournamentState> {
    return this.change(input.tournamentId, t => {
      const chips = (t.chips = t.chips || {});
      const pending = (t.pendingChips = t.pendingChips || {});
      for (const [userId, amount] of Object.entries(input.delivered)) {
        if (!(amount > 0)) continue;
        chips[userId] = (chips[userId] ?? 0) + amount;
        pending[userId] = Math.max(0, (pending[userId] ?? 0) - amount);
        if (pending[userId] === 0) delete pending[userId];
      }
    });
  }

  /**
   * Take a player out of the field. `removed` is the director removing them: no knocker is needed,
   * and in a knockout their bounty is forfeited rather than paid.
   */
  private knockOut(
    t: TournamentState,
    now: number,
    userId: string,
    by: string | undefined,
    removed: boolean,
    fromHand = false
  ): void {
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
    } else if (bountyEnabled(t.config) && !removed && !fromHand) {
      throw new Error('Say who knocked the player out, so the bounty can be paid');
    }
    // Finishing place is the number of players left, counting the one going out
    t.eliminatedPlayers.push(userId);
    const bounty = by !== undefined ? settleKnockout(t, userId, by) : 0;
    // A bust nobody can be credited with (rare: a hand result without a winner) forfeits the bounty too
    const forfeited = removed || by === undefined ? forfeitBounty(t, userId) : 0;
    if (t.chips) t.chips[userId] = 0;
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
    let previous: TournamentState | null = null;
    const saved = this.store.update(id, t => {
      const now = this.now();
      catchUpClock(t, now);
      // The rebuy period may have just closed with one player left
      finishIfDecided(t);
      const { lastElimination: _previous, ...current } = t;
      const before: TournamentState = JSON.parse(JSON.stringify(current));
      previous = before;
      apply(t, now);
      if (options.undoable && t.eliminatedPlayers.length > before.eliminatedPlayers.length) {
        t.lastElimination = { before };
      } else {
        delete t.lastElimination;
      }
      t.updatedAt = now;
    });
    return saved.then(after => {
      if (previous && this.onChange) {
        try { this.onChange(previous, after); } catch (err) { console.warn('[tournament] Change listener failed:', err); }
      }
      return after;
    });
  }

  /** Start play: the first level's clock, the seat draw and everyone's starting stack. */
  private begin(t: TournamentState, now: number): void {
    startClock(t, now);
    t.tables = drawSeats(t.registeredPlayers, seatsPerTable(t), this.random);
    for (const userId of t.registeredPlayers) addPendingChips(t, userId, t.config.startingStack);
  }

  /** A busted player comes back (rebuy or re-entry): their elimination is undone and they get a new seat. */
  private returnToField(t: TournamentState, userId: string): void {
    t.eliminatedPlayers = t.eliminatedPlayers.filter(p => p !== userId);
    const records = t.eliminationRecords || [];
    const last = records.map(r => r.userId).lastIndexOf(userId);
    if (last >= 0) t.eliminationRecords = records.filter((_, i) => i !== last);
    seatLatePlayer(t.tables, userId, seatsPerTable(t), this.random);
    this.balance(t);
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

/** Why a player can't re-enter right now, or null when they can: busted, while late registration is open, within the limit. */
export function whyNoReentry(t: TournamentState, userId: string, now: number): string | null {
  const cfg = t.config.reentry;
  if (!cfg?.enabled) return 'Re-entry is not allowed in this tournament';
  if (!t.registeredPlayers.includes(userId)) return 'Player not registered';
  if (!t.eliminatedPlayers.includes(userId)) return 'Only a player who has busted can re-enter';
  if (!registrationOpen(t, now)) return 'Re-entry has closed with late registration';
  const prior = (t.registrationTimeline || []).filter(e => e.type === 'reentry' && e.userId === userId).length;
  if (cfg.maxPerPlayer && prior >= cfg.maxPerPlayer) return 'Re-entry limit reached';
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
  if (!cfg?.enabled || t.rebuysClosedAt) return false;
  if (cfg.availableUntilLevel === undefined || cfg.availableUntilLevel === null) return true;
  return currentLevelNumber(t) <= cfg.availableUntilLevel;
}

/** Tables with at least two players, which can deal a hand. */
function playingTables(t: TournamentState) {
  return t.tables.filter(tb => seatedPlayers(tb).length >= 2);
}

/**
 * Whether the tournament is on the bubble with more than one table, so the tables play hand for
 * hand: one player away from the money, and rebuys over (a bust before then may buy back in).
 */
export function handForHandDue(t: TournamentState): boolean {
  if (t.status !== 'running' && t.status !== 'paused' && t.status !== 'on-break') return false;
  if (playingTables(t).length < 2 || rebuyPeriodOpen(t)) return false;
  const paid = payoutTable(t).length;
  return paid > 0 && remainingPlayers(t).length === paid + 1;
}

/**
 * Whether a table that has finished a hand waits for the other tables before dealing another:
 * hand for hand, it has played its hand of the round and other tables haven't finished theirs.
 */
export function handForHandWaits(t: TournamentState, tableId: string): boolean {
  return !!t.handForHand?.finished.includes(tableId);
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

/** Chips a player bought that their table will hand them before its next hand. */
function addPendingChips(t: TournamentState, userId: string, amount: number): void {
  if (!(amount > 0)) return;
  const pending = (t.pendingChips = t.pendingChips || {});
  pending[userId] = (pending[userId] ?? 0) + amount;
}
