import { getPool } from '../database/pool';
import { GameService } from '../services/game-service';
import { PokerEngine } from '../poker/poker-engine';
import { STALE_STATE_RESPONSE, getLastActionAt, getOrRestoreEngine, persistEngineState } from '../poker/engine-persistence';
import { clearRunItState, enrichStateWithRunIt } from '../poker/run-it-twice-manager';
import { sanitizeStateForBroadcast } from '../poker/state-sanitizer';
import * as GameSeats from '../shared/game-seats';
import { BASE_TURN_MS, DEFAULT_TIME_BANKS, DEFAULT_TIME_BANK_SECONDS } from '../shared/turn-clock';
import { publishGameStateUpdate, publishTableEvent } from '../realtime/publisher';
import { nextSeq } from '../realtime/sequence';
import { runGameAction } from '../server/game-action-pipeline';
import { loadRoom } from '../server/room-config';
import { newInviteCode } from '../server/room-privacy';
import { tournamentManager } from './manager-instance';
import { leaveSeat, moveSeat, takeSeat } from './room-seats';
import { handForHandWaits } from './tournament-manager';
import { loadPlayerNames } from './pg-tournament-store';
import { remainingPlayers } from './tournament-money';
import type { TournamentState, TournamentTable } from '../../types/tournament-management';
import type { TableState } from '../../types/poker';

/*
 * Tournament tables play in game rooms. Each table gets a private room hosted by the director,
 * with the table's players as members. The tournament decides who sits where; the rooms carry
 * out its decisions between hands:
 *
 * - prepareTournamentHand runs before each hand (from /api/games/next-hand). It reports stacks
 *   and busted players to the tournament, lets go of players the tournament moved to another
 *   table (writing them into that table's seats with their chips), seats players assigned here
 *   who aren't at any table yet, hands over chips bought since the last hand, sets the level's
 *   blinds and ante, and holds the table while the tournament is paused or on a break, or while
 *   it waits for the other tables hand for hand on the bubble. Tables play
 *   by tournament rules: a player sitting out is still dealt in, posts blinds and antes and has
 *   their hands folded for them until they come back or are blinded off.
 * - syncTournamentRooms runs after the tournament changes outside a hand (start, resume, a late
 *   entry, a rebuy): it opens rooms for new tables, seats waiting players and wakes tables that
 *   can play.
 * - keepTablesMoving runs when the tournament is viewed and after a table deals: a table nobody
 *   has open (everyone away, or gone) has no screen asking for its next hand or enforcing its turn
 *   clock, so the server does both for it.
 *
 * Seats change one at a time in the database (room-seats.ts), a move changing both tables at once.
 * Each table also clears seats the tournament no longer gives it, so a change that went wrong
 * between hands is put right before the next.
 *
 * A player moved between tables finishes the hand they're in first: their old table lets them
 * go at its next break between hands, and their new table deals them in once it has them.
 */

const BETWEEN_HANDS = new Set(['showdown', 'awaiting-dealer-choice']);
const IN_PLAY = new Set(['running', 'paused', 'on-break']);

export interface TournamentRoomLink {
  tournamentId: string;
  tableId: string;
}

/** The tournament table a room plays, from its configuration; null for an ordinary room. */
export function tournamentTableOf(configuration: unknown): TournamentRoomLink | null {
  const c = configuration && typeof configuration === 'object' ? configuration as Record<string, unknown> : {};
  return typeof c.tournamentId === 'string' && typeof c.tournamentTableId === 'string'
    ? { tournamentId: c.tournamentId, tableId: c.tournamentTableId }
    : null;
}

export type PrepareResult = { ok: true } | { ok: false; status: number; body: Record<string, unknown> };

const currentLevel = (t: TournamentState) => t.config.blindLevels[t.currentLevelIndex] ?? t.config.blindLevels[0];

/** Who won the most from the hand among the players still in: they're credited with a bust. */
function biggestWinner(state: TableState, exclude: Set<string>): string | undefined {
  const winnings = state.handResult?.winnings || {};
  const ranked = Object.entries(winnings).filter(([id, amount]) => amount > 0 && !exclude.has(id)).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? (state.handWinners || []).find(id => !exclude.has(id));
}

/** Chips a player brings to a table they're joining: their stack plus anything bought since. */
function chipsToBring(t: TournamentState, userId: string): { total: number; pending: number } {
  const pending = t.pendingChips?.[userId] ?? 0;
  return { total: (t.chips?.[userId] ?? 0) + pending, pending };
}

/** The seats of every room the tournament plays in, by room. */
async function loadAllSeats(t: TournamentState): Promise<Map<string, GameSeats.GameSeats>> {
  const all = new Map<string, GameSeats.GameSeats>();
  for (const table of t.tables) {
    if (table.roomId) all.set(table.roomId, (await GameSeats.loadPersistedRoomSeats(table.roomId)) || {});
  }
  return all;
}

function seatedIn(seats: GameSeats.GameSeats, userId: string): boolean {
  return Object.values(seats).some(a => a?.playerId === userId);
}

/** Put a player in a room's seat (the tournament's seat number) and make them a member. */
async function seatPlayer(roomId: string, seats: GameSeats.GameSeats, seatNumber: number, userId: string, name: string, chips: number) {
  const seat = { playerId: userId, playerName: name, chips };
  await takeSeat(roomId, seatNumber, seat);
  seats[seatNumber] = seat;
}

function vacate(seats: GameSeats.GameSeats, userId: string) {
  for (const [n, a] of Object.entries(seats)) if (a?.playerId === userId) seats[Number(n)] = null;
}

/**
 * Bring a tournament table's room in line with the tournament before its next hand. On ok, the
 * caller syncs seated players into the engine, deals the hand and saves; otherwise it answers
 * with the result. Players who left are saved straight away either way.
 */
export async function prepareTournamentHand(roomId: string, engine: PokerEngine, link: TournamentRoomLink): Promise<PrepareResult> {
  const state = engine.getState();
  if (!BETWEEN_HANDS.has(state.stage)) return { ok: false, status: 409, body: { error: 'Hand still in progress' } };
  engine.useTournamentRules();

  // 1. Report the hand: stacks, and who busted (smallest starting stack first, so it finishes lowest)
  const live = state.players.filter(p => !engine.isRemoved(p.id));
  const stacks = Object.fromEntries(live.map(p => [p.id, Number(p.stack) || 0]));
  const bustedIds = new Set(live.filter(p => (Number(p.stack) || 0) <= 0).map(p => p.id));
  const startStack = (id: string) => state.handStartStacks?.[id] ?? 0;
  const busted = live
    .filter(p => bustedIds.has(p.id))
    .sort((a, b) => startStack(a.id) - startStack(b.id))
    .map(p => ({ userId: p.id, eliminatedBy: biggestWinner(state, bustedIds), startStack: startStack(p.id) }));
  const handNumber = Number(state.handNumber) || 0;
  let t = await tournamentManager.reportHand({ tournamentId: link.tournamentId, stacks, busted, tableId: link.tableId, handNumber });

  // 2. Seat the table the way the tournament has it
  const table = t.tables.find(tb => tb.id === link.tableId);
  const wanted = new Set((table?.seats ?? []).filter((id): id is string => !!id));
  const allSeats = await loadAllSeats(t);
  const seats = allSeats.get(roomId) || {};
  const names = await loadPlayerNames(t.registeredPlayers).catch(() => ({} as Record<string, string>));
  const nameOf = (id: string) => names[id] || live.find(p => p.id === id)?.name || `Player ${id.slice(0, 6)}`;
  const delivered: Record<string, number> = {};
  const wake = new Set<string>();
  let changed = false;

  // Players who busted or were moved leave; a moved player takes their chips to their new table
  for (const p of live) {
    if (wanted.has(p.id)) continue;
    engine.removePlayer(p.id);
    changed = true;
    const dest = remainingPlayers(t).includes(p.id) ? t.tables.find(tb => tb.seats.includes(p.id)) : undefined;
    // A table without a room yet gets one in syncTournamentRooms, which seats them
    const destSeats = dest?.roomId ? allSeats.get(dest.roomId) || {} : undefined;
    if (dest?.roomId && destSeats && !seatedIn(destSeats, p.id)) {
      const { total, pending } = chipsToBring(t, p.id);
      const seat = { playerId: p.id, playerName: nameOf(p.id), chips: total };
      await moveSeat(roomId, dest.roomId, dest.seats.indexOf(p.id) + 1, seat);
      vacate(seats, p.id);
      destSeats[dest.seats.indexOf(p.id) + 1] = seat;
      if (pending > 0) delivered[p.id] = pending;
      wake.add(dest.roomId);
    } else {
      await leaveSeat(roomId, p.id);
      vacate(seats, p.id);
    }
    if (!dest?.roomId) continue;
    await publishTableEvent(roomId, {
      type: 'tournament_moved', playerId: p.id, roomId: dest.roomId, table: dest.number, seat: dest.seats.indexOf(p.id) + 1,
    }).catch(() => {});
  }
  // Seats the tournament no longer gives this table (left by a change that went wrong) are cleared,
  // so nobody who busted or moved comes back into the game here
  for (const a of Object.values(seats)) {
    if (!a?.playerId || wanted.has(a.playerId)) continue;
    await leaveSeat(roomId, a.playerId);
    vacate(seats, a.playerId);
  }
  // Players assigned here who aren't at any table yet (a late entry, a rebuy back in) sit down
  for (const userId of wanted) {
    if ([...allSeats.values()].some(s => seatedIn(s, userId))) continue;
    const { total, pending } = chipsToBring(t, userId);
    await seatPlayer(roomId, seats, table!.seats.indexOf(userId) + 1, userId, nameOf(userId), total);
    if (pending > 0) delivered[userId] = pending;
  }
  // Chips bought by players already playing here (an add-on, a rebuy while still in) go on their stacks
  for (const p of live) {
    const pending = t.pendingChips?.[p.id] ?? 0;
    if (pending > 0 && wanted.has(p.id) && delivered[p.id] === undefined) {
      p.stack = (Number(p.stack) || 0) + pending;
      delivered[p.id] = pending;
      changed = true;
    }
  }
  if (Object.keys(delivered).length > 0) t = await tournamentManager.ackChips({ tournamentId: link.tournamentId, delivered });
  const hold = (body: Record<string, unknown>): PrepareResult => ({ ok: false, status: 409, body });
  // Save who left now, whatever happens next: a table that then can't deal (one player left, waiting
  // for a moved player) would otherwise report the same busts again, eliminating a player who has
  // since bought back in
  if (changed && (await persistEngineState(roomId, engine)) === 'conflict') return hold({ ...STALE_STATE_RESPONSE });

  // Hand for hand: the first table to deal a round's hand wakes the others to deal theirs
  const h = t.handForHand;
  if (h && h.dealtAfter[link.tableId] === handNumber && Object.keys(h.dealtAfter).length === 1 && h.finished.length === 0) {
    for (const other of t.tables) if (other.roomId && other.roomId !== roomId) wake.add(other.roomId);
  }

  // 3. This level's blinds and ante, from the next hand
  const level = currentLevel(t);
  engine.setPendingBlinds(level.smallBlind, level.bigBlind);
  engine.setAnte(level.ante ?? 0);

  for (const other of wake) await wakeTable(other).catch(err => console.warn('[tournament] Could not wake table:', err));

  // 4. Hold the table while the tournament isn't playing
  if (!IN_PLAY.has(t.status)) {
    return hold({ error: t.status === 'completed' ? 'The tournament is over' : 'The tournament has ended', code: 'TOURNAMENT_OVER' });
  }
  if (wanted.size === 0) {
    return hold({ error: 'This table has closed; its players have moved to other tables', code: 'TABLE_CLOSED' });
  }
  if (t.status !== 'running') {
    await persistEngineState(roomId, engine);
    return hold({
      error: t.status === 'on-break' ? 'The tournament is on a break' : 'The director has paused the tournament',
      code: 'TOURNAMENT_PAUSED',
      breakEndsAt: t.status === 'on-break' ? t.breakEndsAt : null,
    });
  }
  if (handForHandWaits(t, link.tableId)) {
    return hold({ error: 'Hand for hand: waiting for the other tables to finish their hands', code: 'HAND_FOR_HAND' });
  }
  return { ok: true };
}

/** Make a game room for a tournament table. */
async function createTableRoom(t: TournamentState, table: TournamentTable): Promise<string> {
  const level = currentLevel(t);
  const players = table.seats.filter((id): id is string => !!id);
  const room = await new GameService(getPool()).createRoom({
    name: `${t.name} · Table ${table.number}`.slice(0, 60),
    gameType: 'poker',
    maxPlayers: table.maxSeats,
    blindLevels: { sb: level.smallBlind, bb: level.bigBlind },
    createdBy: t.createdBy || '',
    configuration: {
      variant: 'texas-holdem',
      bettingMode: 'no-limit',
      ...(level.ante ? { ante: level.ante } : {}),
      buyIn: t.config.startingStack,
      numberOfRebuys: 0,
      visibility: 'private',
      inviteCode: newInviteCode(),
      members: players,
      tournamentId: t.id,
      tournamentTableId: table.id,
    },
  });
  return room.id;
}

/** Deal the first hand at a room whose players are seated but which has no game yet. */
async function startTableGame(roomId: string, t: TournamentState, seats: GameSeats.GameSeats): Promise<void> {
  const level = currentLevel(t);
  const players = Object.entries(seats)
    .filter(([, a]) => !!a?.playerId && Number(a.chips) > 0)
    .map(([n, a]) => ({
      id: a!.playerId, name: a!.playerName || a!.playerId, position: Number(n), stack: Number(a!.chips),
      currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30, holeCards: [],
      // Away until they open the table (their screen sits them in), so no-shows don't hold it up
      isSittingOut: true, notArrived: true,
    }))
    .sort((a, b) => a.position - b.position);
  if (players.length < 2) return;
  const engine = new PokerEngine(roomId, players as any, level.smallBlind, level.bigBlind, { variant: 'texas-holdem' as any, bettingMode: 'no-limit' });
  engine.configureClock({ turnSeconds: BASE_TURN_MS / 1000, timeBanks: DEFAULT_TIME_BANKS, timeBankSeconds: DEFAULT_TIME_BANK_SECONDS });
  engine.useTournamentRules();
  engine.setAnte(level.ante ?? 0);
  engine.startNewHand();
  const g: any = global as any;
  if (!g.activeGames) g.activeGames = new Map();
  if (!g.roomConfigs) g.roomConfigs = new Map();
  g.activeGames.set(roomId, engine);
  g.roomConfigs.set(roomId, { variant: 'texas-holdem', bettingMode: 'no-limit', smallBlind: level.smallBlind, bigBlind: level.bigBlind, mode: 'fixed' });
  clearRunItState(roomId);
  await persistEngineState(roomId, engine);
  await announce(roomId, engine.getState(), 'tournament_table_started');
}

async function announce(roomId: string, state: TableState, action: string): Promise<void> {
  try {
    await publishGameStateUpdate(roomId, {
      gameState: sanitizeStateForBroadcast(enrichStateWithRunIt(roomId, state)),
      seq: nextSeq(roomId),
      lastAction: { action },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[tournament] Could not announce table state:', err);
  }
}

/**
 * Get a table playing if it can: start its game once two players are seated, or deal the next
 * hand at a table that's waiting between hands. Players' own clients keep asking for the next
 * hand too; whichever request saves first wins.
 */
export async function wakeTable(roomId: string): Promise<void> {
  const room = await loadRoom(roomId);
  const link = tournamentTableOf(room?.configuration);
  if (!link) return;
  const t = await tournamentManager.get(link.tournamentId);
  if (!t || t.status !== 'running') return;
  const engine = await getOrRestoreEngine(roomId);
  const seats = (await GameSeats.loadPersistedRoomSeats(roomId)) || {};
  if (!engine) return startTableGame(roomId, t, seats);
  if (!BETWEEN_HANDS.has(engine.getState().stage)) return;
  const prepared = await prepareTournamentHand(roomId, engine, link);
  if (!prepared.ok) return;
  engine.syncSeatedPlayers(Object.entries(await GameSeats.loadPersistedRoomSeats(roomId) || {})
    .filter(([, a]) => !!a?.playerId)
    .map(([n, a]) => ({ id: a!.playerId, name: a!.playerName, seatNumber: Number(n), chips: Number(a!.chips) || 0 })));
  if (engine.getState().paused || !engine.canStartNewHand()) {
    await persistEngineState(roomId, engine);
    return;
  }
  clearRunItState(roomId);
  engine.startNewHand();
  if ((await persistEngineState(roomId, engine)) === 'conflict') return;
  await announce(roomId, engine.getState(), 'next_hand_started');
}

// Players' screens ask for the next hand 5 seconds after a showdown and enforce the turn clock the
// moment it runs out; the server steps in only once they clearly haven't
const IDLE_SHOWDOWN_MS = 12_000;
const TURN_GRACE_MS = 5_000;
const NUDGE_EVERY_MS = 10_000;
const lastNudged = new Map<string, number>();

/**
 * Keep a tournament's tables playing when nobody has them open: deal the next hand at a table
 * that has sat at showdown too long, and act for a player whose turn clock ran out without a
 * screen enforcing it. Under tournament rules everyone away is dealt in and folded for, so an
 * abandoned table carries on blinding its players off. At most every few seconds per tournament
 * (on this server instance); failures are logged, not thrown.
 */
export async function keepTablesMoving(tournamentId: string, options: { skipRoomId?: string } = {}): Promise<void> {
  const now = Date.now();
  if (now - (lastNudged.get(tournamentId) ?? 0) < NUDGE_EVERY_MS) return;
  lastNudged.set(tournamentId, now);
  try {
    const t = await tournamentManager.get(tournamentId);
    if (!t || t.status !== 'running') return;
    for (const table of t.tables) {
      if (!table.roomId || table.roomId === options.skipRoomId) continue;
      await moveTableOn(table.roomId, now).catch(err => console.warn('[tournament] Could not move a table on:', err));
    }
  } catch (err) {
    console.warn('[tournament] Could not keep tables moving:', err);
  }
}

async function moveTableOn(roomId: string, now: number): Promise<void> {
  const engine = await getOrRestoreEngine(roomId);
  if (!engine) return wakeTable(roomId);
  const state = engine.getState();
  if (BETWEEN_HANDS.has(state.stage)) {
    const last = await getLastActionAt(roomId);
    if (!last || now - last.getTime() >= IDLE_SHOWDOWN_MS) await wakeTable(roomId);
    return;
  }
  const deadline = state.turnDeadline;
  if (!state.activePlayer || typeof deadline !== 'number' || now < deadline + TURN_GRACE_MS || state.runItTwicePrompt || state.paused) return;
  const player = state.players.find(p => p.id === state.activePlayer);
  if (!player) return;
  await runGameAction({
    tableId: roomId,
    engine,
    apply: () => { engine.handleTimeout(now); },
    lastAction: { action: player.currentBet < state.currentBet ? 'fold' : 'check', playerId: player.id, reason: 'timeout' },
  });
}

/**
 * After the tournament changed outside a hand: open rooms for tables that don't have one, seat
 * players who aren't at any table yet, and wake every table so it plays if it can. Failures are
 * logged, not thrown: the tables catch up between hands anyway.
 */
export async function syncTournamentRooms(tournamentId: string): Promise<void> {
  try {
    let t = await tournamentManager.get(tournamentId);
    if (!t || !IN_PLAY.has(t.status)) return;
    for (const table of t.tables) {
      if (table.roomId) continue;
      const roomId: string = await createTableRoom(t, table);
      t = await tournamentManager.setTableRoom({ tournamentId, tableId: table.id, roomId });
    }
    const allSeats = await loadAllSeats(t);
    const names = await loadPlayerNames(t.registeredPlayers).catch(() => ({} as Record<string, string>));
    const delivered: Record<string, number> = {};
    for (const table of t.tables) {
      if (!table.roomId) continue;
      const seats = allSeats.get(table.roomId) || {};
      for (const [i, userId] of table.seats.entries()) {
        if (!userId || [...allSeats.values()].some(s => seatedIn(s, userId))) continue;
        const { total, pending } = chipsToBring(t, userId);
        await seatPlayer(table.roomId, seats, i + 1, userId, names[userId] || `Player ${userId.slice(0, 6)}`, total);
        if (pending > 0) delivered[userId] = pending;
      }
    }
    if (Object.keys(delivered).length > 0) t = await tournamentManager.ackChips({ tournamentId, delivered });
    for (const table of t.tables) {
      if (!table.roomId) continue;
      await wakeTable(table.roomId).catch(err => console.warn('[tournament] Could not wake table:', err));
      await publishTableEvent(table.roomId, { type: 'tournament', status: t.status }).catch(() => {});
    }
  } catch (err) {
    console.error('[tournament] Could not sync tables with rooms:', err);
  }
}
