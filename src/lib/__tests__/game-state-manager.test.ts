import { GameStateManager } from '../poker/game-state-manager';
import { TableState, Player } from '../../types/poker';

describe('GameStateManager', () => {
  let state: TableState;
  let gameStateManager: GameStateManager;
  let player1: Player;
  let player2: Player;
  let player3: Player;

  beforeEach(() => {
    player1 = {
      id: 'p1',
      name: 'Player 1',
      position: 0,
      stack: 1000,
      currentBet: 0,
      hasActed: false,
      isFolded: false,
      isAllIn: false,
      timeBank: 30000
    };

    player2 = { ...player1, id: 'p2', name: 'Player 2', position: 1 };
    player3 = { ...player1, id: 'p3', name: 'Player 3', position: 2 };

    state = {
      tableId: 'table1',
      stage: 'preflop',
      players: [player1, player2, player3],
      activePlayer: '',
      pot: 0,
      communityCards: [],
      currentBet: 0,
      dealerPosition: 0,
      smallBlind: 10,
      bigBlind: 20,
      minRaise: 20,
      lastRaise: 0
    };

    gameStateManager = new GameStateManager(state);
  });

  describe('startBettingRound', () => {
    it('should set UTG as active player in preflop', () => {
      gameStateManager.startBettingRound('preflop');
      expect(state.activePlayer).toBe('p1'); // UTG (position 0)
    });

    it('should set SB as active player post-flop', () => {
      gameStateManager.startBettingRound('flop');
      expect(state.activePlayer).toBe('p2'); // SB (position 1)
    });

    it('should throw error if active player not found', () => {
      state.players = [];
      expect(() => gameStateManager.startBettingRound('preflop'))
        .toThrow('Could not find active player');
    });
  });

  describe('moveToNextStage', () => {
    it('should correctly progress through stages', () => {
      expect(gameStateManager.moveToNextStage()).toBe('flop');
      expect(gameStateManager.moveToNextStage()).toBe('turn');
      expect(gameStateManager.moveToNextStage()).toBe('river');
      expect(gameStateManager.moveToNextStage()).toBe('showdown');
    });

    it('should throw error at final stage', () => {
      state.stage = 'showdown';
      expect(() => gameStateManager.moveToNextStage())
        .toThrow('No next stage available');
    });
  });

  describe('resetPlayerStates', () => {
    it('should reset all player states', () => {
      player1.currentBet = 50;
      player1.hasActed = true;
      player1.isFolded = true;
      state.pot = 150;
      state.currentBet = 50;
      state.communityCards = [{ suit: 'hearts', rank: 'A' }];

      gameStateManager.resetPlayerStates();

      expect(player1.currentBet).toBe(0);
      expect(player1.hasActed).toBe(false);
      expect(player1.isFolded).toBe(false);
      expect(state.pot).toBe(0);
      expect(state.currentBet).toBe(0);
      expect(state.communityCards).toHaveLength(0);
    });
  });

  describe('rotateDealerButton', () => {
    it('should rotate dealer button correctly', () => {
      expect(state.dealerPosition).toBe(0);
      expect(gameStateManager.rotateDealerButton()).toBe(1);
      expect(gameStateManager.rotateDealerButton()).toBe(2);
      expect(gameStateManager.rotateDealerButton()).toBe(0);
    });
  });

  describe('findNextActivePlayer', () => {
    it('should find next active player', () => {
      const nextPlayer = gameStateManager.findNextActivePlayer(0);
      expect(nextPlayer?.id).toBe('p2');
    });

    it('should skip folded players', () => {
      player2.isFolded = true;
      const nextPlayer = gameStateManager.findNextActivePlayer(0);
      expect(nextPlayer?.id).toBe('p3');
    });

    it('should skip all-in players', () => {
      player2.isAllIn = true;
      const nextPlayer = gameStateManager.findNextActivePlayer(0);
      expect(nextPlayer?.id).toBe('p3');
    });

    it('should return undefined if no active players', () => {
      player1.isFolded = true;
      player2.isFolded = true;
      player3.isFolded = true;
      const nextPlayer = gameStateManager.findNextActivePlayer(0);
      expect(nextPlayer).toBeUndefined();
    });
  });
});
