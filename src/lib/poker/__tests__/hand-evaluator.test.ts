import { HandEvaluator } from '../hand-evaluator';
import { Card } from '../../../types/poker';
import { HandInterface } from '../../../types/poker-engine';

describe('HandEvaluator', () => {
  const createCard = (
    rank: '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K'|'A',
    suit: 'hearts'|'diamonds'|'clubs'|'spades'
  ): Card => ({ rank, suit });

  describe('evaluateHand', () => {
    it('should correctly evaluate a pair', () => {
      const holeCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('A', 'diamonds')
      ];

      const communityCards: Card[] = [
        createCard('K', 'clubs'),
        createCard('Q', 'spades'),
        createCard('2', 'hearts'),
        createCard('3', 'diamonds'),
        createCard('4', 'clubs')
      ];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.description).toBe('Pair, A\'s');
    });

    it('should correctly evaluate a straight', () => {
      const holeCards: Card[] = [
        createCard('5', 'hearts'),
        createCard('6', 'diamonds')
      ];

      const communityCards: Card[] = [
        createCard('7', 'clubs'),
        createCard('8', 'spades'),
        createCard('9', 'hearts'),
        createCard('2', 'diamonds'),
        createCard('3', 'clubs')
      ];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.description).toBe('Straight, 9 High');
    });

    it('should correctly evaluate three of a kind', () => {
      const holeCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('A', 'diamonds')
      ];

      const communityCards: Card[] = [
        createCard('A', 'clubs'),
        createCard('K', 'spades'),
        createCard('2', 'hearts'),
        createCard('3', 'diamonds'),
        createCard('4', 'clubs')
      ];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.description).toBe('Three of a Kind, A\'s');
    });

    it('should correctly evaluate a flush', () => {
      const holeCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('K', 'hearts')
      ];

      const communityCards: Card[] = [
        createCard('Q', 'hearts'),
        createCard('J', 'hearts'),
        createCard('9', 'hearts'),
        createCard('2', 'diamonds'),
        createCard('3', 'clubs')
      ];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.description).toBe('Flush, Ah High');
    });

    it('should correctly evaluate a full house', () => {
      const holeCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('A', 'diamonds')
      ];

      const communityCards: Card[] = [
        createCard('A', 'clubs'),
        createCard('K', 'spades'),
        createCard('K', 'hearts'),
        createCard('2', 'diamonds'),
        createCard('3', 'clubs')
      ];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.description).toBe('Full House, A\'s over K\'s');
    });

    it('should correctly evaluate four of a kind', () => {
      const holeCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('A', 'diamonds')
      ];

      const communityCards: Card[] = [
        createCard('A', 'clubs'),
        createCard('A', 'spades'),
        createCard('K', 'hearts'),
        createCard('2', 'diamonds'),
        createCard('3', 'clubs')
      ];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.description).toBe('Four of a Kind, A\'s');
    });

    it('should correctly evaluate a straight flush', () => {
      const holeCards: Card[] = [
        createCard('5', 'hearts'),
        createCard('6', 'hearts')
      ];

      const communityCards: Card[] = [
        createCard('7', 'hearts'),
        createCard('8', 'hearts'),
        createCard('9', 'hearts'),
        createCard('2', 'diamonds'),
        createCard('3', 'clubs')
      ];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.description).toBe('Straight Flush, 9h High');
    });

    it('should correctly evaluate royal flush', () => {
      const holeCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('K', 'hearts')
      ];

      const communityCards: Card[] = [
        createCard('Q', 'hearts'),
        createCard('J', 'hearts'),
        createCard('10', 'hearts'),
        createCard('2', 'diamonds'),
        createCard('3', 'clubs')
      ];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.description).toBe('Royal Flush');
    });

    it('should correctly evaluate high card', () => {
      const holeCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('K', 'diamonds')
      ];

      const communityCards: Card[] = [
        createCard('2', 'clubs'),
        createCard('4', 'spades'),
        createCard('7', 'hearts'),
        createCard('8', 'diamonds'),
        createCard('J', 'clubs')
      ];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.description).toBe('A High');
    });
  });
});
