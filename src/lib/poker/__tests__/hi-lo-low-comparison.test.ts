import { createPokerEngine } from '../engine-factory';
import { PokerEngine } from '../poker-engine';
import { HandEvaluator } from '../hand-evaluator';
import { Card, Player } from '../../../types/poker';

const P = (id: string, pos: number): Player => ({
  id,
  name: id,
  position: pos,
  stack: 500,
  currentBet: 0,
  hasActed: false,
  isFolded: false,
  isAllIn: false,
  timeBank: 30000,
});

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

/** A hand started with two players, blinds handed back and a clean pot of 200. */
function startHand(tableId: string, variant: 'omaha-hi-lo' | 'seven-card-stud-hi-lo') {
  const engine = createPokerEngine({ tableId, players: [P('six', 0), P('seven', 1)], smallBlind: 1, bigBlind: 2, state: { variant } });
  engine.startNewHand();
  const es = engine as any;
  const state = es.state as any;
  state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; p.hasActed = true; });
  state.pot = 200;
  return { engine, es, state };
}

/**
 * On a 2-3-4 board "six" holds 5-6 for 6-5-4-3-2 and "seven" holds A-7 for 7-4-3-2-A. The six-low
 * is the better hand: it has the lower top card, even though the other hand holds the ace.
 */
const BOARD = [c('2', 'diamonds'), c('3', 'clubs'), c('4', 'hearts'), c('K', 'diamonds'), c('Q', 'clubs')];
const SIX_LOW_HOLES = [c('5', 'hearts'), c('6', 'spades'), c('9', 'clubs'), c('10', 'diamonds')];
const SEVEN_LOW_HOLES = [c('A', 'spades'), c('7', 'diamonds'), c('J', 'hearts'), c('J', 'spades')];

function dealOmaha(state: any) {
  state.communityCards = BOARD;
  state.players.find((p: any) => p.id === 'six').holeCards = SIX_LOW_HOLES;
  state.players.find((p: any) => p.id === 'seven').holeCards = SEVEN_LOW_HOLES;
}

describe('ace-to-five low comparison', () => {
  it('reads lows from the highest card down', () => {
    const cmp = HandEvaluator.compareAceToFiveLow;
    expect(cmp([2, 3, 4, 5, 6], [1, 2, 3, 4, 7])).toBeLessThan(0); // 6-5-4-3-2 beats 7-4-3-2-A
    expect(cmp([1, 2, 3, 4, 7], [2, 3, 4, 5, 6])).toBeGreaterThan(0);
    expect(cmp([3, 4, 5, 6, 8], [1, 2, 3, 7, 8])).toBeLessThan(0); // 8-6-5-4-3 beats 8-7-3-2-A
    expect(cmp([1, 2, 3, 4, 8], [1, 2, 3, 5, 8])).toBeLessThan(0); // 8-4-3-2-A beats 8-5-3-2-A
    expect(cmp([1, 2, 3, 4, 5], [2, 3, 4, 5, 6])).toBeLessThan(0); // the wheel beats a six-low
    expect(cmp([1, 2, 3, 4, 7], [1, 2, 3, 4, 7])).toBe(0);
  });

  it('awards the Omaha Hi-Lo low half to the lower top card, not the ace', () => {
    const { engine, es, state } = startHand('lowcmp-omaha', 'omaha-hi-lo');
    dealOmaha(state);
    state.stage = 'river';
    es.determineWinner();

    const { lastHiLoResult } = engine.getState();
    expect(lastHiLoResult!.low).toEqual([{ playerId: 'six', amount: 100 }]);
  });

  it('awards the Stud Hi-Lo low half to the lower top card, not the ace', () => {
    const { engine, es, state } = startHand('lowcmp-stud', 'seven-card-stud-hi-lo');
    state.studState = state.studState || { playerCards: {} };
    state.studState.playerCards.six = {
      downCards: [c('6', 'hearts'), c('5', 'hearts'), c('K', 'clubs')],
      upCards: [c('4', 'spades'), c('3', 'diamonds'), c('2', 'clubs'), c('Q', 'spades')],
    };
    state.studState.playerCards.seven = {
      downCards: [c('A', 'clubs'), c('7', 'diamonds'), c('K', 'diamonds')],
      upCards: [c('4', 'clubs'), c('3', 'hearts'), c('2', 'diamonds'), c('Q', 'diamonds')],
    };
    state.stage = 'seventh';
    es.determineWinner();

    const { lastHiLoResult } = engine.getState();
    expect(lastHiLoResult!.low).toEqual([{ playerId: 'six', amount: 100 }]);
  });

  it('awards the low half to the lower top card on every run-it-twice board', () => {
    const engine = new PokerEngine('lowcmp-rit', [P('a', 1), P('b', 2), P('c', 3)], 1, 2, { variant: 'omaha-hi-lo' });
    engine.startNewHand();
    const act = (type: string, amount?: number) => {
      const s = engine.getState();
      engine.handleAction({ type, amount, playerId: s.activePlayer, tableId: 'lowcmp-rit', timestamp: 0 } as any);
    };
    act('fold');
    act('raise', 500);
    act('call');

    const state = engine.getState();
    // Whoever acted first folded; the other two are all-in
    const [six, seven] = state.players.filter(p => !p.isFolded);
    six.holeCards = SIX_LOW_HOLES;
    seven.holeCards = SEVEN_LOW_HOLES;
    engine.startRunItTwice(2, 0);
    engine.getState().runItTwice!.boards = [[...BOARD], [...BOARD]];
    engine.runItTwiceNow();

    const { results } = engine.getState().runItTwice!;
    expect(results).toHaveLength(2);
    results.forEach(run => {
      expect(run.winners.map(w => w.playerId)).toEqual([six.id]);
      expect(run.winners[0].side).toBe('both');
    });
  });
});
