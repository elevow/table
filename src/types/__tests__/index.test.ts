import { HandRank, HandRanking } from '../../types';
import type { Card } from '../poker';

describe('types barrel export (index.ts)', () => {
  it('re-exports HandRank enum correctly', () => {
    expect(typeof HandRank).toBe('object');
    expect(HandRank.HighCard).toBe(1);
    expect(HandRank.Straight).toBe(5);
    expect(HandRank.Flush).toBe(6);
    expect(HandRank.RoyalFlush).toBe(10);
  });

  it('allows constructing a HandRanking-typed object', () => {
    const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
    const hand: HandRanking = {
      rank: HandRank.Straight,
      name: 'Straight',
      cards: [c('10', 'hearts'), c('J', 'hearts'), c('Q', 'clubs'), c('K', 'spades'), c('A', 'diamonds')],
      kickers: [],
      strength: HandRank.Straight,
    };

    expect(hand.name).toBe('Straight');
    expect(hand.rank).toBe(HandRank.Straight);
    expect(hand.cards).toHaveLength(5);
  });
});
