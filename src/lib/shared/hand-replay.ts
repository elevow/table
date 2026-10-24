import type { HandRecord } from '../../types/hand-record';
import type { GameStage, HandActionEntry } from '../../types/poker';

export interface ReplayFrame {
  // Index of the action just taken (-1 at the deal, actions.length at the result)
  step: number;
  stage: GameStage;
  pot: number;
  stacks: Record<string, number>;
  // Each player's latest action this street
  lastAction: Record<string, HandActionEntry | undefined>;
  folded: Set<string>;
  // How many board cards (Hold'em/Omaha) or up cards per player (stud) are showing
  boardCount: number;
  upCount: number;
  // Set on the final frame
  result?: Array<{ playerId: string; amount: number }>;
  caption: string;
}

const BOARD_BY_STAGE: Partial<Record<GameStage, number>> = { preflop: 0, flop: 3, turn: 4, river: 5 };
const UP_BY_STAGE: Partial<Record<GameStage, number>> = { third: 1, fourth: 2, fifth: 3, sixth: 4, seventh: 4 };

const VERB: Record<HandActionEntry['action'], string> = {
  'small-blind': 'posts the small blind',
  'big-blind': 'posts the big blind',
  straddle: 'straddles',
  ante: 'antes',
  'bring-in': 'brings it in',
  fold: 'folds',
  check: 'checks',
  call: 'calls',
  bet: 'bets',
  raise: 'raises to',
};

export function describeAction(a: HandActionEntry, name: string, money: (n: number) => string): string {
  const amount = a.action === 'raise' || a.action === 'bet' ? a.amount ?? a.put : a.put;
  const showAmount = a.action !== 'fold' && a.action !== 'check' && amount > 0;
  return `${name} ${VERB[a.action]}${showAmount ? ` ${money(amount)}` : ''}${a.auto ? ' (timed out)' : ''}`;
}

/**
 * Step-by-step states of a recorded hand: the deal, one frame per action, and the result.
 * Stacks and the pot come from the chips each action put in; the board is revealed street by
 * street (all of it on the result, which covers all-in runouts).
 */
export function buildReplayFrames(hand: HandRecord, money: (n: number) => string = n => `$${n}`): ReplayFrame[] {
  const stud = hand.players.some(p => p.cards?.up || p.cards?.down);
  const names = new Map(hand.players.map(p => [p.id, p.name]));
  const stacks: Record<string, number> = Object.fromEntries(hand.players.map(p => [p.id, p.startStack]));
  const folded = new Set<string>();
  let lastAction: Record<string, HandActionEntry | undefined> = {};
  let pot = 0;
  let stage: GameStage = stud ? 'third' : 'preflop';

  const counts = (s: GameStage) => ({
    boardCount: stud ? 0 : BOARD_BY_STAGE[s] ?? 0,
    upCount: stud ? UP_BY_STAGE[s] ?? 0 : 0,
  });

  const frames: ReplayFrame[] = [{
    step: -1,
    stage,
    pot,
    stacks: { ...stacks },
    lastAction: {},
    folded: new Set(),
    ...counts(stage),
    caption: `Hand #${hand.handNumber} is dealt${hand.kind === 'bomb-pot' ? ' (bomb pot)' : ''}`,
  }];

  hand.actions.forEach((a, i) => {
    if (a.stage !== stage) {
      stage = a.stage;
      lastAction = {};
    }
    stacks[a.playerId] = (stacks[a.playerId] ?? 0) - a.put;
    pot += a.put;
    if (a.action === 'fold') folded.add(a.playerId);
    lastAction = { ...lastAction, [a.playerId]: a };
    frames.push({
      step: i,
      stage,
      pot,
      stacks: { ...stacks },
      lastAction,
      folded: new Set(folded),
      ...counts(stage),
      caption: describeAction(a, names.get(a.playerId) || 'Player', money),
    });
  });

  const winners = hand.winners.filter(w => w.amount > 0);
  const caption = winners.length
    ? winners.map(w => `${names.get(w.playerId) || 'Player'} wins ${money(w.amount)}`).join(', ')
    : 'Hand complete';
  frames.push({
    step: hand.actions.length,
    stage: 'showdown',
    pot: 0,
    stacks: Object.fromEntries(hand.players.map(p => [p.id, p.endStack])),
    lastAction,
    folded: new Set(folded),
    boardCount: hand.board.length,
    upCount: 4,
    result: winners,
    caption,
  });
  return frames;
}
