import type { Card, GameStage, HandActionEntry } from '../../types/poker';
import type { HandRecord, HandRecordPlayer } from '../../types/hand-record';

/**
 * Hand histories in the PokerStars text format, which most tracking and review tools import.
 *
 * The input must already be redacted for the viewer (see redactHandRecord): this formatter
 * prints every card the record carries, so it relies on the record holding only the viewer's
 * own cards, stud up cards, and cards shown at the table.
 */

export interface PokerStarsOptions {
  viewerId: string;
  // Shown on the "Table '...'" line; the room id when not given
  tableName?: string;
}

const SUIT: Record<Card['suit'], string> = { hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' };

/** "Ah", "Td" (tens are T in this format). */
export function cardText(c: Card): string {
  return `${c.rank === '10' ? 'T' : c.rank}${SUIT[c.suit] || '?'}`;
}

const cardList = (cards: Card[]) => cards.map(cardText).join(' ');

function money(n: number): string {
  const v = Math.round(n * 100) / 100;
  return `$${Number.isInteger(v) ? v : v.toFixed(2)}`;
}

const GAME_NAME: Record<string, string> = {
  'texas-holdem': "Hold'em",
  omaha: 'Omaha',
  'omaha-hi-lo': 'Omaha Hi/Lo',
  'seven-card-stud': '7 Card Stud',
  'seven-card-stud-hi-lo': '7 Card Stud Hi/Lo',
  'five-card-stud': '5 Card Stud',
};

const isStudVariant = (variant?: string) => String(variant || '').includes('stud');

const pad2 = (n: number | string) => String(n).padStart(2, '0');

/** "2026/10/23 9:05:00" in the given time zone (UTC when not given). */
function stamp(date: Date, timeZone?: string): string {
  if (!timeZone) {
    return `${date.getUTCFullYear()}/${pad2(date.getUTCMonth() + 1)}/${pad2(date.getUTCDate())} ` +
      `${date.getUTCHours()}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map(p => [p.type, p.value])
  );
  return `${parts.year}/${parts.month}/${parts.day} ${Number(parts.hour)}:${parts.minute}:${parts.second}`;
}

function dateText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  // Tools expect the Eastern time in brackets, as PokerStars writes it
  try {
    return `${stamp(date)} UTC [${stamp(date, 'America/New_York')} ET]`;
  } catch {
    return `${stamp(date)} UTC`;
  }
}

/**
 * Tracking tools tell hands apart by number, and our hand numbers restart at 1 at every table,
 * so the number comes from the hand's unique id instead (48 bits stay an exact integer).
 */
export function pokerStarsHandNumber(hand: Pick<HandRecord, 'id' | 'handNumber'>): string {
  const hex = String(hand.id || '').replace(/[^0-9a-f]/gi, '').slice(0, 12);
  return hex.length === 12 ? String(parseInt(hex, 16)) : String(hand.handNumber);
}

// Cards dealt on each stud street: [down card indexes, up card indexes]
const SEVEN_STUD_DEAL: Partial<Record<GameStage, [number[], number[]]>> = {
  third: [[0, 1], [0]], fourth: [[], [1]], fifth: [[], [2]], sixth: [[], [3]], seventh: [[2], []],
};
const FIVE_STUD_DEAL: Partial<Record<GameStage, [number[], number[]]>> = {
  third: [[0], [0]], fourth: [[], [1]], fifth: [[], [2]], sixth: [[], [3]],
};
const HOLDEM_STREETS: GameStage[] = ['flop', 'turn', 'river'];
const STREET_LABEL: Partial<Record<GameStage, string>> = {
  preflop: 'Flop', flop: 'Flop', turn: 'Turn', river: 'River',
  third: '3rd Street', fourth: '4th Street', fifth: '5th Street', sixth: '6th Street', seventh: 'River',
};

function visibleCards(p: HandRecordPlayer): Card[] {
  const c = p.cards;
  if (!c) return [];
  return c.hole?.length ? c.hole : [...(c.down || []).slice(0, 2), ...(c.up || []), ...(c.down || []).slice(2)];
}

/** Whether the record shows the player's hidden cards (their own, or shown at the table). */
function showsHidden(p: HandRecordPlayer): boolean {
  return !!(p.cards?.hole?.length || p.cards?.down?.length);
}

/** One hand as PokerStars hand-history text. */
export function formatPokerStarsHand(hand: HandRecord, opts: PokerStarsOptions): string {
  const stud = isStudVariant(String(hand.variant)) || hand.players.some(p => p.cards?.up?.length);
  const fiveStud = String(hand.variant) === 'five-card-stud';
  const lastStudStreet: GameStage = fiveStud ? 'sixth' : 'seventh';
  const studDeal = fiveStud ? FIVE_STUD_DEAL : SEVEN_STUD_DEAL;
  const firstStreet: GameStage = stud ? 'third' : 'preflop';

  // Seats here may count from 0; the format counts from 1
  const seatOffset = hand.players.some(p => p.seat === 0) ? 1 : 0;
  const seats = [...hand.players].sort((a, b) => a.seat - b.seat);
  const seatOf = (p: HandRecordPlayer) => p.seat + seatOffset;
  const byId = new Map(hand.players.map(p => [p.id, p]));
  const name = (id: string) => byId.get(id)?.name || id;

  const lines: string[] = [];
  const game = `${GAME_NAME[String(hand.variant)] || String(hand.variant || "Hold'em")} ${hand.bettingMode === 'pot-limit' ? 'Pot Limit' : 'No Limit'}`;
  lines.push(`PokerStars Hand #${pokerStarsHandNumber(hand)}: ${game} (${money(hand.smallBlind)}/${money(hand.bigBlind)} USD) - ${dateText(hand.endedAt)}`.trimEnd());

  // Button: recorded seat, else the seat before the small blind (the small blind itself heads-up)
  let buttonSeat: number | null = null;
  if (!stud) {
    if (typeof hand.buttonSeat === 'number' && hand.players.some(p => p.seat === hand.buttonSeat)) {
      buttonSeat = hand.buttonSeat + seatOffset;
    } else {
      const sb = hand.actions.find(a => a.action === 'small-blind');
      const sbIdx = sb ? seats.findIndex(p => p.id === sb.playerId) : -1;
      if (sbIdx >= 0) buttonSeat = seatOf(seats.length === 2 ? seats[sbIdx] : seats[(sbIdx - 1 + seats.length) % seats.length]);
      else if (seats.length) buttonSeat = seatOf(seats[0]);
    }
  }
  const maxSeats = Math.max(stud ? 8 : 9, ...seats.map(seatOf));
  lines.push(`Table '${opts.tableName || hand.roomId}' ${maxSeats}-max${buttonSeat != null ? ` Seat #${buttonSeat} is the button` : ''}`);
  for (const p of seats) lines.push(`Seat ${seatOf(p)}: ${p.name} (${money(p.startStack)} in chips)`);

  const stacks = new Map(hand.players.map(p => [p.id, p.startStack]));
  const folded = new Map<string, GameStage>();
  const putVoluntarily = new Set<string>();
  const blindLabel = new Map<string, string>();
  let streetBets = new Map<string, number>();
  let streetMax = 0;
  let stage: GameStage = firstStreet;
  let dealt = false;

  // Before the first street opens: blinds and straddles in flop games, antes in all games
  const preDeal = (a: HandActionEntry) =>
    a.action === 'ante' || (!stud && (a.action === 'small-blind' || a.action === 'big-blind' || a.action === 'straddle'));

  const studDealLines = (street: GameStage) => {
    const deal = studDeal[street];
    if (!deal) return;
    const [downIdx, upIdx] = deal;
    for (const p of seats) {
      if (folded.has(p.id)) continue;
      const down = p.cards?.down || [];
      const up = p.cards?.up || [];
      const mine = p.id === opts.viewerId;
      const fresh = [...downIdx.map(i => (mine ? down[i] : undefined)), ...upIdx.map(i => up[i])].filter((c): c is Card => !!c);
      if (!fresh.length) continue;
      // Earlier cards in the first bracket, as PokerStars writes later streets
      const order: GameStage[] = ['third', 'fourth', 'fifth', 'sixth', 'seventh'];
      const before: Card[] = [];
      for (const s of order.slice(0, order.indexOf(street))) {
        const d = studDeal[s];
        if (!d) continue;
        before.push(...d[0].map(i => (mine ? down[i] : undefined)).filter((c): c is Card => !!c), ...d[1].map(i => up[i]).filter(Boolean));
      }
      lines.push(`Dealt to ${p.name} ${before.length ? `[${cardList(before)}] ` : ''}[${cardList(fresh)}]`);
    }
  };

  const streetHeader = (street: GameStage) => {
    if (stud) {
      // PokerStars writes "3rd STREET": the ordinal stays lower case
      const label = street === lastStudStreet ? 'RIVER' : (STREET_LABEL[street] || street).replace('Street', 'STREET');
      lines.push(`*** ${label} ***`);
      studDealLines(street);
      return;
    }
    const n = street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
    if (hand.board.length < n) return;
    if (street === 'flop') lines.push(`*** FLOP *** [${cardList(hand.board.slice(0, 3))}]`);
    else lines.push(`*** ${street.toUpperCase()} *** [${cardList(hand.board.slice(0, n - 1))}] [${cardText(hand.board[n - 1])}]`);
  };

  const deal = () => {
    dealt = true;
    if (stud) {
      streetHeader('third');
      return;
    }
    lines.push('*** HOLE CARDS ***');
    const me = byId.get(opts.viewerId);
    if (me?.cards?.hole?.length) lines.push(`Dealt to ${me.name} [${cardList(me.cards.hole)}]`);
  };

  // A bet nobody matched goes back to the bettor when the street ends
  const settleStreet = () => {
    const sorted = Array.from(streetBets.entries()).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return;
    const [topId, top] = sorted[0];
    const second = sorted[1]?.[1] ?? 0;
    if (top > second) {
      const back = top - second;
      stacks.set(topId, (stacks.get(topId) ?? 0) + back);
      lines.push(`Uncalled bet (${money(back)}) returned to ${name(topId)}`);
    }
  };

  const streetsBetween = (from: GameStage, to: GameStage): GameStage[] => {
    const order = stud ? ['third', 'fourth', 'fifth', 'sixth', 'seventh'] as GameStage[] : ['preflop', ...HOLDEM_STREETS] as GameStage[];
    const a = order.indexOf(from);
    const b = order.indexOf(to);
    return a >= 0 && b > a ? order.slice(a + 1, b + 1) : [];
  };

  const advanceTo = (next: GameStage) => {
    settleStreet();
    for (const s of streetsBetween(stage, next)) streetHeader(s);
    stage = next;
    streetBets = new Map();
    streetMax = 0;
  };

  for (const a of hand.actions) {
    if (a.stage === 'showdown') continue;
    if (!dealt && preDeal(a)) {
      // Antes are dead money, so they don't count toward the bet to call
      if (a.action !== 'ante') {
        streetBets.set(a.playerId, (streetBets.get(a.playerId) ?? 0) + a.put);
        streetMax = Math.max(streetMax, streetBets.get(a.playerId) ?? 0);
      }
      stacks.set(a.playerId, (stacks.get(a.playerId) ?? 0) - a.put);
      const allIn = a.put > 0 && (stacks.get(a.playerId) ?? 0) <= 0 ? ' and is all-in' : '';
      const what = a.action === 'ante' ? 'the ante' : a.action === 'small-blind' ? 'small blind' : a.action === 'big-blind' ? 'big blind' : 'straddle';
      if (a.action === 'small-blind') blindLabel.set(a.playerId, 'small blind');
      if (a.action === 'big-blind') blindLabel.set(a.playerId, 'big blind');
      if (a.action !== 'ante') putVoluntarily.add(a.playerId);
      lines.push(`${name(a.playerId)}: posts ${what} ${money(a.put)}${allIn}`);
      continue;
    }
    // Bomb pots skip preflop betting, so after the antes the first action is already on the flop
    if (!dealt) deal();
    if (a.stage !== stage) advanceTo(a.stage);

    const before = streetBets.get(a.playerId) ?? 0;
    streetBets.set(a.playerId, before + a.put);
    stacks.set(a.playerId, (stacks.get(a.playerId) ?? 0) - a.put);
    if (a.put > 0) putVoluntarily.add(a.playerId);
    const allIn = a.put > 0 && (stacks.get(a.playerId) ?? 0) <= 0 ? ' and is all-in' : '';
    const who = name(a.playerId);
    switch (a.action) {
      case 'fold':
        folded.set(a.playerId, a.stage);
        lines.push(`${who}: folds`);
        break;
      case 'check':
        lines.push(`${who}: checks`);
        break;
      case 'call':
        lines.push(`${who}: calls ${money(a.put)}${allIn}`);
        break;
      case 'bring-in':
        streetMax = Math.max(streetMax, before + a.put);
        lines.push(`${who}: brings in for ${money(a.put)}${allIn}`);
        break;
      case 'bet': {
        const total = a.amount ?? before + a.put;
        // In stud the first full bet over the bring-in "completes" it
        const completes = stud && streetMax > 0;
        streetMax = Math.max(streetMax, total);
        lines.push(completes ? `${who}: completes it to ${money(total)}${allIn}` : `${who}: bets ${money(a.put)}${allIn}`);
        break;
      }
      case 'raise': {
        const total = a.amount ?? before + a.put;
        lines.push(`${who}: raises ${money(Math.max(0, total - streetMax))} to ${money(total)}${allIn}`);
        streetMax = Math.max(streetMax, total);
        break;
      }
      default:
        // Blinds or straddles out of the usual order (e.g. a late straddle)
        lines.push(`${who}: posts ${money(a.put)}${allIn}`);
    }
  }
  if (!dealt) deal();
  settleStreet();

  const live = seats.filter(p => !folded.has(p.id) && !p.folded);
  const showdown = live.length > 1;
  // All-in run-outs: show the rest of the board even though nobody acted on it
  if (showdown) {
    const end: GameStage = stud ? lastStudStreet : 'river';
    for (const s of streetsBetween(stage, end)) streetHeader(s);
  }

  const won = new Map<string, number>();
  for (const w of hand.winners) if (w.amount > 0) won.set(w.playerId, (won.get(w.playerId) ?? 0) + w.amount);

  if (showdown) {
    if (hand.runBoards && hand.runBoards.length > 1) {
      const ordinal = ['FIRST', 'SECOND', 'THIRD'];
      hand.runBoards.forEach((b, i) => lines.push(`*** ${ordinal[i] || `RUN ${i + 1}`} BOARD *** [${cardList(b)}]`));
    }
    lines.push('*** SHOW DOWN ***');
    for (const p of live) {
      lines.push(showsHidden(p) ? `${p.name}: shows [${cardList(visibleCards(p))}]` : `${p.name}: mucks hand`);
    }
  } else if (live[0]) {
    const p = live[0];
    lines.push(p.revealed && showsHidden(p) ? `${p.name}: shows [${cardList(visibleCards(p))}]` : `${p.name}: doesn't show hand`);
  }
  Array.from(won.entries()).forEach(([id, amount]) => lines.push(`${name(id)} collected ${money(amount)} from pot`));

  lines.push('*** SUMMARY ***');
  const totalPot = hand.pot > 0 ? hand.pot : Array.from(won.values()).reduce((s, v) => s + v, 0);
  lines.push(`Total pot ${money(totalPot)} | Rake $0`);
  if (!stud && hand.board.length) lines.push(`Board [${cardList(hand.board)}]`);
  for (const p of seats) {
    const tags = [
      seatOf(p) === buttonSeat ? ' (button)' : '',
      blindLabel.has(p.id) ? ` (${blindLabel.get(p.id)})` : '',
    ].join('');
    const amount = won.get(p.id) ?? 0;
    let outcome: string;
    const foldStage = folded.get(p.id);
    if (foldStage || p.folded) {
      const where = !foldStage || foldStage === firstStreet
        ? stud ? 'on the 3rd Street' : 'before Flop'
        : `on the ${STREET_LABEL[foldStage] || foldStage}`;
      const quiet = (!foldStage || foldStage === firstStreet) && !putVoluntarily.has(p.id) ? " (didn't bet)" : '';
      outcome = `folded ${where}${quiet}`;
    } else if (!showdown) {
      outcome = `collected (${money(amount)})`;
    } else if (showsHidden(p)) {
      outcome = `showed [${cardList(visibleCards(p))}] and ${amount > 0 ? `won (${money(amount)})` : 'lost'}`;
    } else {
      outcome = amount > 0 ? `collected (${money(amount)})` : 'mucked';
    }
    lines.push(`Seat ${seatOf(p)}: ${p.name}${tags} ${outcome}`);
  }
  return lines.join('\n');
}

/** Several hands, oldest first, separated by blank lines as in a PokerStars history file. */
export function formatPokerStarsHands(hands: HandRecord[], opts: PokerStarsOptions | ((hand: HandRecord) => PokerStarsOptions)): string {
  const sorted = [...hands].sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt));
  return sorted.map(h => formatPokerStarsHand(h, typeof opts === 'function' ? opts(h) : opts)).join('\n\n\n') + (sorted.length ? '\n' : '');
}
