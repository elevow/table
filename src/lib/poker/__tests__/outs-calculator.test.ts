import { OutsCalculator } from '../outs-calculator';
import { Card } from '../../../types/poker';

function createCard(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

describe('OutsCalculator', () => {
  describe('calculateOuts', () => {
    it('should calculate flush draw outs correctly', () => {
      // Player has 4 hearts, needs 1 more for flush
      const losingHoleCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('K', 'hearts')
      ];
      const winningHoleCards: Card[] = [
        createCard('A', 'spades'),
        createCard('A', 'diamonds')
      ];
      const communityCards: Card[] = [
        createCard('2', 'hearts'),
        createCard('7', 'hearts'),
        createCard('9', 'clubs')
      ];

      const result = OutsCalculator.calculateOuts(
        losingHoleCards,
        winningHoleCards,
        communityCards
      );

      // Should have approximately 9 hearts left in deck (13 - 4 = 9)
      // But need to verify each one actually wins
      expect(result.outs.length).toBeGreaterThan(0);
      expect(result.oddsNextCard).toBeGreaterThan(0);
      expect(result.unknownCards).toBe(52 - 7); // 52 total - 7 known cards
    });

    it('should calculate straight draw outs correctly', () => {
      // Player has open-ended straight draw (5-6-7-8, needs 4 or 9)
      const losingHoleCards: Card[] = [
        createCard('5', 'hearts'),
        createCard('6', 'diamonds')
      ];
      const winningHoleCards: Card[] = [
        createCard('A', 'spades'),
        createCard('A', 'diamonds')
      ];
      const communityCards: Card[] = [
        createCard('7', 'hearts'),
        createCard('8', 'clubs'),
        createCard('2', 'spades')
      ];

      const result = OutsCalculator.calculateOuts(
        losingHoleCards,
        winningHoleCards,
        communityCards
      );

      // Should have 8 outs: four 4's and four 9's
      expect(result.outs.length).toBe(8);
      expect(result.oddsNextCard).toBeCloseTo((8 / 45) * 100, 1);
      expect(result.unknownCards).toBe(45);
    });

    it('should return no outs when losing hand cannot improve to win', () => {
      // Player has weak hand with no real outs against quads
      const losingHoleCards: Card[] = [
        createCard('2', 'hearts'),
        createCard('3', 'diamonds')
      ];
      const winningHoleCards: Card[] = [
        createCard('A', 'spades'),
        createCard('A', 'diamonds')
      ];
      const communityCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('A', 'clubs'),
        createCard('K', 'spades')
      ];

      const result = OutsCalculator.calculateOuts(
        losingHoleCards,
        winningHoleCards,
        communityCards
      );

      // Against four Aces, there should be no outs
      expect(result.outs.length).toBe(0);
      expect(result.oddsNextCard).toBe(0);
    });

    it('should calculate outs when both players have strong hands', () => {
      // Player A has flush draw, Player B has set
      const losingHoleCards: Card[] = [
        createCard('K', 'hearts'),
        createCard('Q', 'hearts')
      ];
      const winningHoleCards: Card[] = [
        createCard('7', 'spades'),
        createCard('7', 'diamonds')
      ];
      const communityCards: Card[] = [
        createCard('7', 'hearts'),
        createCard('3', 'hearts'),
        createCard('2', 'clubs')
      ];

      const result = OutsCalculator.calculateOuts(
        losingHoleCards,
        winningHoleCards,
        communityCards
      );

      // Should have heart outs for flush (9 hearts minus the ones that give opponent full house)
      expect(result.outs.length).toBeGreaterThan(0);
      expect(result.oddsNextCard).toBeGreaterThan(0);
    });

    it('should calculate oddsByRiver when not at river yet', () => {
      // On the flop, should calculate odds to river
      const losingHoleCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('K', 'hearts')
      ];
      const winningHoleCards: Card[] = [
        createCard('A', 'spades'),
        createCard('A', 'diamonds')
      ];
      const communityCards: Card[] = [
        createCard('2', 'hearts'),
        createCard('7', 'hearts'),
        createCard('9', 'clubs')
      ];

      const result = OutsCalculator.calculateOuts(
        losingHoleCards,
        winningHoleCards,
        communityCards
      );

      expect(result.oddsByRiver).toBeDefined();
      expect(result.oddsByRiver).toBeGreaterThan(result.oddsNextCard);
    });

    it('should not calculate oddsByRiver when at river', () => {
      // On the river, only next card odds matter (but there is no next card)
      const losingHoleCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('K', 'hearts')
      ];
      const winningHoleCards: Card[] = [
        createCard('A', 'spades'),
        createCard('A', 'diamonds')
      ];
      const communityCards: Card[] = [
        createCard('2', 'hearts'),
        createCard('7', 'hearts'),
        createCard('9', 'clubs'),
        createCard('3', 'spades'),
        createCard('6', 'diamonds')
      ];

      const result = OutsCalculator.calculateOuts(
        losingHoleCards,
        winningHoleCards,
        communityCards
      );

      expect(result.oddsByRiver).toBeUndefined();
    });

    it('should categorize outs by hand type', () => {
      // Flush draw scenario
      const losingHoleCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('K', 'hearts')
      ];
      const winningHoleCards: Card[] = [
        createCard('A', 'spades'),
        createCard('Q', 'spades')
      ];
      const communityCards: Card[] = [
        createCard('2', 'hearts'),
        createCard('7', 'hearts'),
        createCard('9', 'clubs')
      ];

      const result = OutsCalculator.calculateOuts(
        losingHoleCards,
        winningHoleCards,
        communityCards
      );

      expect(result.outsByCategory).toBeDefined();
      if (result.outsByCategory) {
        expect(result.outsByCategory.length).toBeGreaterThan(0);
        // The category will be the hand description (e.g., "Flush" or just improved pair/high card)
        expect(result.outsByCategory[0].category).toBeTruthy();
        expect(result.outsByCategory[0].cards.length).toBeGreaterThan(0);
        expect(result.outsByCategory[0].count).toBe(result.outsByCategory[0].cards.length);
      }
    });

    it('should handle Omaha variant correctly', () => {
      // Omaha requires exactly 2 hole cards and 3 community cards
      const losingHoleCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('K', 'hearts'),
        createCard('Q', 'hearts'),
        createCard('J', 'hearts')
      ];
      const winningHoleCards: Card[] = [
        createCard('A', 'spades'),
        createCard('A', 'diamonds'),
        createCard('2', 'clubs'),
        createCard('3', 'clubs')
      ];
      const communityCards: Card[] = [
        createCard('5', 'hearts'),
        createCard('7', 'diamonds'),
        createCard('9', 'clubs')
      ];

      const result = OutsCalculator.calculateOuts(
        losingHoleCards,
        winningHoleCards,
        communityCards,
        'omaha'
      );

      // Should still calculate outs, but using Omaha rules
      expect(result.unknownCards).toBe(52 - 11); // 4+4+3 = 11 known cards
      expect(result.outs).toBeDefined();
    });

    it('should return empty result for stud variants', () => {
      const losingHoleCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('K', 'hearts')
      ];
      const winningHoleCards: Card[] = [
        createCard('A', 'spades'),
        createCard('A', 'diamonds')
      ];
      const communityCards: Card[] = [
        createCard('2', 'hearts')
      ];

      const result = OutsCalculator.calculateOuts(
        losingHoleCards,
        winningHoleCards,
        communityCards,
        'seven-card-stud'
      );

      expect(result.outs).toEqual([]);
      expect(result.oddsNextCard).toBe(0);
      expect(result.unknownCards).toBe(0);
    });
  });

  describe('formatOdds', () => {
    it('should format odds as percentage with one decimal', () => {
      expect(OutsCalculator.formatOdds(23.456)).toBe('23.5%');
      expect(OutsCalculator.formatOdds(50)).toBe('50.0%');
      expect(OutsCalculator.formatOdds(0)).toBe('0.0%');
      expect(OutsCalculator.formatOdds(100)).toBe('100.0%');
    });
  });

  describe('formatOuts', () => {
    it('should format outs count correctly', () => {
      expect(OutsCalculator.formatOuts(0)).toBe('0 outs');
      expect(OutsCalculator.formatOuts(1)).toBe('1 out');
      expect(OutsCalculator.formatOuts(9)).toBe('9 outs');
      expect(OutsCalculator.formatOuts(15)).toBe('15 outs');
    });
  });
});
