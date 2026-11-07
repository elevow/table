import { createPokerEngine } from '../engine-factory';
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

/** Who opens fifth street when each player shows these up cards. */
function firstToAct(variant: 'seven-card-stud' | 'five-card-stud' | 'seven-card-stud-hi-lo', ups: Record<string, Card[]>) {
  const ids = Object.keys(ups);
  const engine = createPokerEngine({
    tableId: 'stud-order',
    players: ids.map((id, i) => P(id, i)),
    smallBlind: 1,
    bigBlind: 2,
    state: { variant },
  });
  engine.startNewHand();
  const es = engine as any;
  const state = es.state as any;
  ids.forEach(id => { state.studState.playerCards[id].upCards = ups[id]; });
  es.gameStateManager.startBettingRound('fifth');
  return state.activePlayer;
}

describe('stud later streets: the best showing hand acts first', () => {
  it('puts a pair ahead of a higher unpaired card', () => {
    expect(firstToAct('seven-card-stud', {
      ace: [c('A', 'spades'), c('3', 'clubs')],
      kings: [c('K', 'clubs'), c('K', 'diamonds')],
    })).toBe('kings');
  });

  it('applies to five-card stud and stud hi-lo too', () => {
    const ups = {
      ace: [c('A', 'spades'), c('3', 'clubs')],
      twos: [c('2', 'clubs'), c('2', 'diamonds')],
    };
    expect(firstToAct('five-card-stud', ups)).toBe('twos');
    expect(firstToAct('seven-card-stud-hi-lo', ups)).toBe('twos');
  });

  it('ranks trips over two pair over one pair', () => {
    const onePair = [c('A', 'spades'), c('A', 'clubs'), c('K', 'clubs'), c('Q', 'clubs')];
    const twoPair = [c('9', 'spades'), c('9', 'clubs'), c('8', 'clubs'), c('8', 'hearts')];
    const trips = [c('3', 'spades'), c('3', 'clubs'), c('3', 'hearts'), c('2', 'hearts')];
    expect(firstToAct('seven-card-stud', { onePair, twoPair })).toBe('twoPair');
    expect(firstToAct('seven-card-stud', { twoPair, trips })).toBe('trips');
  });

  it('compares the pair first, then the side cards', () => {
    expect(firstToAct('seven-card-stud', {
      tens: [c('10', 'spades'), c('10', 'clubs'), c('A', 'clubs')],
      jacks: [c('J', 'spades'), c('J', 'clubs'), c('2', 'clubs')],
    })).toBe('jacks');
    expect(firstToAct('seven-card-stud', {
      low: [c('J', 'spades'), c('J', 'clubs'), c('2', 'clubs')],
      high: [c('J', 'hearts'), c('J', 'diamonds'), c('9', 'clubs')],
    })).toBe('high');
  });

  it('does not count a straight or flush on the up cards', () => {
    expect(firstToAct('seven-card-stud', {
      flush: [c('A', 'hearts'), c('Q', 'hearts'), c('9', 'hearts'), c('4', 'hearts')],
      pair: [c('2', 'spades'), c('2', 'clubs'), c('5', 'clubs'), c('7', 'diamonds')],
    })).toBe('pair');
  });

  it('still falls back to the highest card when nobody has a pair', () => {
    expect(firstToAct('seven-card-stud', {
      queen: [c('Q', 'spades'), c('J', 'clubs')],
      ace: [c('A', 'clubs'), c('2', 'clubs')],
    })).toBe('ace');
  });

  it('breaks identical showing hands by the suit of the lead card, then by seat', () => {
    expect(firstToAct('seven-card-stud', {
      clubs: [c('K', 'clubs'), c('5', 'diamonds')],
      spades: [c('K', 'spades'), c('5', 'hearts')],
    })).toBe('spades');
    expect(firstToAct('seven-card-stud', {
      first: [c('K', 'spades'), c('5', 'diamonds')],
      second: [c('K', 'spades'), c('5', 'hearts')],
    })).toBe('first');
  });

  it('orders keys so a better showing hand compares higher', () => {
    const key = (ranks: Card['rank'][]) => HandEvaluator.studShowingKey(ranks.map(r => c(r, 'clubs')));
    expect(HandEvaluator.compareStudShowing(key(['K', 'K']), key(['A', '3']))).toBeGreaterThan(0);
    expect(HandEvaluator.compareStudShowing(key(['A', '3']), key(['A', '3']))).toBe(0);
  });
});
