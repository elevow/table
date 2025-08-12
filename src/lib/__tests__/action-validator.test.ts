import { ActionValidator } from '../action-validator';
import { PlayerAction, TableState, Player } from '../../types/poker';

describe('ActionValidator', () => {
  let mockState: TableState;
  let mockPlayer: Player;

  beforeEach(() => {
    mockPlayer = {
      id: 'player1',
      name: 'Player 1',
      stack: 1000,
      currentBet: 0,
      hasActed: false,
      isFolded: false,
      isAllIn: false,
      position: 0,
      timeBank: 30000
    };

    mockState = {
      tableId: 'table1',
      stage: 'preflop',
      players: [mockPlayer],
      activePlayer: 'player1',
      pot: 0,
      communityCards: [],
      currentBet: 0,
      dealerPosition: 0,
      smallBlind: 10,
      bigBlind: 20,
      minRaise: 20,
      lastRaise: 0
    };
  });

  describe('validateAction', () => {
    it('should validate fold action', () => {
      const action: PlayerAction = {
        type: 'fold',
        playerId: 'player1',
        tableId: 'table1',
        timestamp: Date.now()
      };

      const result = ActionValidator.validateAction(action, mockState, mockPlayer);
      expect(result.valid).toBe(true);
    });

    it('should validate call action', () => {
      mockState.currentBet = 50;
      const action: PlayerAction = {
        type: 'call',
        playerId: 'player1',
        tableId: 'table1',
        timestamp: Date.now()
      };

      const result = ActionValidator.validateAction(action, mockState, mockPlayer);
      expect(result.valid).toBe(true);
    });

    it('should validate bet action', () => {
      const action: PlayerAction = {
        type: 'bet',
        playerId: 'player1',
        tableId: 'table1',
        amount: 100,
        timestamp: Date.now()
      };

      const result = ActionValidator.validateAction(action, mockState, mockPlayer);
      expect(result.valid).toBe(true);
    });

    it('should validate raise action', () => {
      mockState.currentBet = 50;
      const action: PlayerAction = {
        type: 'raise',
        playerId: 'player1',
        tableId: 'table1',
        amount: 150,
        timestamp: Date.now()
      };

      const result = ActionValidator.validateAction(action, mockState, mockPlayer);
      expect(result.valid).toBe(true);
    });

    it('should reject action when not player\'s turn', () => {
      mockState.activePlayer = 'player2';
      const action: PlayerAction = {
        type: 'bet',
        playerId: 'player1',
        tableId: 'table1',
        amount: 100,
        timestamp: Date.now()
      };

      const result = ActionValidator.validateAction(action, mockState, mockPlayer);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Not player\'s turn');
    });

    it('should reject bet less than big blind', () => {
      const action: PlayerAction = {
        type: 'bet',
        playerId: 'player1',
        tableId: 'table1',
        amount: 10,
        timestamp: Date.now()
      };

      const result = ActionValidator.validateAction(action, mockState, mockPlayer);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Bet must be at least 20 chips');
    });

    it('should reject raise less than minimum raise', () => {
      mockState.currentBet = 50;
      mockState.minRaise = 50;
      const action: PlayerAction = {
        type: 'raise',
        playerId: 'player1',
        tableId: 'table1',
        amount: 80,
        timestamp: Date.now()
      };

      const result = ActionValidator.validateAction(action, mockState, mockPlayer);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Raise must be at least 100 chips');
    });
  });

  describe('calculateActionEffects', () => {
    it('should calculate call effects', () => {
      mockState.currentBet = 100;
      const action: PlayerAction = {
        type: 'call',
        playerId: 'player1',
        tableId: 'table1',
        timestamp: Date.now()
      };

      const effects = ActionValidator.calculateActionEffects(action, mockState, mockPlayer);
      expect(effects.potDelta).toBe(100);
      expect(effects.stackDelta).toBe(-100);
      expect(effects.newCurrentBet).toBe(100);
    });

    it('should calculate bet effects', () => {
      const action: PlayerAction = {
        type: 'bet',
        playerId: 'player1',
        tableId: 'table1',
        amount: 200,
        timestamp: Date.now()
      };

      const effects = ActionValidator.calculateActionEffects(action, mockState, mockPlayer);
      expect(effects.potDelta).toBe(200);
      expect(effects.stackDelta).toBe(-200);
      expect(effects.newCurrentBet).toBe(200);
      expect(effects.newMinRaise).toBe(200);
    });

    it('should calculate raise effects', () => {
      mockState.currentBet = 100;
      const action: PlayerAction = {
        type: 'raise',
        playerId: 'player1',
        tableId: 'table1',
        amount: 300,
        timestamp: Date.now()
      };

      const effects = ActionValidator.calculateActionEffects(action, mockState, mockPlayer);
      expect(effects.potDelta).toBe(300);
      expect(effects.stackDelta).toBe(-300);
      expect(effects.newCurrentBet).toBe(300);
      expect(effects.newMinRaise).toBe(200);
    });
  });
});
