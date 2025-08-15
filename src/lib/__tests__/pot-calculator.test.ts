import { PotCalculator, SidePot } from '../poker/pot-calculator';

describe('PotCalculator', () => {
  describe('calculateSidePots', () => {
    it('should handle no bets', () => {
      const players = [
        { id: 'p1', stack: 1000, currentBet: 0, isFolded: false },
        { id: 'p2', stack: 1000, currentBet: 0, isFolded: false }
      ];

      const pots = PotCalculator.calculateSidePots(players);
      expect(pots).toHaveLength(0);
    });

    it('should handle single main pot', () => {
      const players = [
        { id: 'p1', stack: 1000, currentBet: 100, isFolded: false },
        { id: 'p2', stack: 1000, currentBet: 100, isFolded: false },
        { id: 'p3', stack: 1000, currentBet: 100, isFolded: false }
      ];

      const pots = PotCalculator.calculateSidePots(players);
      expect(pots).toHaveLength(1);
      expect(pots[0].amount).toBe(300);
      expect(pots[0].eligiblePlayers).toHaveLength(3);
    });

    it('should handle one side pot', () => {
      const players = [
        { id: 'p1', stack: 0, currentBet: 50, isFolded: false },
        { id: 'p2', stack: 950, currentBet: 100, isFolded: false },
        { id: 'p3', stack: 950, currentBet: 100, isFolded: false }
      ];

      const pots = PotCalculator.calculateSidePots(players);
      expect(pots).toHaveLength(2);
      
      // Main pot (all players eligible)
      expect(pots[0].amount).toBe(150);
      expect(pots[0].eligiblePlayers).toHaveLength(3);
      
      // Side pot (only p2 and p3 eligible)
      expect(pots[1].amount).toBe(100);
      expect(pots[1].eligiblePlayers).toHaveLength(2);
      expect(pots[1].eligiblePlayers).not.toContain('p1');
    });

    it('should handle multiple side pots', () => {
      const players = [
        { id: 'p1', stack: 0, currentBet: 50, isFolded: false },
        { id: 'p2', stack: 0, currentBet: 100, isFolded: false },
        { id: 'p3', stack: 900, currentBet: 150, isFolded: false }
      ];

      const pots = PotCalculator.calculateSidePots(players);
      expect(pots).toHaveLength(3);
      
      // Main pot (all in for 50)
      expect(pots[0].amount).toBe(150);
      expect(pots[0].eligiblePlayers).toHaveLength(3);
      
      // First side pot (p2 and p3)
      expect(pots[1].amount).toBe(100);
      expect(pots[1].eligiblePlayers).toHaveLength(2);
      
      // Second side pot (only p3)
      expect(pots[2].amount).toBe(50);
      expect(pots[2].eligiblePlayers).toHaveLength(1);
      expect(pots[2].eligiblePlayers[0]).toBe('p3');
    });
  });

  describe('distributePots', () => {
    it('should correctly distribute single pot to one winner', () => {
      const sidePots: SidePot[] = [{
        amount: 300,
        eligiblePlayers: ['p1', 'p2', 'p3']
      }];

      const winners = [
        { playerId: 'p1', winAmount: 0 }
      ];

      PotCalculator.distributePots(sidePots, winners);
      expect(winners[0].winAmount).toBe(300);
    });

    it('should split pot between multiple winners', () => {
      const sidePots: SidePot[] = [{
        amount: 300,
        eligiblePlayers: ['p1', 'p2', 'p3']
      }];

      const winners = [
        { playerId: 'p1', winAmount: 0 },
        { playerId: 'p2', winAmount: 0 }
      ];

      PotCalculator.distributePots(sidePots, winners);
      expect(winners[0].winAmount).toBe(150);
      expect(winners[1].winAmount).toBe(150);
    });

    it('should correctly distribute multiple pots', () => {
      const sidePots: SidePot[] = [
        {
          amount: 150, // Main pot
          eligiblePlayers: ['p1', 'p2', 'p3']
        },
        {
          amount: 100, // Side pot
          eligiblePlayers: ['p2', 'p3']
        }
      ];

      const winners = [
        { playerId: 'p1', winAmount: 0 }, // Wins main pot
        { playerId: 'p2', winAmount: 0 }  // Wins side pot
      ];

      PotCalculator.distributePots(sidePots, winners);
      expect(winners[0].winAmount).toBe(75); // Split main pot evenly with p2
      expect(winners[1].winAmount).toBe(175); // Split main pot with p1 plus entire side pot
    });
  });
});
