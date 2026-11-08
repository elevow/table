import type { Pool } from 'pg';
import { isBettingMode } from '../poker/variant-rules';
import { getPool } from '../database/pool';
import { PlayerStatisticsManager } from '../database/player-statistics-manager';
import {
  hammerTiers, handAchievements, historyAchievements, holdsTrips, isDejaVu, isSevenDeuceOffsuit, needsHistory, showdownRanking,
} from './achievement-checks';
import type { HandExtras, PastHand } from './achievement-checks';
import { revealedPlayerIds } from '../poker/state-sanitizer';
import { postHandResultToChat, postSystemChatMessage } from '../utils/post-hand-result';
import { formatSevenDeuceBounty } from '../utils/hand-result-formatter';
import type { TableState } from '../../types/poker';
import { HandRank } from '../../types/poker';
import type { HandRecord, HandRecordCards, HandRecordPlayer, HandSummary } from '../../types/hand-record';

/**
 * Build the record of a hand that has just ended, or null when the state is not a finished hand.
 * Every dealt card is kept; who may see them is decided when the record is read.
 */
export function buildHandRecord(tableId: string, state: TableState): HandRecord | null {
  if (state.stage !== 'showdown' || !state.handId) return null;
  const starts = state.handStartStacks || {};
  const revealed = revealedPlayerIds(state);
  const winnings = state.handResult?.winnings || {};

  const players: HandRecordPlayer[] = [];
  for (const p of state.players) {
    const stud = state.studState?.playerCards?.[p.id];
    const cards: HandRecordCards = stud
      ? { down: stud.downCards || [], up: stud.upCards || [] }
      : { hole: p.holeCards || [] };
    const dealtIn = (cards.hole?.length || 0) + (cards.down?.length || 0) + (cards.up?.length || 0) > 0;
    // Players sitting out were not in the hand
    if (!dealtIn) continue;
    const startStack = typeof starts[p.id] === 'number' ? starts[p.id] : p.stack;
    players.push({
      id: p.id,
      name: p.name || p.id,
      seat: p.position,
      startStack,
      endStack: p.stack,
      net: p.stack - startStack,
      won: winnings[p.id] || 0,
      folded: !!p.isFolded,
      cards,
      revealed: revealed.has(p.id),
    });
  }
  if (players.length === 0) return null;

  return {
    id: state.handId,
    roomId: tableId,
    handNumber: state.handNumber || 0,
    variant: state.variant || 'texas-holdem',
    kind: state.handKind || 'normal',
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    startedAt: state.handStartedAt ? new Date(state.handStartedAt).toISOString() : null,
    endedAt: new Date().toISOString(),
    board: state.communityCards || [],
    runBoards: (state.runItTwice?.boards?.length || 0) > 1 ? state.runItTwice!.boards : undefined,
    players,
    actions: state.handActions || [],
    winners: Object.entries(winnings).map(([playerId, amount]) => ({ playerId, amount })),
    pot: state.handResult?.pot ?? players.reduce((sum, p) => sum + Math.max(0, p.startStack - (p.endStack - p.won)), 0),
    bettingMode: state.bettingMode || 'no-limit',
    buttonSeat: state.players[state.dealerPosition]?.position,
  };
}

/** Store a hand. Returns false when it was already stored (another request finished it first). */
export async function saveHandRecord(pool: Pool, record: HandRecord): Promise<boolean> {
  const params = [
    record.id,
    record.roomId,
    record.handNumber,
    record.variant,
    record.kind || 'normal',
    record.smallBlind,
    record.bigBlind,
    record.startedAt,
    record.endedAt,
    JSON.stringify(record.board),
    JSON.stringify(record.players),
    JSON.stringify(record.actions),
    JSON.stringify(record.winners),
    record.pot,
    record.players.map(p => p.id),
    record.runBoards ? JSON.stringify(record.runBoards) : null,
    record.bettingMode ?? null,
    typeof record.buttonSeat === 'number' ? record.buttonSeat : null,
  ];
  const insert = (columns: string, values: unknown[]) => pool.query(
    `INSERT INTO hand_records (id, room_id, hand_number, variant, kind, small_blind, big_blind, started_at, ended_at,
       board, players, actions, winners, pot, player_ids, run_boards${columns})
     VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')})
     ON CONFLICT (id) DO NOTHING`,
    values
  );
  let result;
  try {
    result = await insert(', betting_mode, button_seat', params);
  } catch (err: any) {
    // Database not yet migrated with the export columns: still keep the hand
    if (err?.code !== '42703') throw err;
    result = await insert('', params.slice(0, 16));
  }
  return (result.rowCount ?? 0) > 0;
}

/** Best showdown hand rank, for achievements (Hold'em, Omaha and high stud). */
function showdownRank(record: HandRecord, player: HandRecordPlayer): number | null {
  if (player.folded) return null;
  return showdownRanking(record, player)?.rank ?? null;
}

/**
 * Award an achievement the first time a player earns it. The parameters are cast because each is
 * used twice, as a selected value and against a column, and Postgres refuses to guess one type.
 */
async function awardOnce(pool: Pool, userId: string, type: string, metadata: Record<string, unknown>): Promise<void> {
  await pool.query(
    `INSERT INTO achievements (user_id, achievement_type, metadata)
     SELECT $1::uuid, $2::varchar, $3::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM achievements WHERE user_id = $1::uuid AND achievement_type = $2::varchar)`,
    [userId, type, JSON.stringify(metadata)]
  );
}

// Most hands looked back over for streaks and sessions
const HISTORY_LIMIT = 500;

/** The player's earlier hands at this table, newest first (this hand included once stored). */
async function pastHandsAtTable(pool: Pool, roomId: string, userId: string): Promise<PastHand[]> {
  const result = await pool.query(
    `SELECT h.id, h.started_at, h.ended_at, h.big_blind, h.variant, p AS me
     FROM hand_records h CROSS JOIN LATERAL jsonb_array_elements(h.players) p
     WHERE h.room_id = $1::text AND $2::text = ANY(h.player_ids) AND p->>'id' = $2::text
     ORDER BY h.ended_at DESC
     LIMIT ${HISTORY_LIMIT}`,
    [roomId, userId]
  );
  return (result?.rows || []).map((row: any) => {
    const me = parseJson<HandRecordPlayer>(row.me, {} as HandRecordPlayer);
    return {
      handId: row.id,
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      endedAt: new Date(row.ended_at).toISOString(),
      bigBlind: Number(row.big_blind),
      variant: row.variant || 'texas-holdem',
      me: { ...me, startStack: Number(me.startStack), endStack: Number(me.endStack), net: Number(me.net), won: Number(me.won) },
    };
  });
}

/** The players of the table's hand before this one, or null when there isn't one. */
async function previousHandPlayers(pool: Pool, record: HandRecord): Promise<HandRecordPlayer[] | null> {
  const result = await pool.query(
    `SELECT players FROM hand_records WHERE room_id = $1 AND id <> $2 AND ended_at <= $3
     ORDER BY ended_at DESC LIMIT 1`,
    [record.roomId, record.id, record.endedAt]
  );
  const row = result?.rows?.[0];
  return row ? parseJson<HandRecordPlayer[]>(row.players, []) : null;
}

/** How many Hold'em pots this player has won with 7-2 offsuit, this hand included once stored. */
async function sevenDeuceWins(pool: Pool, userId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS wins
     FROM hand_records h CROSS JOIN LATERAL jsonb_array_elements(h.players) p
     WHERE $1::text = ANY(h.player_ids) AND p->>'id' = $1::text
       AND COALESCE(h.variant, 'texas-holdem') = 'texas-holdem'
       AND (p->>'won')::numeric > 0
       AND jsonb_typeof(p->'cards'->'hole') = 'array' AND jsonb_array_length(p->'cards'->'hole') = 2
       AND p->'cards'->'hole'->0->>'suit' <> p->'cards'->'hole'->1->>'suit'
       AND ((p->'cards'->'hole'->0->>'rank' = '7' AND p->'cards'->'hole'->1->>'rank' = '2')
         OR (p->'cards'->'hole'->0->>'rank' = '2' AND p->'cards'->'hole'->1->>'rank' = '7'))`,
    [userId]
  );
  return Number(result?.rows?.[0]?.wins) || 0;
}

/** Look something up for an achievement; a failed lookup only costs that achievement. */
async function lookup<T>(what: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    console.warn(`[hand-records] Could not look up ${what} for achievements:`, err);
    return fallback;
  }
}

/** Add a finished hand to each player's lifetime statistics and award any achievements. */
export async function applyHandToStatistics(pool: Pool, record: HandRecord, extras: HandExtras = {}): Promise<void> {
  const stats = new PlayerStatisticsManager(pool);
  const contested = record.players.filter(p => !p.folded).length >= 2;
  const previous = String(record.variant || 'texas-holdem') === 'texas-holdem'
    ? await lookup('the previous hand', null, () => previousHandPlayers(pool, record))
    : null;
  for (const p of record.players) {
    try {
      const won = p.won > 0;
      const updated = await stats.updateStats(p.id, {
        handsPlayed: 1,
        handsWon: won ? 1 : 0,
        totalProfit: p.net,
        biggestPot: won ? record.pot : undefined,
      });
      const meta = { roomId: record.roomId, handId: record.id };
      const earned: string[] = ['first_hand'];
      if (won) earned.push('first_win');
      if (updated.handsPlayed >= 100) earned.push('hands_100');
      if (updated.handsPlayed >= 1000) earned.push('hands_1000');
      if (updated.handsWon >= 100) earned.push('wins_100');
      if (won && record.bigBlind > 0 && record.pot >= record.bigBlind * 100) earned.push('big_pot');
      if (p.startStack > 0 && p.net >= p.startStack) earned.push('double_up');
      if (won && record.kind === 'bomb-pot') earned.push('bomb_pot_win');
      if (won && contested) {
        const rank = showdownRank(record, p);
        if (rank !== null && rank >= HandRank.FourOfAKind) earned.push('quads_plus');
        if (rank === HandRank.RoyalFlush) earned.push('royal_flush');
        // The best hand among opponents who reached showdown and won nothing
        const beaten = Math.max(0, ...record.players
          .filter(o => o.id !== p.id && !o.folded && !(o.won > 0))
          .map(o => showdownRank(record, o) ?? 0));
        if (beaten >= HandRank.FourOfAKind) earned.push('beat_quads');
        if (beaten >= HandRank.StraightFlush) earned.push('beat_straight_flush');
      }
      if (won && String(record.variant).startsWith('omaha') && holdsTrips(p.cards?.hole)) earned.push('omaha_trips');
      earned.push(...handAchievements(record, p, extras));
      if (isDejaVu(record, p, previous)) earned.push('deja_vu');
      if (won && String(record.variant || 'texas-holdem') === 'texas-holdem' && isSevenDeuceOffsuit(p.cards?.hole)) {
        const wins = await lookup('7-2 wins', 1, () => sevenDeuceWins(pool, p.id));
        earned.push(...hammerTiers(Math.max(1, wins)));
      }
      if (needsHistory(record, p)) {
        const past = await lookup('earlier hands', [] as PastHand[], () => pastHandsAtTable(pool, record.roomId, p.id));
        earned.push(...historyAchievements(record, p, past));
      }
      for (const type of earned) await awardOnce(pool, p.id, type, meta);
    } catch (err) {
      console.warn(`[hand-records] Statistics update failed for ${p.id}:`, err);
    }
  }
}

/** What the achievements need from the final state that the hand record doesn't keep. */
export function handExtras(state: TableState): HandExtras {
  const splash = state.lastSplash;
  const splashedThisHand = !!splash && typeof state.handStartedAt === 'number' && splash.at >= state.handStartedAt;
  const runs = state.runItTwice?.results || [];
  return {
    hiLo: state.lastHiLoResult || null,
    runWinners: runs.length > 1 ? runs.map(r => (r.winners || []).map(w => w.playerId)) : undefined,
    splashedBy: splashedThisHand ? [splash!.playerId] : undefined,
  };
}

// Hands this server instance has already finished, so repeated calls for one hand are cheap
const finishedHands = new Set<string>();

/**
 * Everything that happens once when a hand ends: store it, update statistics and achievements,
 * and post the result to chat. Safe to call more than once for the same hand, from any instance:
 * only the request that stores the hand does the rest.
 */
export async function finishHand(tableId: string, state: TableState): Promise<void> {
  if (state.stage !== 'showdown') return;
  const key = state.handId || `${tableId}:${state.turnSeq}`;
  if (finishedHands.has(key)) return;
  finishedHands.add(key);
  if (finishedHands.size > 5000) finishedHands.clear();

  const record = buildHandRecord(tableId, state);
  let firstToFinish = true;
  if (record) {
    try {
      const pool = getPool();
      firstToFinish = await saveHandRecord(pool, record);
      if (firstToFinish) await applyHandToStatistics(pool, record, handExtras(state));
    } catch (err) {
      // No database (e.g. local runs): still post to chat from this instance
      console.warn('[hand-records] Could not store hand:', err);
    }
  }
  if (!firstToFinish) return;
  try {
    await postHandResultToChat(tableId, state);
  } catch (chatError) {
    console.warn('Failed to post hand result to chat:', chatError);
  }
}

/** A player showed their cards after the hand; let everyone in the hand see them in history too. */
export async function markCardsShown(handId: string, playerId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE hand_records
     SET players = (
       SELECT jsonb_agg(CASE WHEN elem->>'id' = $2 THEN elem || '{"revealed": true}'::jsonb ELSE elem END)
       FROM jsonb_array_elements(players) elem
     )
     WHERE id = $1`,
    [handId, playerId]
  );
}

/**
 * A 7-2 bounty paid after the hand was stored (the winner showed their cards once it was over):
 * add the bounty to the stored hand's actions and end stacks, and announce it in chat. A bounty
 * paid at showdown is already part of the record and of the hand result message.
 */
export async function recordLateSevenDeuceBounty(tableId: string, state: TableState): Promise<void> {
  const bounty = state.sevenDeuceResult;
  if (!bounty || !state.handId) return;
  try {
    const pool = getPool();
    const found = await pool.query('SELECT players, actions FROM hand_records WHERE id = $1', [state.handId]);
    const row = found.rows?.[0];
    if (row) {
      const players = parseJson<HandRecordPlayer[]>(row.players, []);
      const actions = parseJson<TableState['handActions']>(row.actions, []) || [];
      // Saved once per hand: skip if this bounty is already in the record
      if (!actions.some(a => a.action === 'bounty')) {
        const bountyActions = (state.handActions || []).filter(a => a.action === 'bounty');
        const updated = players.map(p => {
          const live = state.players.find(sp => sp.id === p.id);
          // The winner's cards were just shown; set it here too so this write can't undo
          // markCardsShown running at the same time
          const revealed = p.id === bounty.playerId ? true : p.revealed;
          return live ? { ...p, revealed, endStack: live.stack, net: live.stack - p.startStack } : p;
        });
        await pool.query('UPDATE hand_records SET players = $2, actions = $3 WHERE id = $1', [
          state.handId,
          JSON.stringify(updated),
          JSON.stringify([...actions, ...bountyActions]),
        ]);
      }
    }
  } catch (err) {
    console.warn('[hand-records] Could not add the 7-2 bounty to the stored hand:', err);
  }
  const line = formatSevenDeuceBounty(state);
  if (line) {
    try {
      await postSystemChatMessage(tableId, line);
    } catch (err) {
      console.warn('Failed to post the 7-2 bounty to chat:', err);
    }
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

export function rowToHandRecord(row: any): HandRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    handNumber: Number(row.hand_number),
    variant: row.variant || 'texas-holdem',
    kind: row.kind === 'bomb-pot' ? 'bomb-pot' : 'normal',
    smallBlind: Number(row.small_blind),
    bigBlind: Number(row.big_blind),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    endedAt: new Date(row.ended_at).toISOString(),
    board: parseJson(row.board, []),
    runBoards: row.run_boards ? parseJson(row.run_boards, undefined) : undefined,
    players: parseJson(row.players, []),
    actions: parseJson(row.actions, []),
    winners: parseJson(row.winners, []),
    pot: Number(row.pot),
    bettingMode: isBettingMode(row.betting_mode) ? row.betting_mode : undefined,
    buttonSeat: row.button_seat == null ? undefined : Number(row.button_seat),
  };
}

/** The record as one viewer may see it: their own cards, and others' only if shown at the table. */
export function redactHandRecord(record: HandRecord, viewerId: string): HandRecord {
  return {
    ...record,
    players: record.players.map(p => {
      if (p.id === viewerId || p.revealed) return p;
      // Stud up cards were face up for everyone
      const up = p.cards?.up;
      const { cards: _hidden, ...rest } = p;
      return up?.length ? { ...rest, cards: { up } } : rest;
    }),
  };
}

export function summarizeHand(record: HandRecord, viewerId: string): HandSummary {
  const names = new Map(record.players.map(p => [p.id, p.name]));
  const me = record.players.find(p => p.id === viewerId);
  return {
    id: record.id,
    roomId: record.roomId,
    handNumber: record.handNumber,
    variant: record.kind === 'bomb-pot' ? `${record.variant} (bomb pot)` : record.variant,
    endedAt: record.endedAt,
    pot: record.pot,
    bigBlind: record.bigBlind,
    winners: record.winners.map(w => ({ ...w, name: names.get(w.playerId) || w.playerId.slice(0, 6) })),
    myNet: me?.net ?? 0,
    myCards: me?.cards,
  };
}
