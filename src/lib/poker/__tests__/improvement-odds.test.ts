import type { Card } from '../../../types/poker';
import { describeImprovement, improvementOnLastCard, lastCardDrawFor } from '../improvement-odds';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('lastCardDrawFor', () => {
  it('is the river in Hold\'em and high Omaha once the turn is out', () => {
    expect(lastCardDrawFor('texas-holdem', { board: 4, mine: 2 })).toBe('river');
    expect(lastCardDrawFor('omaha', { board: 4, mine: 4 })).toBe('river');
    expect(lastCardDrawFor('texas-holdem', { board: 3, mine: 2 })).toBeNull();
    expect(lastCardDrawFor('texas-holdem', { board: 5, mine: 2 })).toBeNull();
  });

  it('is the last card in high stud games, one card before the end', () => {
    expect(lastCardDrawFor('seven-card-stud', { board: 0, mine: 6 })).toBe('last card');
    expect(lastCardDrawFor('five-card-stud', { board: 0, mine: 4 })).toBe('last card');
    expect(lastCardDrawFor('seven-card-stud', { board: 0, mine: 5 })).toBeNull();
  });

  it('leaves out low and split games, which judge hands differently', () => {
    expect(lastCardDrawFor('razz', { board: 0, mine: 6 })).toBeNull();
    expect(lastCardDrawFor('omaha-hi-lo', { board: 4, mine: 4 })).toBeNull();
    expect(lastCardDrawFor('seven-card-stud-hi-lo', { board: 0, mine: 6 })).toBeNull();
  });
});

describe('improvementOnLastCard', () => {
  it('counts a flush draw\'s nine outs among the 46 unseen cards', () => {
    const odds = improvementOnLastCard({
      mine: [c('A', 'hearts'), c('7', 'hearts')],
      board: [c('K', 'hearts'), c('2', 'hearts'), c('9', 'clubs'), c('4', 'spades')],
    })!;
    expect(odds.unseen).toBe(46);
    const flush = odds.byHand.find(h => h.name === 'Flush')!;
    expect(flush.count).toBe(9);
    expect(flush.pct).toBe(19.6);
    // A non-heart ace, seven, king or two (3 each) or nine or four (2 each, one is on the board) makes a pair
    expect(odds.byHand.find(h => h.name === 'Pair')!.count).toBe(16);
    expect(odds.improving).toBe(25);
    expect(odds.byHand[0].name).toBe('Flush');
  });

  it('leaves out cards you can see elsewhere, such as opponents\' stud up cards', () => {
    const mine = [c('A', 'hearts'), c('7', 'hearts'), c('K', 'hearts'), c('2', 'hearts'), c('9', 'clubs'), c('4', 'spades')];
    const odds = improvementOnLastCard({ mine, board: [], seen: [c('Q', 'hearts'), c('J', 'hearts')] })!;
    expect(odds.unseen).toBe(44);
    expect(odds.byHand.find(h => h.name === 'Flush')!.count).toBe(7);
  });

  it('uses Omaha\'s two-from-hand rule', () => {
    // Four hearts on board and one in hand is no flush in Omaha: you must use exactly two hole cards
    const odds = improvementOnLastCard({
      mine: [c('A', 'hearts'), c('8', 'clubs'), c('8', 'diamonds'), c('3', 'spades')],
      board: [c('K', 'hearts'), c('Q', 'hearts'), c('J', 'hearts'), c('5', 'clubs')],
      omaha: true,
    })!;
    expect(odds.byHand.find(h => h.name === 'Flush')).toBeUndefined();
  });

  it('describes the odds in words', () => {
    const odds = improvementOnLastCard({
      mine: [c('A', 'hearts'), c('7', 'hearts')],
      board: [c('K', 'hearts'), c('2', 'hearts'), c('9', 'clubs'), c('4', 'spades')],
    })!;
    expect(describeImprovement(odds, 'river')).toBe('54% to improve on the river: Flush 9 cards (20%), Pair 16 cards (35%)');
    expect(describeImprovement({ unseen: 46, improving: 0, pct: 0, byHand: [] }, 'river')).toBe('No card on the river improves your hand');
  });
});
