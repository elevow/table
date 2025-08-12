import { HandEvaluator } from '../hand-evaluator';
import { Card } from '../../types/poker';

function createCard(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

describe('HandEvaluator', () => {
  describe('evaluateHand', () => {
    it('should correctly identify a pair', () => {
      const holeCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('K', 'diamonds')
      ];
      const communityCards: Card[] = [
        createCard('A', 'spades'),
        createCard('2', 'clubs'),
        createCard('7', 'hearts'),
        createCard('5', 'diamonds'),
        createCard('9', 'clubs')
      ];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.name).toBe('Pair');
      expect(hand.rank).toBeGreaterThan(0);
    });

    it('should correctly identify a straight', () => {
      const holeCards: Card[] = [
        createCard('5', 'hearts'),
        createCard('6', 'diamonds')
      ];
      const communityCards: Card[] = [
        createCard('7', 'spades'),
        createCard('8', 'clubs'),
        createCard('9', 'hearts'),
        createCard('2', 'diamonds'),
        createCard('3', 'clubs')
      ];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.name).toBe('Straight');
    });
  });

  describe('determineWinners', () => {
    it('should correctly determine winner with higher pair', () => {
      const players = [
        {
          id: 'player1',
          holeCards: [
            createCard('A', 'hearts'),
            createCard('K', 'diamonds')
          ]
        },
        {
          id: 'player2',
          holeCards: [
            createCard('Q', 'clubs'),
            createCard('J', 'spades')
          ]
        }
      ];

      const communityCards: Card[] = [
        createCard('A', 'spades'),
        createCard('4', 'hearts'),
        createCard('7', 'hearts'),
        createCard('5', 'diamonds'),
        createCard('9', 'clubs')
      ];

      const winners = HandEvaluator.determineWinners(players, communityCards);
      expect(winners).toHaveLength(1);
      expect(winners[0].playerId).toBe('player1');
      expect(winners[0].description).toBe('Pair');
    });

    it('should correctly identify split pot', () => {
      const players = [
        {
          id: 'player1',
          holeCards: [
            createCard('A', 'hearts'),
            createCard('K', 'diamonds')
          ]
        },
        {
          id: 'player2',
          holeCards: [
            createCard('A', 'clubs'),
            createCard('K', 'spades')
          ]
        }
      ];

      const communityCards: Card[] = [
        createCard('2', 'spades'),
        createCard('3', 'hearts'),
        createCard('7', 'hearts'),
        createCard('5', 'diamonds'),
        createCard('9', 'clubs')
      ];

      const winners = HandEvaluator.determineWinners(players, communityCards);
      expect(winners).toHaveLength(2);
      expect(winners.map(w => w.playerId)).toContain('player1');
      expect(winners.map(w => w.playerId)).toContain('player2');
    });
  });
});
