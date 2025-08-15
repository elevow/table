import { BettingManager } from '../poker/betting-manager';
import { Player } from '../../types/poker';
import { PlayerAction } from '../../types/poker-engine';

describe('BettingManager', () => {
  let bettingManager: BettingManager;
  let player1: Player;
  let player2: Player;

  beforeEach(() => {
    bettingManager = new BettingManager(10, 20); // SB: 10, BB: 20
    
    player1 = {
      id: 'p1',
      name: 'Player 1',
      position: 1,
      stack: 1000,
      currentBet: 0,
      hasActed: false,
      isFolded: false,
      isAllIn: false,
      timeBank: 30000
    };

    player2 = {
      id: 'p2',
      name: 'Player 2',
      position: 2,
      stack: 1000,
      currentBet: 0,
      hasActed: false,
      isFolded: false,
      isAllIn: false,
      timeBank: 30000
    };
  });

  describe('placeBet', () => {
    it('should correctly place a bet and update player state', () => {
      const amount = bettingManager.placeBet(player1, 50);
      
      expect(amount).toBe(50);
      expect(player1.stack).toBe(950);
      expect(player1.currentBet).toBe(50);
      expect(player1.isAllIn).toBe(false);
    });

    it('should handle all-in situations', () => {
      const amount = bettingManager.placeBet(player1, 1200); // More than stack
      
      expect(amount).toBe(1000); // Should only bet available stack
      expect(player1.stack).toBe(0);
      expect(player1.currentBet).toBe(1000);
      expect(player1.isAllIn).toBe(true);
    });
  });

  describe('postBlinds', () => {
    it('should correctly post small and big blinds', () => {
      const players = [player1, player2];
      const { pot, currentBet } = bettingManager.postBlinds(players);

      expect(pot).toBe(30); // SB(10) + BB(20)
      expect(currentBet).toBe(20); // BB amount
      expect(player1.currentBet).toBe(10); // SB
      expect(player2.currentBet).toBe(20); // BB
      expect(player1.stack).toBe(990);
      expect(player2.stack).toBe(980);
    });

    it('should throw error if blinds positions not found', () => {
      const players = [{ ...player1, position: 3 }];
      expect(() => bettingManager.postBlinds(players))
        .toThrow('Could not find small blind player');
    });
  });

  describe('processAction', () => {
    it('should handle fold action', () => {
      const action: PlayerAction = { type: 'fold', playerId: 'p1' };
      const result = bettingManager.processAction(player1, action, 20, 20);

      expect(result.pot).toBe(0);
      expect(player1.isFolded).toBe(true);
      expect(player1.hasActed).toBe(true);
    });

    it('should handle call action', () => {
      const currentBet = 50;
      const action: PlayerAction = { type: 'call', playerId: 'p1' };
      const result = bettingManager.processAction(player1, action, currentBet, 20);

      expect(result.pot).toBe(50);
      expect(player1.currentBet).toBe(50);
      expect(player1.hasActed).toBe(true);
    });

    it('should handle raise action', () => {
      const action: PlayerAction = { 
        type: 'raise', 
        playerId: 'p1',
        amount: 100
      };
      const result = bettingManager.processAction(player1, action, 20, 20);

      expect(result.currentBet).toBe(100);
      expect(result.minRaise).toBe(80); // Raise amount (100 - current bet 20)
      expect(player1.currentBet).toBe(100);
      expect(player1.hasActed).toBe(true);
    });

    it('should handle check action', () => {
      const action: PlayerAction = { type: 'check', playerId: 'p1' };
      const result = bettingManager.processAction(player1, action, 0, 20);

      expect(result.pot).toBe(0);
      expect(player1.hasActed).toBe(true);
    });

    it('should throw error on invalid check', () => {
      const action: PlayerAction = { type: 'check', playerId: 'p1' };
      expect(() => bettingManager.processAction(player1, action, 20, 20))
        .toThrow('Cannot check when there is a bet');
    });

    it('should throw error on invalid raise', () => {
      const action: PlayerAction = { 
        type: 'raise', 
        playerId: 'p1',
        amount: 30 // Less than min raise
      };
      expect(() => bettingManager.processAction(player1, action, 20, 20))
        .toThrow('Invalid raise amount');
    });
  });
});
