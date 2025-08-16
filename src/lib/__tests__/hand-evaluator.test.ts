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
      // @ts-ignore - pokersolver types are incomplete
      expect(hand.descr).toBe('Straight, 9 High');
    });

    it('should correctly identify three of a kind', () => {
      const holeCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('A', 'diamonds')
      ];
      const communityCards: Card[] = [
        createCard('A', 'spades'),
        createCard('2', 'clubs'),
        createCard('7', 'hearts'),
        createCard('5', 'diamonds'),
        createCard('9', 'clubs')
      ];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.name).toBe('Three of a Kind');
      // @ts-ignore - pokersolver types are incomplete
      expect(hand.descr).toBe('Three of a Kind, A\'s');
    });

    it('should correctly identify a full house', () => {
      const holeCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('A', 'diamonds')
      ];
      const communityCards: Card[] = [
        createCard('A', 'spades'),
        createCard('K', 'clubs'),
        createCard('K', 'hearts'),
        createCard('5', 'diamonds'),
        createCard('9', 'clubs')
      ];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.name).toBe('Full House');
      // @ts-ignore - pokersolver types are incomplete
      expect(hand.descr).toBe('Full House, A\'s over K\'s');
    });

    it('should work with only hole cards (preflop)', () => {
      const holeCards: Card[] = [
        createCard('A', 'hearts'),
        createCard('A', 'diamonds')
      ];
      const communityCards: Card[] = [];

      const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
      expect(hand.name).toBe('Pair');
      // @ts-ignore - pokersolver types are incomplete
      expect(hand.descr).toBe('Pair, A\'s');
    });
  });

  describe('calculateSidePots', () => {
    it('should correctly calculate single main pot', () => {
      const players = [
        { id: 'p1', stack: 980, currentBet: 20, isFolded: false },
        { id: 'p2', stack: 980, currentBet: 20, isFolded: false },
        { id: 'p3', stack: 980, currentBet: 20, isFolded: false }
      ];

      const sidePots = HandEvaluator.calculateSidePots(players);
      expect(sidePots).toHaveLength(1);
      expect(sidePots[0].amount).toBe(60);
      expect(sidePots[0].eligiblePlayers).toHaveLength(3);
    });

    it('should correctly calculate multiple side pots', () => {
      const players = [
        { id: 'p1', stack: 0, currentBet: 100, isFolded: false },
        { id: 'p2', stack: 0, currentBet: 50, isFolded: false },
        { id: 'p3', stack: 850, currentBet: 150, isFolded: false }
      ];

      const sidePots = HandEvaluator.calculateSidePots(players);
      expect(sidePots).toHaveLength(3);
      
      // First pot (all players eligible)
      expect(sidePots[0].amount).toBe(150); // 50 * 3
      expect(sidePots[0].eligiblePlayers).toHaveLength(3);
      
      // Second pot (p1 and p3 eligible)
      expect(sidePots[1].amount).toBe(100); // (100-50) * 2
      expect(sidePots[1].eligiblePlayers).toHaveLength(2);
      
      // Third pot (only p3 eligible)
      expect(sidePots[2].amount).toBe(50); // (150-100) * 1 - only the excess bet amount goes here
      expect(sidePots[2].eligiblePlayers).toHaveLength(1);
    });
  });

  describe('determineWinners', () => {
    const defaultPlayerInfo = { stack: 1000, currentBet: 20, isFolded: false };

    it('should correctly determine winner with higher pair', () => {
      const players = [
        {
          ...defaultPlayerInfo,
          id: 'player1',
          holeCards: [
            createCard('A', 'hearts'),
            createCard('K', 'diamonds')
          ]
        },
        {
          ...defaultPlayerInfo,
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
      expect(winners[0].winAmount).toBe(40); // Total pot 40 (20*2)
    });

    it('should correctly identify split pot', () => {
      const players = [
        {
          ...defaultPlayerInfo,
          id: 'player1',
          holeCards: [
            createCard('A', 'hearts'),
            createCard('K', 'diamonds')
          ]
        },
        {
          ...defaultPlayerInfo,
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
      expect(winners[0].winAmount).toBe(20); // Split pot 40/2
      expect(winners[1].winAmount).toBe(20);
    });

    it('should correctly handle all-in scenarios with side pots', () => {
      const players = [
        {
          id: 'p1',
          stack: 0,
          currentBet: 100,
          isFolded: false,
          holeCards: [
            createCard('A', 'hearts'),
            createCard('A', 'diamonds')
          ]
        },
        {
          id: 'p2',
          stack: 0,
          currentBet: 50,
          isFolded: false,
          holeCards: [
            createCard('K', 'clubs'),
            createCard('K', 'spades')
          ]
        },
        {
          id: 'p3',
          stack: 850,
          currentBet: 150,
          isFolded: false,
          holeCards: [
            createCard('Q', 'hearts'),
            createCard('Q', 'diamonds')
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
      const totalWinnings = winners.reduce((sum, w) => sum + w.winAmount, 0);
      expect(totalWinnings).toBe(300); // Total pot should be 100+50+150 = 300
      
      // Player 1 (AA) should win their eligible portions
      const p1Winnings = winners.find(w => w.playerId === 'p1')?.winAmount;
      expect(p1Winnings).toBeGreaterThan(150); // Should win main pot and side pot vs P3
    });

    it('should award pot to last remaining player when others fold', () => {
      const players = [
        {
          ...defaultPlayerInfo,
          id: 'player1',
          isFolded: true,
          holeCards: [
            createCard('2', 'hearts'),
            createCard('3', 'diamonds')
          ]
        },
        {
          ...defaultPlayerInfo,
          id: 'player2',
          isFolded: false,
          holeCards: [
            createCard('4', 'clubs'),
            createCard('5', 'spades')
          ]
        }
      ];

      const communityCards: Card[] = [];

      const winners = HandEvaluator.determineWinners(players, communityCards);
      expect(winners).toHaveLength(1);
      expect(winners[0].playerId).toBe('player2');
      expect(winners[0].description).toBe('Win by fold');
      expect(winners[0].winAmount).toBe(40);
    });

    it('should handle complex side pot scenario with multiple all-ins and split pots', () => {
      const players = [
        // Player 1 - all in for 50
        {
          id: 'p1',
          stack: 0,
          currentBet: 50,
          isFolded: false,
          holeCards: [
            createCard('A', 'hearts'),
            createCard('A', 'diamonds')
          ]
        },
        // Player 2 - all in for 100
        {
          id: 'p2',
          stack: 0,
          currentBet: 100,
          isFolded: false,
          holeCards: [
            createCard('A', 'clubs'),
            createCard('A', 'spades')
          ]
        },
        // Player 3 - called 150
        {
          id: 'p3',
          stack: 850,
          currentBet: 150,
          isFolded: false,
          holeCards: [
            createCard('K', 'hearts'),
            createCard('K', 'diamonds')
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
      const totalPot = players.reduce((sum, p) => sum + p.currentBet, 0);
      const totalWinnings = winners.reduce((sum, w) => sum + w.winAmount, 0);

      expect(totalWinnings).toBe(totalPot); // All money should be distributed
      
      // P1 and P2 should split the first pot since they have equal hands
      const p1Winnings = winners.find(w => w.playerId === 'p1')?.winAmount;
      const p2Winnings = winners.find(w => w.playerId === 'p2')?.winAmount;
      expect(p1Winnings).toBe(75); // (50 * 3) / 2 = 75 from main pot
      expect(p2Winnings).toBe(175); // 75 from main pot + 100 from first side pot
    });

    it('should handle edge case with single player not folded', () => {
      const players = [
        {
          id: 'p1',
          stack: 950,
          currentBet: 50,
          isFolded: true,
          holeCards: [
            createCard('2', 'hearts'),
            createCard('3', 'diamonds')
          ]
        },
        {
          id: 'p2',
          stack: 950,
          currentBet: 50,
          isFolded: true,
          holeCards: [
            createCard('4', 'hearts'),
            createCard('5', 'diamonds')
          ]
        },
        {
          id: 'p3',
          stack: 950,
          currentBet: 50,
          isFolded: false,
          holeCards: [
            createCard('6', 'hearts'),
            createCard('7', 'diamonds')
          ]
        }
      ];

      const communityCards: Card[] = [];
      const winners = HandEvaluator.determineWinners(players, communityCards);

      expect(winners).toHaveLength(1);
      expect(winners[0].playerId).toBe('p3');
      expect(winners[0].description).toBe('Win by fold');
      expect(winners[0].winAmount).toBe(150); // All bets go to p3
    });

    it('should handle edge case with zero pot amount', () => {
      const players = [
        {
          id: 'p1',
          stack: 1000,
          currentBet: 0,
          isFolded: false,
          holeCards: [
            createCard('A', 'hearts'),
            createCard('K', 'diamonds')
          ]
        },
        {
          id: 'p2',
          stack: 1000,
          currentBet: 0,
          isFolded: false,
          holeCards: [
            createCard('Q', 'hearts'),
            createCard('J', 'diamonds')
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
      expect(winners).toHaveLength(0); // No pot, no winners
    });
  });
});
