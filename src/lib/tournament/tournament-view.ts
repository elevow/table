import { breakTimeRemainingMs, levelTimeRemainingMs } from './tournament-clock';
import { amountsPaid, bountyEnabled, bountyPool, chipsInPlay, forfeitedBounties, payoutTable, prizePool, remainingPlayers } from './tournament-money';
import { registrationOpen, whyNoAddOn, whyNoRebuy } from './tournament-manager';
import type { BlindLevel, TournamentConfig } from '../../types/tournament';
import type { TournamentState, TournamentStatus } from '../../types/tournament-management';

export interface LevelView {
  number: number;
  smallBlind: number;
  bigBlind: number;
  ante: number | null;
  minutes: number;
}

export interface TournamentView {
  id: string;
  name: string;
  status: TournamentStatus;
  serverNow: number; // epoch ms the view was built, so clients can count down from it
  level: LevelView | null; // null before the start
  nextLevel: LevelView | null;
  levelRemainingMs: number | null;
  onBreak: boolean;
  breakRemainingMs: number | null;
  players: { entrants: number; remaining: number; paidPlaces: number };
  registration: { open: boolean; full: boolean; maxPlayers: number | null };
  // What each buy costs a player, bounty included
  costs: { entry: number; rebuy: number | null; addOn: number | null };
  tables: { number: number; players: { seat: number; userId: string; name: string }[] }[];
  entrants: { userId: string; name: string; out: boolean }[]; // everyone registered, by name
  canManage: boolean; // the viewer runs this tournament
  // For the director: the latest elimination, while it can still be undone
  undo: null | { userId: string; name: string };
  cancelled: null | { at: number; reason: string | null };
  // For the director of a cancelled tournament: what each player paid in, and so is owed back
  refunds: { userId: string; name: string; paid: number }[];
  prizePool: number;
  payouts: { place: number; percentage: number; amount: number }[];
  chipsInPlay: number;
  averageStack: number | null;
  bounty: null | {
    type: 'standard' | 'progressive';
    amount: number;
    total: number;
    forfeited: number; // bounties of removed players, which nobody won
    // Everyone who has won bounty money or is still in, most won first
    board: { userId: string; name: string; won: number; bounty: number | null }[];
  };
  // Finishing order so far, best place first, with what each place wins
  finishers: { place: number; userId: string; name: string; prize: number; eliminatedBy: string | null; removed: boolean }[];
  you: null | {
    eliminated: boolean;
    canUnregister: boolean;
    canRebuy: boolean;
    canAddOn: boolean;
    place: number | null;
    table: number | null;
    seat: number | null;
    bounty: number | null;
    bountyWon: number;
    paid: number; // everything this player has paid in
  };
}

/** What entering, rebuying and taking the add-on cost a player, bounty included. */
export function playerCosts(config: TournamentConfig): TournamentView['costs'] {
  const bounty = config.bounty?.amount ?? 0;
  return {
    entry: (config.buyIn ?? 0) + (config.entryFee ?? 0) + bounty,
    rebuy: config.rebuys?.enabled ? config.rebuys.cost + bounty : null,
    addOn: config.addOn?.enabled ? config.addOn.cost : null,
  };
}

function isFull(t: TournamentState): boolean {
  return !!t.config.maxPlayers && t.registeredPlayers.length >= t.config.maxPlayers;
}

const levelView = (l: BlindLevel | undefined): LevelView | null =>
  l ? { number: l.level, smallBlind: l.smallBlind, bigBlind: l.bigBlind, ante: l.ante ?? null, minutes: l.durationMinutes } : null;

/**
 * What players see of a tournament at `now`. `names` maps user IDs to display names;
 * `viewerId` is the signed-in player, or null for a guest.
 */
export function buildTournamentView(
  t: TournamentState,
  now: number,
  viewerId: string | null,
  names: Record<string, string>,
  options: { canManage?: boolean } = {}
): TournamentView {
  const nameOf = (id: string) => names[id] || `Player ${id.slice(0, 6)}`;
  const remaining = remainingPlayers(t);
  const started = t.status !== 'setup';
  const payouts = payoutTable(t);
  const prizeFor = (place: number) => payouts.find(p => p.place === place)?.amount ?? 0;
  const chips = chipsInPlay(t);

  const finishers = [...(t.eliminationRecords || [])]
    .sort((a, b) => a.place - b.place)
    .map(r => ({
      place: r.place, userId: r.userId, name: nameOf(r.userId), prize: prizeFor(r.place), eliminatedBy: r.eliminatedBy ?? null, removed: !!r.removed,
    }));
  if (t.status === 'completed' && remaining.length === 1) {
    finishers.unshift({ place: 1, userId: remaining[0], name: nameOf(remaining[0]), prize: prizeFor(1), eliminatedBy: null, removed: false });
  }
  const paid = amountsPaid(t);

  let bounty: TournamentView['bounty'] = null;
  if (bountyEnabled(t.config)) {
    const won = t.bountyWinnings || {};
    const heads = t.bounties || {};
    const ids = new Set([...Object.keys(won).filter(id => won[id] > 0), ...remaining]);
    bounty = {
      type: t.config.bounty!.type,
      amount: t.config.bounty!.amount,
      total: bountyPool(t),
      forfeited: forfeitedBounties(t),
      board: [...ids]
        .map(id => ({ userId: id, name: nameOf(id), won: won[id] ?? 0, bounty: remaining.includes(id) ? heads[id] ?? 0 : null }))
        .sort((a, b) => b.won - a.won || (b.bounty ?? -1) - (a.bounty ?? -1) || a.name.localeCompare(b.name)),
    };
  }

  let you: TournamentView['you'] = null;
  if (viewerId && t.registeredPlayers.includes(viewerId)) {
    const table = t.tables.find(tb => tb.seats.includes(viewerId));
    const record = [...(t.eliminationRecords || [])].reverse().find(r => r.userId === viewerId);
    const eliminated = t.eliminatedPlayers.includes(viewerId);
    you = {
      eliminated,
      canUnregister: t.status === 'setup',
      canRebuy: whyNoRebuy(t, viewerId) === null,
      canAddOn: whyNoAddOn(t, viewerId) === null,
      place: eliminated ? record?.place ?? null : t.status === 'completed' && remaining[0] === viewerId ? 1 : null,
      table: table?.number ?? null,
      seat: table ? table.seats.indexOf(viewerId) + 1 : null,
      bounty: bountyEnabled(t.config) && !eliminated ? t.bounties?.[viewerId] ?? 0 : null,
      bountyWon: t.bountyWinnings?.[viewerId] ?? 0,
      paid: paid[viewerId] ?? 0,
    };
  }

  return {
    id: t.id,
    name: t.name,
    status: t.status,
    serverNow: now,
    level: started ? levelView(t.config.blindLevels[t.currentLevelIndex]) : null,
    nextLevel: levelView(t.config.blindLevels[started ? t.currentLevelIndex + 1 : 0]),
    levelRemainingMs: levelTimeRemainingMs(t, now),
    onBreak: t.onBreak,
    breakRemainingMs: breakTimeRemainingMs(t, now),
    players: { entrants: t.registeredPlayers.length, remaining: remaining.length, paidPlaces: payouts.length },
    registration: { open: registrationOpen(t, now) && !isFull(t), full: isFull(t), maxPlayers: t.config.maxPlayers ?? null },
    costs: playerCosts(t.config),
    entrants: t.registeredPlayers
      .map(id => ({ userId: id, name: nameOf(id), out: t.eliminatedPlayers.includes(id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    tables: t.tables.map(tb => ({
      number: tb.number,
      players: tb.seats.flatMap((id, i) => (id ? [{ seat: i + 1, userId: id, name: nameOf(id) }] : [])),
    })),
    canManage: !!options.canManage,
    undo: options.canManage && t.lastElimination
      ? (() => {
          const last = (t.eliminationRecords || [])[(t.eliminationRecords || []).length - 1];
          return last ? { userId: last.userId, name: nameOf(last.userId) } : null;
        })()
      : null,
    cancelled: t.status === 'cancelled' ? { at: t.cancelledAt ?? t.updatedAt, reason: t.cancelReason ?? null } : null,
    refunds: options.canManage && t.status === 'cancelled'
      ? Object.entries(paid).filter(([, amount]) => amount > 0).map(([userId, amount]) => ({ userId, name: nameOf(userId), paid: amount }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
    prizePool: prizePool(t),
    payouts,
    chipsInPlay: chips,
    averageStack: remaining.length > 0 ? Math.round(chips / remaining.length) : null,
    bounty,
    finishers,
    you,
  };
}

export interface TournamentSummary {
  id: string;
  name: string;
  status: TournamentStatus;
  createdAt: number;
  startingStack: number;
  seatsPerTable: number;
  costs: TournamentView['costs'];
  bounty: 'standard' | 'progressive' | null;
  entrants: number;
  remaining: number;
  maxPlayers: number | null;
  level: number | null; // level being played, once started
  registrationOpen: boolean;
  you: null | { registered: boolean; eliminated: boolean };
  canManage: boolean;
}

/** A tournament as the lobby lists it. */
export function buildTournamentSummary(t: TournamentState, now: number, viewerId: string | null, canManage: boolean): TournamentSummary {
  const remaining = remainingPlayers(t);
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    createdAt: t.createdAt,
    startingStack: t.config.startingStack,
    seatsPerTable: t.config.seatsPerTable ?? 9,
    costs: playerCosts(t.config),
    bounty: bountyEnabled(t.config) ? t.config.bounty!.type : null,
    entrants: t.registeredPlayers.length,
    remaining: remaining.length,
    maxPlayers: t.config.maxPlayers ?? null,
    level: t.status === 'setup' ? null : t.config.blindLevels[t.currentLevelIndex]?.level ?? null,
    registrationOpen: registrationOpen(t, now) && !isFull(t),
    you: viewerId ? { registered: t.registeredPlayers.includes(viewerId), eliminated: t.eliminatedPlayers.includes(viewerId) } : null,
    canManage,
  };
}
