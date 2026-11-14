/**
 * Settling side bets when a hand ends, and the side-bet ledger. Side bets are separate money:
 * nothing here touches a chip stack. See src/lib/shared/side-bets.ts for the games themselves.
 *
 * Bets settle one of two ways:
 * - Straight up (best suit, flop color): the losers each pay the stake and the winners split it.
 * - From a pot (high card bingo, bad beat): each hand the players in put the stake in the pot,
 *   which carries over until someone wins it. What is in a pot is only owed once it is won; a
 *   pot nobody wins by the end of the night costs nobody anything.
 */
import type { Pool, PoolClient } from 'pg';
import { getPool } from '../database/pool';
import { HandRank } from '../../types/poker';
import type { Card, TableState } from '../../types/poker';
import type { HandRecord, HandRecordPlayer } from '../../types/hand-record';
import { hasBuiltInWilds } from '../poker/variant-rules';
import { showdownRanking } from './achievement-checks';
import {
  BAD_BEAT_LOSER_SHARE, FLOP_LINE, POOL_BETS, SIDE_BET_INFO, SUIT_SYMBOLS, bestSuitForHand, cardValue, formatMoney,
  isSideBetKey, parseSideBetStakes,
  type PoolBetKey, type SideBetKey, type SideBetStakes,
} from '../shared/side-bets';

export interface SideBetParticipant {
  playerId: string;
  name: string;
  pick: string | null;
}

/** One player's unpaid share of a pot. */
export interface PoolShare {
  playerId: string;
  name: string;
  amount: number;
}

export interface SideBetEntry {
  bet: SideBetKey;
  playerId: string;
  name: string;
  // Won (positive) or lost (negative) on this bet this hand
  amount: number;
  note: string;
}

export interface SideBetHandInput {
  record: HandRecord;
  stakes: SideBetStakes;
  // Who was in each bet when the hand started (and was dealt in), with their picks
  participants: Partial<Record<SideBetKey, SideBetParticipant[]>>;
  pools: Partial<Record<PoolBetKey, PoolShare[]>>;
  // Wild cards were in play this hand
  wild: boolean;
}

export interface SideBetOutcome {
  entries: SideBetEntry[];
  // Every pot as it stands after the hand (an empty list for a pot that was won)
  pools: Record<PoolBetKey, PoolShare[]>;
  // Changed pots, so only those are written back
  changedPools: PoolBetKey[];
  messages: string[];
}

const RED = new Set(['hearts', 'diamonds']);
const cents = (dollars: number) => Math.round(dollars * 100);
const dollars = (c: number) => c / 100;
const names = (ps: Array<{ name: string }>) => ps.map(p => p.name).join(', ');

function cardsOf(p: HandRecordPlayer): Card[] {
  return [...(p.cards?.hole || []), ...(p.cards?.down || []), ...(p.cards?.up || [])].filter(c => c && c.suit && c.rank);
}

/**
 * Split `totalCents` among winners as evenly as cents allow; the first winners (in seat order)
 * get any odd cents.
 */
function splitCents(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  const extra = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Losers each pay the stake; the winners split what they paid. */
function settleStraightUp(
  bet: SideBetKey, winners: SideBetParticipant[], losers: SideBetParticipant[], stake: number, note: string,
): SideBetEntry[] {
  if (winners.length === 0 || losers.length === 0) return [];
  const stakeCents = cents(stake);
  const shares = splitCents(stakeCents * losers.length, winners.length);
  return [
    ...winners.map((w, i) => ({ bet, playerId: w.playerId, name: w.name, amount: dollars(shares[i]), note })),
    ...losers.map(l => ({ bet, playerId: l.playerId, name: l.name, amount: -stake, note })),
  ];
}

/** Add each player's stake to a pot. */
function addToPool(pool: PoolShare[], players: SideBetParticipant[], stake: number): PoolShare[] {
  const next = pool.map(s => ({ ...s }));
  for (const p of players) {
    const share = next.find(s => s.playerId === p.playerId);
    if (share) {
      share.amount = dollars(cents(share.amount) + cents(stake));
      share.name = p.name;
    } else {
      next.push({ playerId: p.playerId, name: p.name, amount: stake });
    }
  }
  return next;
}

/**
 * Pay out a pot: everyone who put money in owes their share, and the winners are paid by weight.
 * Returns one net entry per player.
 */
function payPool(bet: SideBetKey, pool: PoolShare[], winners: Array<{ playerId: string; name: string; weight: number }>, note: string): SideBetEntry[] {
  const net = new Map<string, { name: string; cents: number }>();
  const add = (playerId: string, name: string, c: number) => {
    const cur = net.get(playerId) || { name, cents: 0 };
    cur.cents += c;
    net.set(playerId, cur);
  };
  let totalCents = 0;
  for (const s of pool) {
    totalCents += cents(s.amount);
    add(s.playerId, s.name, -cents(s.amount));
  }
  const totalWeight = winners.reduce((sum, w) => sum + w.weight, 0);
  let paid = 0;
  winners.forEach((w, i) => {
    const share = i === winners.length - 1 ? totalCents - paid : Math.floor((totalCents * w.weight) / totalWeight);
    paid += share;
    add(w.playerId, w.name, share);
  });
  return Array.from(net.entries())
    .filter(([, v]) => v.cents !== 0)
    .map(([playerId, v]) => ({ bet, playerId, name: v.name, amount: dollars(v.cents), note }));
}

const poolTotal = (pool: PoolShare[]) => dollars(pool.reduce((sum, s) => sum + cents(s.amount), 0));

// Games where four of a kind at showdown means something: high hands, no wild cards
const BAD_BEAT_VARIANTS = ['texas-holdem', 'omaha', 'omaha-5', 'seven-card-stud', 'five-card-stud'];

/** Settle every side bet that was on for a finished hand. Pure: the caller loads and saves. */
export function settleSideBets(input: SideBetHandInput): SideBetOutcome {
  const { record, stakes } = input;
  const entries: SideBetEntry[] = [];
  const messages: string[] = [];
  const pools: Record<PoolBetKey, PoolShare[]> = {
    'high-card-bingo': input.pools['high-card-bingo'] || [],
    'bad-beat': input.pools['bad-beat'] || [],
  };
  const changedPools: PoolBetKey[] = [];
  const seatOf = new Map(record.players.map(p => [p.id, p.seat]));
  const inBet = (bet: SideBetKey) => (input.participants[bet] || [])
    .filter(p => seatOf.has(p.playerId))
    .sort((a, b) => (seatOf.get(a.playerId) ?? 0) - (seatOf.get(b.playerId) ?? 0));
  const board = (record.board || []).filter(c => c && c.suit && c.rank);

  // Best suit: most of this hand's suit by value, from each player's own cards
  const bestSuitStake = stakes['best-suit'];
  const bestSuitPlayers = inBet('best-suit');
  if (bestSuitStake && bestSuitPlayers.length >= 2) {
    const suit = bestSuitForHand(record.handNumber);
    const byId = new Map(record.players.map(p => [p.id, p]));
    const scores = bestSuitPlayers.map(p => ({
      p,
      score: cardsOf(byId.get(p.playerId)!).filter(c => c.suit === suit).reduce((sum, c) => sum + cardValue(c.rank), 0),
    }));
    const top = Math.max(...scores.map(s => s.score));
    if (top > 0) {
      const winners = scores.filter(s => s.score === top).map(s => s.p);
      const losers = scores.filter(s => s.score !== top).map(s => s.p);
      const label = `Best ${SUIT_SYMBOLS[suit]}`;
      const settled = settleStraightUp('best-suit', winners, losers, bestSuitStake, label);
      if (settled.length) {
        entries.push(...settled);
        messages.push(`${label}: ${names(winners)} ${winners.length > 1 ? 'split' : 'wins'} ${formatMoney(bestSuitStake * losers.length)}`);
      }
    }
  }

  // Flop color: callers who got it right split the stakes of those who didn't
  const flopStake = stakes['flop-color'];
  const flopPlayers = inBet('flop-color').filter(p => p.pick);
  if (flopStake && flopPlayers.length >= 2 && board.length >= 3) {
    const reds = board.slice(0, 3).filter(c => RED.has(c.suit)).length;
    const color = reds === 3 ? 'red' : reds === 0 ? 'black' : 'mixed';
    const winners = flopPlayers.filter(p => p.pick === color);
    const losers = flopPlayers.filter(p => p.pick !== color);
    const label = `Flop color (${color})`;
    const settled = settleStraightUp('flop-color', winners, losers, flopStake, label);
    if (settled.length) {
      entries.push(...settled);
      messages.push(`${label}: ${names(winners)} ${winners.length > 1 ? 'split' : 'wins'} ${formatMoney(flopStake * losers.length)}`);
    }
  }

  // Flop over/under: the flop's total against the line; exactly on the line is a push
  const overUnderStake = stakes['flop-over-under'];
  const overUnderPlayers = inBet('flop-over-under').filter(p => p.pick);
  if (overUnderStake && overUnderPlayers.length >= 2 && board.length >= 3) {
    const total = board.slice(0, 3).reduce((sum, c) => sum + cardValue(c.rank), 0);
    if (total !== FLOP_LINE) {
      const call = total > FLOP_LINE ? 'over' : 'under';
      const winners = overUnderPlayers.filter(p => p.pick === call);
      const losers = overUnderPlayers.filter(p => p.pick !== call);
      const label = `Flop ${call} ${FLOP_LINE} (${total})`;
      const settled = settleStraightUp('flop-over-under', winners, losers, overUnderStake, label);
      if (settled.length) {
        entries.push(...settled);
        messages.push(`${label}: ${names(winners)} ${winners.length > 1 ? 'split' : 'wins'} ${formatMoney(overUnderStake * losers.length)}`);
      }
    }
  }

  // Pocket pair bonus: each player dealt a pair collects the stake (double for aces) from each
  // player in without one
  const pairStake = stakes['pocket-pair'];
  const pairPlayers = inBet('pocket-pair');
  if (pairStake && pairPlayers.length >= 2) {
    const byId = new Map(record.players.map(p => [p.id, p]));
    const pairRank = (p: SideBetParticipant): string | null => {
      const hole = byId.get(p.playerId)?.cards?.hole || [];
      return hole.length === 2 && hole[0]?.rank && hole[0].rank === hole[1]?.rank ? hole[0].rank : null;
    };
    const holders = pairPlayers.filter(p => pairRank(p));
    const payers = pairPlayers.filter(p => !pairRank(p));
    if (holders.length && payers.length) {
      const net = new Map<string, number>();
      const add = (id: string, c: number) => net.set(id, (net.get(id) || 0) + c);
      for (const h of holders) {
        const each = cents(pairStake) * (pairRank(h) === 'A' ? 2 : 1);
        add(h.playerId, each * payers.length);
        for (const payer of payers) add(payer.playerId, -each);
      }
      for (const p of pairPlayers) {
        const c = net.get(p.playerId) || 0;
        const rank = pairRank(p);
        if (c !== 0) entries.push({ bet: 'pocket-pair', playerId: p.playerId, name: p.name, amount: dollars(c), note: rank ? `Pocket ${rank}s` : 'Pocket pair bonus' });
      }
      for (const h of holders) {
        const won = dollars(cents(pairStake) * (pairRank(h) === 'A' ? 2 : 1) * payers.length);
        messages.push(`Pocket pair bonus: ${h.name} had pocket ${pairRank(h)}s and collects ${formatMoney(won)}`);
      }
    }
  }

  // Next hand winner: players whose pick won any of the pot split the stakes of those whose pick
  // didn't. A pick only counts when that player was dealt in
  const pickStake = stakes['next-hand-winner'];
  const pickPlayers = inBet('next-hand-winner').filter(p => p.pick && seatOf.has(p.pick));
  if (pickStake && pickPlayers.length >= 2) {
    const winnerIds = new Set(record.players.filter(p => p.won > 0).map(p => p.id));
    const winners = pickPlayers.filter(p => winnerIds.has(p.pick!));
    const losers = pickPlayers.filter(p => !winnerIds.has(p.pick!));
    const potWinners = record.players.filter(p => winnerIds.has(p.id));
    const label = `Next hand winner (${names(potWinners)})`;
    const settled = settleStraightUp('next-hand-winner', winners, losers, pickStake, label);
    if (settled.length) {
      entries.push(...settled);
      messages.push(`${label}: ${names(winners)} ${winners.length > 1 ? 'split' : 'wins'} ${formatMoney(pickStake * losers.length)}`);
    }
  }

  // High card bingo: everyone with a rank adds to the pot; the first matching board card wins it
  const bingoStake = stakes['high-card-bingo'];
  const bingoPlayers = inBet('high-card-bingo').filter(p => p.pick);
  if (bingoStake && bingoPlayers.length >= 2 && board.length > 0) {
    pools['high-card-bingo'] = addToPool(pools['high-card-bingo'], bingoPlayers, bingoStake);
    changedPools.push('high-card-bingo');
    const hit = board.find(c => bingoPlayers.some(p => p.pick === c.rank));
    if (hit) {
      const winners = bingoPlayers.filter(p => p.pick === hit.rank);
      const total = poolTotal(pools['high-card-bingo']);
      const label = `High card bingo (${hit.rank}${SUIT_SYMBOLS[hit.suit]})`;
      entries.push(...payPool('high-card-bingo', pools['high-card-bingo'], winners.map(w => ({ ...w, weight: 1 })), label));
      pools['high-card-bingo'] = [];
      messages.push(`${label}: ${names(winners)} ${winners.length > 1 ? 'split' : 'wins'} the ${formatMoney(total)} pot`);
    }
  }

  // Bad beat jackpot
  const badBeatStake = stakes['bad-beat'];
  const badBeatPlayers = inBet('bad-beat');
  const variant = String(record.variant || 'texas-holdem');
  if (badBeatStake && badBeatPlayers.length >= 2 && !input.wild && BAD_BEAT_VARIANTS.includes(variant)) {
    pools['bad-beat'] = addToPool(pools['bad-beat'], badBeatPlayers, badBeatStake);
    changedPools.push('bad-beat');
    const inIds = new Set(badBeatPlayers.map(p => p.playerId));
    const atShowdown = record.players.filter(p => !p.folded);
    if (atShowdown.length >= 2) {
      const ranked = atShowdown.map(p => ({ p, rank: showdownRanking(record, p)?.rank ?? 0 }));
      const losers = ranked.filter(r => !(r.p.won > 0) && r.rank >= HandRank.FourOfAKind && inIds.has(r.p.id));
      if (losers.length > 0) {
        const bestLoss = Math.max(...losers.map(l => l.rank));
        const beaten = losers.filter(l => l.rank === bestLoss).map(l => l.p);
        const winners = ranked.filter(r => r.p.won > 0 && inIds.has(r.p.id));
        const topWin = Math.max(0, ...winners.map(w => w.rank));
        const topWinners = winners.filter(w => w.rank === topWin).map(w => w.p);
        // With no winner in the jackpot, the beaten player takes all of it
        const loserWeight = topWinners.length ? BAD_BEAT_LOSER_SHARE : 1;
        const paid = [
          ...beaten.map(p => ({ playerId: p.id, name: p.name, weight: loserWeight / beaten.length })),
          ...topWinners.map(p => ({ playerId: p.id, name: p.name, weight: (1 - BAD_BEAT_LOSER_SHARE) / topWinners.length })),
        ];
        const total = poolTotal(pools['bad-beat']);
        entries.push(...payPool('bad-beat', pools['bad-beat'], paid, 'Bad beat jackpot'));
        pools['bad-beat'] = [];
        messages.push(`Bad beat jackpot! ${names(beaten)} lost with ${bestLoss >= HandRank.StraightFlush ? 'a straight flush' : 'four of a kind'} and ${beaten.length > 1 ? 'split' : 'takes'} the bigger share of ${formatMoney(total)}${topWinners.length ? `; ${names(topWinners)} get the rest` : ''}`);
      }
    }
  }

  return { entries, pools, changedPools, messages };
}

// ---- Database ----

type Queryable = Pick<Pool, 'query'> | PoolClient;

/** Who is in each side bet as of the hand's start, among the players dealt into it. */
export async function loadHandParticipants(db: Queryable, roomId: string, handStart: string): Promise<Partial<Record<SideBetKey, SideBetParticipant[]>>> {
  // A change made after the hand started counts from the next hand: until then the row's prev_ values hold
  const result = await db.query(
    `SELECT player_id, player_name, bet,
            CASE WHEN updated_at <= $2 THEN active ELSE prev_active END AS active,
            CASE WHEN updated_at <= $2 THEN pick ELSE prev_pick END AS pick
     FROM side_bet_players WHERE room_id = $1`,
    [roomId, handStart]
  );
  const out: Partial<Record<SideBetKey, SideBetParticipant[]>> = {};
  for (const r of result.rows as any[]) {
    if (!r.active || !isSideBetKey(r.bet)) continue;
    (out[r.bet as SideBetKey] ||= []).push({ playerId: String(r.player_id), name: r.player_name || String(r.player_id).slice(0, 6), pick: r.pick ?? null });
  }
  return out;
}

export async function loadPools(db: Queryable, roomId: string): Promise<Record<PoolBetKey, PoolShare[]>> {
  const result = await db.query(`SELECT bet, player_id, player_name, amount FROM side_bet_pools WHERE room_id = $1`, [roomId]);
  const pools: Record<PoolBetKey, PoolShare[]> = { 'high-card-bingo': [], 'bad-beat': [] };
  for (const r of result.rows as any[]) {
    if (!(POOL_BETS as readonly string[]).includes(r.bet)) continue;
    pools[r.bet as PoolBetKey].push({ playerId: String(r.player_id), name: r.player_name || String(r.player_id).slice(0, 6), amount: Number(r.amount) });
  }
  return pools;
}

/**
 * Settle the side bets of a hand that has just been stored, and return the lines to post in chat.
 * Runs once per hand (finishHand calls it only from the request that stored the hand); the
 * unique index on entries keeps a hand from being paid twice even so.
 */
export async function settleHandSideBets(pool: Pool, record: HandRecord, state: TableState, configuration: Record<string, unknown> | null): Promise<string[]> {
  const stakes = parseSideBetStakes(configuration?.sideBets);
  if (Object.keys(stakes).length === 0) return [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One settlement at a time per room, so pots are read and written in order
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`side-bets:${record.roomId}`]);
    const participants = await loadHandParticipants(client, record.roomId, record.startedAt || record.endedAt);
    const pools = await loadPools(client, record.roomId);
    const outcome = settleSideBets({
      record,
      stakes,
      participants,
      pools,
      wild: !!state.wildRule || hasBuiltInWilds(record.variant),
    });
    for (const e of outcome.entries) {
      await client.query(
        `INSERT INTO side_bet_entries (room_id, hand_id, hand_number, bet, player_id, player_name, amount, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (hand_id, bet, player_id) DO NOTHING`,
        [record.roomId, record.id, record.handNumber, e.bet, e.playerId, e.name, e.amount, e.note]
      );
    }
    for (const bet of outcome.changedPools) {
      await client.query('DELETE FROM side_bet_pools WHERE room_id = $1 AND bet = $2', [record.roomId, bet]);
      for (const s of outcome.pools[bet]) {
        await client.query(
          'INSERT INTO side_bet_pools (room_id, bet, player_id, player_name, amount) VALUES ($1, $2, $3, $4, $5)',
          [record.roomId, bet, s.playerId, s.name, s.amount]
        );
      }
    }
    await client.query('COMMIT');
    return outcome.messages;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Join, leave or change a pick in a side bet. When a hand is in play, the row remembers how it
 * stood when that hand started (prev_active, prev_pick) so the change counts from the next hand.
 */
export async function setSideBetPlayer(db: Queryable, args: {
  roomId: string; playerId: string; playerName: string; bet: SideBetKey; active: boolean; pick: string | null; handStartedAt: number | null;
}): Promise<void> {
  // Without a hand in play the previous values never matter; keep them equal to the new ones
  const handStart = args.handStartedAt ? new Date(args.handStartedAt).toISOString() : null;
  await db.query(
    `INSERT INTO side_bet_players (room_id, player_id, bet, player_name, active, pick, prev_active, prev_pick, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::timestamptz IS NULL THEN $5 ELSE FALSE END, CASE WHEN $7::timestamptz IS NULL THEN $6 ELSE NULL END, NOW())
     ON CONFLICT (room_id, player_id, bet) DO UPDATE SET
       prev_active = CASE
         WHEN $7::timestamptz IS NULL THEN EXCLUDED.active
         WHEN side_bet_players.updated_at <= $7::timestamptz THEN side_bet_players.active
         ELSE side_bet_players.prev_active END,
       prev_pick = CASE
         WHEN $7::timestamptz IS NULL THEN EXCLUDED.pick
         WHEN side_bet_players.updated_at <= $7::timestamptz THEN side_bet_players.pick
         ELSE side_bet_players.prev_pick END,
       player_name = COALESCE(NULLIF(EXCLUDED.player_name, ''), side_bet_players.player_name),
       active = EXCLUDED.active,
       pick = EXCLUDED.pick,
       updated_at = NOW()`,
    [args.roomId, args.playerId, args.bet, args.playerName, args.active, args.pick, handStart]
  );
}

export interface SideBetLedgerEntry {
  handId: string;
  handNumber: number;
  bet: SideBetKey;
  playerId: string;
  playerName: string | null;
  amount: number;
  note: string;
  createdAt: string;
}

/** Every side bet won or lost at the table. Empty when the database has no side-bet tables yet. */
export async function loadSideBetLedger(roomId: string): Promise<SideBetLedgerEntry[]> {
  try {
    const result = await getPool().query(
      `SELECT hand_id, hand_number, bet, player_id, player_name, amount, note, created_at
       FROM side_bet_entries WHERE room_id = $1 ORDER BY created_at`,
      [roomId]
    );
    return result.rows
      .filter((r: any) => isSideBetKey(r.bet))
      .map((r: any) => ({
        handId: String(r.hand_id),
        handNumber: Number(r.hand_number) || 0,
        bet: r.bet,
        playerId: String(r.player_id),
        playerName: r.player_name,
        amount: Number(r.amount),
        note: r.note || SIDE_BET_INFO[r.bet as SideBetKey].name,
        createdAt: new Date(r.created_at).toISOString(),
      }));
  } catch (err: any) {
    if (err?.code === '42P01') return [];
    throw err;
  }
}
