/**
 * Tests for Pot Odds Calculator
 */

import { calculatePotOdds, calculatePotOddsPercentage, formatPotOdds } from '../pot-odds';

describe('Pot Odds Calculator', () => {
  describe('calculatePotOdds', () => {
    it('should calculate basic pot odds correctly', () => {
      expect(calculatePotOdds(100, 50)).toBe('2.0:1');
      expect(calculatePotOdds(150, 50)).toBe('3.0:1');
      expect(calculatePotOdds(200, 100)).toBe('2.0:1');
    });

    it('should handle fractional ratios', () => {
      expect(calculatePotOdds(100, 75)).toBe('1.3:1');
      expect(calculatePotOdds(50, 25)).toBe('2.0:1');
    });

    it('should handle very small pots relative to bet', () => {
      // When bet is larger than pot, ratio is less than 1
      expect(calculatePotOdds(10, 100)).toBe('0.1:1');
      expect(calculatePotOdds(5, 50)).toBe('0.1:1');
    });

    it('should handle equal pot and bet', () => {
      expect(calculatePotOdds(100, 100)).toBe('1.0:1');
    });

    it('should return null for invalid inputs', () => {
      expect(calculatePotOdds(100, 0)).toBeNull();
      expect(calculatePotOdds(100, -10)).toBeNull();
      expect(calculatePotOdds(-100, 50)).toBeNull();
    });
  });

  describe('calculatePotOddsPercentage', () => {
    it('should calculate pot odds percentage correctly', () => {
      // Calculates equity percentage needed to break even on the call
      // 50 to call into 100 pot = 50/(100+50) = 33.3% equity needed
      expect(calculatePotOddsPercentage(100, 50)).toBe(33.3);
      
      // 100 to call into 200 pot = 100/(200+100) = 33.3% equity needed
      expect(calculatePotOddsPercentage(200, 100)).toBe(33.3);
      
      // 25 to call into 100 pot = 25/(100+25) = 20% equity needed
      expect(calculatePotOddsPercentage(100, 25)).toBe(20);
    });

    it('should handle edge cases', () => {
      // 100 to call into 100 pot = 100/(100+100) = 50%
      expect(calculatePotOddsPercentage(100, 100)).toBe(50);
      
      // 10 to call into 90 pot = 10/(90+10) = 10%
      expect(calculatePotOddsPercentage(90, 10)).toBe(10);
    });

    it('should return null for invalid inputs', () => {
      expect(calculatePotOddsPercentage(100, 0)).toBeNull();
      expect(calculatePotOddsPercentage(100, -10)).toBeNull();
      expect(calculatePotOddsPercentage(-100, 50)).toBeNull();
    });
  });

  describe('formatPotOdds', () => {
    it('should format pot odds with ratio and percentage', () => {
      expect(formatPotOdds(100, 50)).toBe('2.0:1 (33.3%)');
      expect(formatPotOdds(200, 100)).toBe('2.0:1 (33.3%)');
      expect(formatPotOdds(100, 25)).toBe('4.0:1 (20%)');
    });

    it('should handle small pots relative to bet', () => {
      expect(formatPotOdds(10, 100)).toBe('0.1:1 (90.9%)');
    });

    it('should return null for invalid inputs', () => {
      expect(formatPotOdds(100, 0)).toBeNull();
      expect(formatPotOdds(100, -10)).toBeNull();
      expect(formatPotOdds(-100, 50)).toBeNull();
    });
  });

  describe('Real-world poker scenarios', () => {
    it('should calculate odds for common poker situations', () => {
      // Scenario 1: $100 pot, opponent bets $50
      // Pot odds = 100:50 = 2:1, need 33.3% equity to call
      expect(calculatePotOdds(100, 50)).toBe('2.0:1');
      expect(calculatePotOddsPercentage(100, 50)).toBe(33.3);

      // Scenario 2: $300 pot, opponent bets $100
      // Pot odds = 300:100 = 3:1, need 25% equity to call
      expect(calculatePotOdds(300, 100)).toBe('3.0:1');
      expect(calculatePotOddsPercentage(300, 100)).toBe(25);

      // Scenario 3: $50 pot, opponent bets $150 (overbet)
      // Pot odds = 50:150 = 0.3:1, need 75% equity to call
      expect(calculatePotOdds(50, 150)).toBe('0.3:1');
      expect(calculatePotOddsPercentage(50, 150)).toBe(75);
    });
  });
});
