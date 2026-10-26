/**
 * Screen-reader announcements for the table: what changed between two game states, in words.
 *
 * Only public information goes in, plus the viewer's own cards: other players' hidden cards
 * never reach the snapshot, so they can't be announced.
 */

interface CardLike { rank: string; suit: string }

interface ActionLike {
  playerId: string;
  action: string;
  amount?: number;
  put?: number;
  auto?: boolean;
}

export interface AnnounceSnapshot {
  /** Identifies the hand (handId, else hand number); a change means a new hand. */
  handKey: string | null;
  stage: string | null;
  activePlayer: string | null;
  turnSeq: number | null;
  board: CardLike[];
  actions: ActionLike[];
  /** Winnings once the hand is settled. */
  result: Record<string, number> | null;
  /** Chips the viewer needs to put in to call. */
  toCall: number;
  /** The viewer's own cards (hole cards, or stud down and up cards). */
  myCards: CardLike[];
}

export interface AnnounceContext {
  viewerId: string;
  nameOf: (playerId: string) => string;
  formatAmount: (amount: number) => string;
}

const RANK_NAMES: Record<string, string> = {
  A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: '10',
};

export function describeCard(card: CardLike): string {
  const rank = RANK_NAMES[card.rank] || card.rank;
  return `${rank} of ${card.suit}`;
}

const describeCards = (cards: CardLike[]) => cards.map(describeCard).join(', ');

/** Build a snapshot from a (client-side, already sanitized) game state. */
export function snapshotFromState(state: any, viewerId: string): AnnounceSnapshot | null {
  if (!state || typeof state !== 'object') return null;
  const players: any[] = Array.isArray(state.players) ? state.players : [];
  const me = viewerId ? players.find(p => p?.id === viewerId) : undefined;
  const stud = viewerId ? state.studState?.playerCards?.[viewerId] : undefined;
  const studCards = stud ? [...(stud.downCards || []), ...(stud.upCards || [])] : [];
  const holeCards = Array.isArray(me?.holeCards) ? me.holeCards : [];
  const winnings = state.handResult?.winnings;
  return {
    handKey: state.handId ? String(state.handId) : (state.handNumber != null ? `#${state.handNumber}` : null),
    stage: state.stage ?? null,
    activePlayer: state.activePlayer || null,
    turnSeq: typeof state.turnSeq === 'number' ? state.turnSeq : null,
    board: Array.isArray(state.communityCards) ? state.communityCards : [],
    actions: Array.isArray(state.handActions) ? state.handActions : [],
    result: winnings && typeof winnings === 'object' ? winnings : null,
    toCall: me ? Math.max(0, Number(state.currentBet || 0) - Number(me.currentBet || 0)) : 0,
    myCards: holeCards.length ? holeCards : studCards,
  };
}

export function describeAction(entry: ActionLike, name: string, fmt: (n: number) => string): string | null {
  const put = Number(entry.put || 0);
  const amount = Number(entry.amount ?? put);
  let text: string | null;
  switch (entry.action) {
    case 'fold': text = `${name} folds`; break;
    case 'check': text = `${name} checks`; break;
    case 'call': text = `${name} calls ${fmt(put)}`; break;
    case 'bet': text = `${name} bets ${fmt(amount)}`; break;
    case 'raise': text = `${name} raises to ${fmt(amount)}`; break;
    case 'small-blind': text = `${name} posts the small blind, ${fmt(put)}`; break;
    case 'big-blind': text = `${name} posts the big blind, ${fmt(put)}`; break;
    case 'straddle': text = `${name} straddles ${fmt(put)}`; break;
    case 'ante': text = `${name} antes ${fmt(put)}`; break;
    case 'bring-in': text = `${name} brings in for ${fmt(put)}`; break;
    default: text = null;
  }
  if (text && entry.auto) text += ' (out of time)';
  return text;
}

function describeNewBoard(prev: CardLike[], next: CardLike[]): string[] {
  const out: string[] = [];
  const from = prev.length;
  if (from < 3 && next.length >= 3) out.push(`Flop: ${describeCards(next.slice(0, 3))}`);
  if (from < 4 && next.length >= 4) out.push(`Turn: ${describeCard(next[3])}`);
  if (from < 5 && next.length >= 5) out.push(`River: ${describeCard(next[4])}`);
  return out;
}

/**
 * Messages for what changed from prev to next, and the snapshot to compare against next time.
 * With no previous snapshot nothing is announced: joining a table mid-hand shouldn't read
 * out its history.
 */
export function buildAnnouncements(
  prev: AnnounceSnapshot | null,
  next: AnnounceSnapshot,
  ctx: AnnounceContext,
): { messages: string[]; baseline: AnnounceSnapshot } {
  if (!prev) return { messages: [], baseline: next };

  // A new hand when the hand id changes, or (without ids) when the log or board shrinks
  const sameHand = prev.handKey !== null || next.handKey !== null
    ? prev.handKey === next.handKey
    : next.actions.length >= prev.actions.length && next.board.length >= prev.board.length;

  // Broadcasts leave out our cards until our own copy of the state arrives; don't treat
  // that gap as the cards going away (it would re-read them later)
  const myCards = next.myCards.length || !sameHand ? next.myCards : prev.myCards;
  const baseline = { ...next, myCards };
  const messages: string[] = [];
  const name = (id: string) => (id === ctx.viewerId ? 'You' : ctx.nameOf(id));

  if (!sameHand) messages.push('New hand');

  const prevCards = sameHand ? prev.myCards : [];
  if (myCards.length > prevCards.length) {
    messages.push(prevCards.length === 0
      ? `Your cards: ${describeCards(myCards)}`
      : `Your new card${myCards.length - prevCards.length > 1 ? 's' : ''}: ${describeCards(myCards.slice(prevCards.length))}`);
  }

  const prevActions = sameHand ? prev.actions : [];
  for (const entry of next.actions.slice(prevActions.length)) {
    // Our own actions are what we just did
    if (entry.playerId === ctx.viewerId) continue;
    const text = describeAction(entry, name(entry.playerId), ctx.formatAmount);
    if (text) messages.push(text);
  }

  messages.push(...describeNewBoard(sameHand ? prev.board : [], next.board));

  if (next.result && (!sameHand || !prev.result)) {
    const wins = Object.entries(next.result).filter(([, amount]) => Number(amount) > 0);
    for (const [playerId, amount] of wins) {
      messages.push(`${name(playerId)} ${playerId === ctx.viewerId ? 'win' : 'wins'} ${ctx.formatAmount(Number(amount))}`);
    }
  }

  const myTurn = next.activePlayer === ctx.viewerId && next.stage !== 'showdown';
  const wasMyTurn = sameHand && prev.activePlayer === ctx.viewerId && prev.stage !== 'showdown' && prev.turnSeq === next.turnSeq;
  if (myTurn && !wasMyTurn) {
    messages.push(next.toCall > 0 ? `Your turn. ${ctx.formatAmount(next.toCall)} to call` : 'Your turn. You can check');
  }

  return { messages, baseline };
}

/** Join queued messages into one announcement, each as its own sentence. */
export function mergeAnnouncements(messages: string[]): string {
  return messages
    .map(m => m.trim())
    .filter(Boolean)
    .map(m => (/[.!?]$/.test(m) ? m : `${m}.`))
    .join(' ');
}
