/**
 * Rare and fun moments in a finished hand, worked out from the stored hand record. Pure
 * functions: the database lookups some of them need are done by the caller (hand-records.ts).
 */
import { HandEvaluator } from '../poker/hand-evaluator';
import type { Card, HandRanking } from '../../types/poker';
import { HandRank } from '../../types/poker';
import type { HandInterface } from '../../types/poker-engine';
import type { HandRecord, HandRecordPlayer } from '../../types/hand-record';

/** What the hand record doesn't keep but some achievements need, taken from the final state. */
export interface HandExtras {
  // Hi-lo games: who won each half
  hiLo?: { high: Array<{ playerId: string }>; low: Array<{ playerId: string }> | null } | null;
  // Hands run more than once: the winners of each run
  runWinners?: string[][];
  // Players who splashed the pot during this hand
  splashedBy?: string[];
}

/** One of a player's earlier hands at the same table, newest first, for streaks and sessions. */
export interface PastHand {
  handId: string;
  startedAt: string | null;
  endedAt: string;
  bigBlind: number;
  variant: string;
  me: Pick<HandRecordPlayer, 'startStack' | 'endStack' | 'net' | 'won' | 'folded' | 'cards'>;
}

// Hands two hours apart are separate sessions, as on the statistics page
export const SESSION_GAP_MS = 2 * 60 * 60 * 1000;
export const HEATER_WINS = 5;
export const PATIENT_FOLDS = 50;
export const ACES_CRACKED_TIMES = 3;
export const HAMMER_TIERS: Array<[number, string]> = [[1, 'hammer'], [7, 'hammer_7'], [72, 'hammer_72']];

const SUITS: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: Card['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const cardKey = (c: Card) => `${c.rank}${c.suit}`;

const variantOf = (record: HandRecord) => String(record.variant || 'texas-holdem');
const isOmaha = (record: HandRecord) => variantOf(record).startsWith('omaha');
const isHiLo = (record: HandRecord) => variantOf(record).endsWith('hi-lo');
// Board games played for the high hand only, where the turn and river can be replayed
const isBoardHigh = (record: HandRecord) => ['texas-holdem', 'omaha', 'omaha-5'].includes(variantOf(record));
const isHighStud = (record: HandRecord) => ['seven-card-stud', 'five-card-stud'].includes(variantOf(record));

function validCards(cards: unknown[] | undefined): Card[] {
  return (cards || []).filter((c): c is Card => {
    const card = c as Card;
    return !!card && RANKS.includes(card.rank) && SUITS.includes(card.suit);
  });
}

function allCards(p: HandRecordPlayer): Card[] {
  return validCards([...(p.cards?.hole || []), ...(p.cards?.down || []), ...(p.cards?.up || [])]);
}

const holeOf = (p: HandRecordPlayer) => validCards(p.cards?.hole);
const contested = (record: HandRecord) => record.players.filter(p => !p.folded).length >= 2;
const atShowdown = (record: HandRecord, p: HandRecordPlayer) => contested(record) && !p.folded;

/** Best high hand a player held, for Hold'em, Omaha and high stud. Null when it can't be judged. */
export function showdownRanking(record: HandRecord, player: HandRecordPlayer, board: Card[] = record.board): HandRanking | null {
  try {
    if (isHighStud(record)) {
      const cards = allCards(player);
      return cards.length >= 5 ? HandEvaluator.getHandRanking(cards, []) : null;
    }
    const hole = player.cards?.hole;
    if (!hole?.length || board.length < 3) return null;
    return isOmaha(record)
      ? HandEvaluator.getOmahaHandRanking(hole, board)
      : HandEvaluator.getHandRanking(hole, board);
  } catch {
    return null;
  }
}

export function isSevenDeuceOffsuit(hole: unknown[] | undefined): boolean {
  const cards = validCards(hole);
  if (cards.length !== 2 || (hole?.length ?? 0) !== 2) return false;
  const ranks = cards.map(c => c.rank).sort().join('');
  return ranks === '27' && cards[0].suit !== cards[1].suit;
}

export function isPocketAces(hole: unknown[] | undefined): boolean {
  const cards = validCards(hole);
  return cards.length === 2 && cards.every(c => c.rank === 'A');
}

// The evaluator writes the ace of a 5-high straight as rank '1'
const sortedRanks = (cards: Card[]) => cards.map(c => (String(c.rank) === '1' ? 'A' : c.rank)).sort().join(',');
const WHEEL = sortedRanks(['A', '2', '3', '4', '5'].map(rank => ({ rank, suit: 'spades' } as Card)));

/** Three or more hole cards of one rank, which Omaha can't use more than two of. */
export function holdsTrips(hole: unknown[] | undefined): boolean {
  const counts = new Map<string, number>();
  for (const card of validCards(hole)) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  return Array.from(counts.values()).some(n => n >= 3);
}

/** Made A-2-3-4-5 as their low: razz, or the low half of a hi-lo game. */
function hasBicycle(record: HandRecord, p: HandRecordPlayer): boolean {
  const variant = variantOf(record);
  try {
    if (variant === 'razz') {
      const [category, ...ranks] = HandEvaluator.razzLowKey(allCards(p));
      return category === 0 && [...ranks].sort((a, b) => a - b).join() === '1,2,3,4,5';
    }
    const low = variant === 'omaha-hi-lo'
      ? HandEvaluator.evaluateOmahaLowEightOrBetter(holeOf(p), record.board)
      : variant === 'seven-card-stud-hi-lo'
        ? HandEvaluator.evaluateAceToFiveLow(allCards(p))
        : null;
    return !!low && [...low.ranks].sort((a, b) => a - b).join() === '1,2,3,4,5';
  } catch {
    return false;
  }
}

/**
 * How many possible river cards would have given this player at least a share of the pot, with
 * every other showdown player's cards known. Cards dealt to anyone, folded or not, can't come.
 */
export function savingRivers(record: HandRecord, p: HandRecordPlayer): number | null {
  if (!isBoardHigh(record) || record.runBoards || record.board.length !== 5) return null;
  const need = isOmaha(record) ? 4 : 2;
  const rivals = record.players.filter(o => o.id !== p.id && !o.folded);
  const mine = holeOf(p);
  if (mine.length < need || rivals.length === 0 || rivals.some(o => holeOf(o).length < need)) return null;
  const turn = record.board.slice(0, 4);
  const dealt = new Set([...turn, ...record.board, ...record.players.flatMap(allCards)].map(cardKey));
  // The river that came is a possible river too
  dealt.delete(cardKey(record.board[4]));
  const evaluate = (hole: Card[], board: Card[]): HandInterface => (isOmaha(record)
    ? HandEvaluator.evaluateOmahaHand(hole, board)
    : HandEvaluator.evaluateHand(hole, board)).hand;
  let saves = 0;
  try {
    for (const suit of SUITS) for (const rank of RANKS) {
      const river = { suit, rank };
      if (dealt.has(cardKey(river))) continue;
      const board = [...turn, river];
      const me = evaluate(mine, board);
      if (rivals.every(o => HandEvaluator.compareHands(me, evaluate(holeOf(o), board)) >= 0)) saves += 1;
    }
  } catch {
    return null;
  }
  return saves;
}

/** Achievements earned from this hand alone. */
export function handAchievements(record: HandRecord, p: HandRecordPlayer, extras: HandExtras = {}): string[] {
  const earned: string[] = [];
  const won = p.won > 0;
  const showdown = atShowdown(record, p);
  const variant = variantOf(record);
  const hole = holeOf(p);
  const ranking = showdown ? showdownRanking(record, p) : null;
  const rank = ranking?.rank ?? null;

  if (won && variant === 'texas-holdem' && isSevenDeuceOffsuit(p.cards?.hole) && showdown) earned.push('hammer_showdown');

  if (won && showdown && ranking) {
    const pairs = new Map<string, number>();
    ranking.cards.forEach(c => pairs.set(c.rank, (pairs.get(c.rank) || 0) + 1));
    const holeRanks = new Set(hole.map(c => c.rank));
    if (rank === HandRank.TwoPair && pairs.get('A') === 2 && pairs.get('8') === 2 && holeRanks.has('A') && holeRanks.has('8')) {
      earned.push('dead_mans_hand');
    }
    const five = sortedRanks(ranking.cards);
    if (rank === HandRank.Straight && five === WHEEL) earned.push('wheel');
    if (rank === HandRank.StraightFlush && five === WHEEL) earned.push('steel_wheel');
  }

  if (won && showdown && hasBicycle(record, p)) {
    const wonLow = !extras.hiLo || variant === 'razz' || !!extras.hiLo.low?.some(w => w.playerId === p.id);
    if (wonLow) earned.push('bicycle');
  }

  // Lost at showdown with a monster; run-it-twice boards aren't judged
  if (showdown && !won && !record.runBoards && rank !== null) {
    if (rank >= HandRank.FullHouse) earned.push('bad_beat');
    if (rank >= HandRank.FourOfAKind) earned.push('cooler');
  }

  if (won && showdown && savingRivers(record, p) === 1) earned.push('one_outer');

  if (won && showdown && isBoardHigh(record) && !record.runBoards && record.board.length === 5 && rank !== null) {
    const made = [HandRank.Straight, HandRank.Flush, HandRank.StraightFlush, HandRank.RoyalFlush].includes(rank);
    const b = record.board;
    const withTurn = showdownRanking(record, p, b.slice(0, 4))?.rank ?? HandRank.Straight;
    const withRiver = showdownRanking(record, p, [b[0], b[1], b[2], b[4]])?.rank ?? HandRank.Straight;
    if (made && withTurn < HandRank.Straight && withRiver < HandRank.Straight) earned.push('runner_runner');
  }

  if (won && showdown && variant === 'texas-holdem' && record.board.length === 5 && record.winners.length >= 2) {
    try {
      const boardRank = HandEvaluator.getHandRanking([], record.board).rank;
      if (boardRank === HandRank.FourOfAKind || boardRank === HandRank.RoyalFlush) earned.push('board_plays');
    } catch { /* unreadable board */ }
  }

  if (won && showdown && !isHiLo(record) && !record.runBoards && record.winners.length >= 3) {
    const amounts = record.winners.map(w => w.amount);
    // Equal shares, give or take the odd chips
    if (Math.max(...amounts) - Math.min(...amounts) <= record.winners.length) earned.push('three_way_chop');
  }

  if (won && showdown && isHiLo(record) && extras.hiLo?.low?.length) {
    const winners = new Set([...extras.hiLo.high, ...extras.hiLo.low].map(w => w.playerId));
    const high = extras.hiLo.high.some(w => w.playerId === p.id);
    const low = extras.hiLo.low.some(w => w.playerId === p.id);
    if (high && low && winners.size === 1) earned.push('scoop');
  }

  const runs = extras.runWinners || [];
  if (won && record.runBoards && runs.length >= 2 && runs.every(r => r.length === 1 && r[0] === p.id)) {
    earned.push('double_trouble');
  }

  if (won) {
    const busted = record.players.filter(o => o.id !== p.id && o.startStack > 0 && o.endStack <= 0).length;
    const biggestWinner = record.winners.every(w => w.playerId === p.id || w.amount <= p.won);
    if (busted >= 2 && biggestWinner) earned.push('two_birds');
  }

  // Took it down without a showdown after betting the last round with nothing, not even a pair
  if (won && !contested(record) && (isBoardHigh(record) || isHighStud(record))) {
    const lastStreet = isHighStud(record) ? (variant === 'five-card-stud' ? 'fifth' : 'seventh') : 'river';
    const aggressive = record.actions.some(a => a.playerId === p.id && a.stage === lastStreet && (a.action === 'bet' || a.action === 'raise'));
    const nothing = (isHighStud(record) || record.board.length === 5) && showdownRanking(record, p)?.rank === HandRank.HighCard;
    if (aggressive && nothing) earned.push('stone_cold_bluff');
  }

  if (won && extras.splashedBy?.includes(p.id)) earned.push('make_it_rain');

  return earned;
}

/** Whether this hand needs the player's earlier hands at the table to judge. */
export function needsHistory(record: HandRecord, p: HandRecordPlayer): boolean {
  return p.won > 0 || (variantOf(record) === 'texas-holdem' && isPocketAces(p.cards?.hole) && p.net < 0);
}

/** This hand and the earlier ones in the same session, newest first. */
export function currentSession(record: HandRecord, p: HandRecordPlayer, past: PastHand[]): PastHand[] {
  const current: PastHand = {
    handId: record.id,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    bigBlind: record.bigBlind,
    variant: variantOf(record),
    me: p,
  };
  const hands = [current, ...past.filter(h => h.handId !== record.id)];
  const session: PastHand[] = [current];
  for (let i = 1; i < hands.length; i++) {
    const later = hands[i - 1];
    const laterStart = Date.parse(later.startedAt || later.endedAt);
    if (laterStart - Date.parse(hands[i].endedAt) > SESSION_GAP_MS) break;
    session.push(hands[i]);
  }
  return session;
}

/** Achievements for streaks and sessions, given the player's earlier hands at this table. */
export function historyAchievements(record: HandRecord, p: HandRecordPlayer, past: PastHand[]): string[] {
  const earned: string[] = [];
  const earlier = past.filter(h => h.handId !== record.id);
  if (p.won > 0) {
    const streak = earlier.slice(0, HEATER_WINS - 1);
    if (streak.length === HEATER_WINS - 1 && streak.every(h => h.me.won > 0)) earned.push('heater');

    const waited = earlier.slice(0, PATIENT_FOLDS);
    if (waited.length === PATIENT_FOLDS && waited.every(h => h.me.folded && !(h.me.won > 0))) earned.push('patient_one');

    // Oldest first: the buy-in, the low point and the climb back with no chips added since
    const session = currentSession(record, p, earlier).reverse();
    const buyIn = session[0].me.startStack;
    if (buyIn > 0 && p.endStack >= buyIn * 2) {
      let low = -1;
      for (let i = 0; i < session.length - 1; i++) {
        const h = session[i];
        if (h.me.endStack > 0 && h.bigBlind > 0 && h.me.endStack < h.bigBlind * 10) low = i;
      }
      const noTopUps = low >= 0 && session.slice(low + 1).every((h, i) => h.me.startStack <= session[low + i].me.endStack);
      if (noTopUps) earned.push('chip_and_a_chair');
    }
  }

  if (variantOf(record) === 'texas-holdem' && isPocketAces(p.cards?.hole) && p.net < 0) {
    const cracked = currentSession(record, p, earlier)
      .filter(h => h.variant === 'texas-holdem' && isPocketAces(h.me.cards?.hole) && h.me.net < 0).length;
    if (cracked >= ACES_CRACKED_TIMES) earned.push('aces_cracked');
  }
  return earned;
}

/** Dealt exactly the same two hole cards as in the table's previous hand. */
export function isDejaVu(record: HandRecord, p: HandRecordPlayer, previous: HandRecordPlayer[] | null): boolean {
  if (variantOf(record) !== 'texas-holdem' || !previous) return false;
  const mine = holeOf(p);
  const before = holeOf(previous.find(o => o.id === p.id) || ({} as HandRecordPlayer));
  if (mine.length !== 2 || before.length !== 2) return false;
  const keys = (cards: Card[]) => cards.map(cardKey).sort().join();
  return keys(mine) === keys(before);
}

/** Hammer tiers reached with this many 7-2 offsuit wins. */
export function hammerTiers(wins: number): string[] {
  return HAMMER_TIERS.filter(([n]) => wins >= n).map(([, type]) => type);
}
