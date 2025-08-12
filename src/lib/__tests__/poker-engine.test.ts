import { PokerEngine } from '../poker-engine';
import { Player, Card, PlayerAction } from '../../types/poker';

describe('PokerEngine', () => {
  let engine: PokerEngine;
  let players: Player[];

  beforeEach(() => {
    players = [
      { id: 'player1', name: 'Player 1', stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, position: 0, timeBank: 30000 }, // Dealer
      { id: 'player2', name: 'Player 2', stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, position: 1, timeBank: 30000 }, // SB
      { id: 'player3', name: 'Player 3', stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, position: 2, timeBank: 30000 }, // BB
    ];
    engine = new PokerEngine('table1', players, 10, 20);
  });

  describe('initialization', () => {
    it('should initialize with correct state', () => {
      const state = engine.getState();
      expect(state.tableId).toBe('table1');
      expect(state.stage).toBe('preflop');
      expect(state.players).toHaveLength(3);
      expect(state.pot).toBe(0);
      expect(state.communityCards).toHaveLength(0);
      expect(state.dealerPosition).toBe(0);
      expect(state.smallBlind).toBe(10);
      expect(state.bigBlind).toBe(20);
    });
  });

  describe('startNewHand', () => {
    it('should deal cards to all players', () => {
      engine.startNewHand();
      const state = engine.getState();
      
      state.players.forEach(player => {
        expect(player.holeCards).toBeDefined();
        expect(player.holeCards).toHaveLength(2);
      });
    });

    it('should post blinds correctly', () => {
      engine.startNewHand();
      const state = engine.getState();
      
      // Small blind should be posted by player in position 1
      const sbPlayer = state.players.find(p => p.position === 1);
      expect(sbPlayer?.currentBet).toBe(10);
      expect(sbPlayer?.stack).toBe(990);
      
      // Big blind should be posted by player in position 2
      const bbPlayer = state.players.find(p => p.position === 2);
      expect(bbPlayer?.currentBet).toBe(20);
      expect(bbPlayer?.stack).toBe(980);
    });

    it('should set correct initial active player', () => {
      engine.startNewHand();
      const state = engine.getState();
      
      // First to act should be UTG (player 1)
      expect(state.activePlayer).toBe('player1');
    });
  });

  describe('handleAction', () => {
    beforeEach(() => {
      engine.startNewHand();
    });

    it('should handle fold action correctly', () => {
      const foldAction: PlayerAction = {
        type: 'fold',
        playerId: 'player1',
        timestamp: Date.now()
      };

      engine.handleAction(foldAction);
      const state = engine.getState();
      
      const foldedPlayer = state.players.find(p => p.id === 'player1');
      expect(foldedPlayer?.isFolded).toBe(true);
      expect(state.activePlayer).not.toBe('player1');
    });

    it('should handle call action correctly', () => {
      const callAction: PlayerAction = {
        type: 'call',
        playerId: 'player1',
        timestamp: Date.now()
      };

      engine.handleAction(callAction);
      const state = engine.getState();
      
      const callingPlayer = state.players.find(p => p.id === 'player1');
      expect(callingPlayer?.currentBet).toBe(20); // Should match big blind
      expect(callingPlayer?.stack).toBe(980);
      expect(state.pot).toBe(50); // SB(10) + BB(20) + Call(20)
    });

    it('should handle raise action correctly', () => {
      const raiseAction: PlayerAction = {
        type: 'raise',
        playerId: 'player1',
        amount: 60, // Raise to 60
        timestamp: Date.now()
      };

      engine.handleAction(raiseAction);
      const state = engine.getState();
      
      const raisingPlayer = state.players.find(p => p.id === 'player1');
      expect(raisingPlayer?.currentBet).toBe(60);
      expect(state.currentBet).toBe(60);
      expect(state.minRaise).toBe(40); // The raise amount (60 - 20)
    });

    it('should throw error for invalid check', () => {
      const checkAction: PlayerAction = {
        type: 'check',
        playerId: 'player1',
        timestamp: Date.now()
      };

      // Should throw because there's already a bet (big blind)
      expect(() => engine.handleAction(checkAction)).toThrow();
    });

    it('should throw error when acting out of turn', () => {
      const action: PlayerAction = {
        type: 'call',
        playerId: 'player2', // Not the active player
        timestamp: Date.now()
      };

      expect(() => engine.handleAction(action)).toThrow();
    });
  });

  describe('game progression', () => {
    beforeEach(() => {
      engine.startNewHand();
    });

    it('should progress to flop after preflop round completes', () => {
      // Complete preflop round
      engine.handleAction({ type: 'call', playerId: 'player1', timestamp: Date.now() });
      engine.handleAction({ type: 'call', playerId: 'player2', timestamp: Date.now() });
      engine.handleAction({ type: 'check', playerId: 'player3', timestamp: Date.now() });

      const state = engine.getState();
      expect(state.stage).toBe('flop');
      expect(state.communityCards).toHaveLength(3);
    });

    it('should handle all-in scenario', () => {
      // Player 1 goes all-in
      engine.handleAction({ 
        type: 'raise', 
        playerId: 'player1',
        amount: 1000,
        timestamp: Date.now()
      });

      const state = engine.getState();
      const allInPlayer = state.players.find(p => p.id === 'player1');
      expect(allInPlayer?.isAllIn).toBe(true);
      expect(allInPlayer?.stack).toBe(0);
    });
  });
});
