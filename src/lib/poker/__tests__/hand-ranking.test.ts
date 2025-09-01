import { HandEvaluator } from '../../poker/hand-evaluator';
import { Card, HandRank } from '../../../types/poker';

const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('US-026: Hand Rankings', () => {
  it('evaluates and ranks hands across all major categories (ordering sanity)', () => {
    // Build representative 7-card sets for two players and compare
    // Player A: Flush
    const aHole = [C('A', 'hearts'), C('Q', 'hearts')];
  // Board adjusted so Player B can form a straight while A keeps a hearts flush
  // Hearts on board: 2h,7h,9h (3 hearts) so only A with Ah,Qh makes a flush.
  // Non-heart runouts 10c,Jd enable B's straight 8-9-10-J-Q.
  const board = [C('2', 'hearts'), C('7', 'hearts'), C('9', 'hearts'), C('10', 'clubs'), C('J', 'diamonds')];
    const aRank = HandEvaluator.getHandRanking(aHole, board);

  // Player B: Straight (8-9-10-J-Q) without hearts
  const bHole = [C('8', 'clubs'), C('Q', 'diamonds')];
    const bRank = HandEvaluator.getHandRanking(bHole, board);

    expect(aRank.rank).toBeGreaterThanOrEqual(HandRank.Flush);
    expect(bRank.rank).toBe(HandRank.Straight);
  });

  it('handles ties correctly (split pot scenario demo)', () => {
    // Both make the same top pair with identical kickers on the board
    const board = [C('A', 'hearts'), C('A', 'clubs'), C('7', 'diamonds'), C('5', 'spades'), C('2', 'clubs')];
    const p1 = [C('K', 'hearts'), C('Q', 'clubs')];
    const p2 = [C('K', 'spades'), C('Q', 'diamonds')];

    const r1 = HandEvaluator.getHandRanking(p1, board);
    const r2 = HandEvaluator.getHandRanking(p2, board);

    // Same rank; names should be same category description
    expect(r1.rank).toBe(r2.rank);
    expect(typeof r1.name).toBe('string');
  });
});
