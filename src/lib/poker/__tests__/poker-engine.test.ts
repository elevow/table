import { PokerEngine } from '../poker-engine';
import { DeckManager } from '../deck-manager';
import { Card, Player, PlayerAction, TableState } from '../../../types/poker';

describe('PokerEngine', () => {
  const createPlayer = (
    id: string,
    position: number,
    stack: number = 1000
  ): Player => ({
    id,
    name: `Player ${id}`,
    position,
    stack,
    currentBet: 0,
    hasActed: false,
    isFolded: false,
    isAllIn: false,
    timeBank: 30000
  });

  const createCard = (
    rank: '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K'|'A',
    suit: 'hearts'|'diamonds'|'clubs'|'spades'
  ): Card => ({ rank, suit });

  const createAction = (
    type: PlayerAction['type'],
    playerId: string,
    amount: number
  ): PlayerAction => ({
    type,
    playerId,
    amount,
    tableId: 'table1',
    timestamp: Date.now()
  });

  describe('Game Initialization', () => {
    it('should initialize game state correctly', () => {
      const players = [
        createPlayer('p1', 0),
        createPlayer('p2', 1),
        createPlayer('p3', 2)
      ];
      const engine = new PokerEngine('table1', players, 5, 10);
      const state = engine.getState();

      expect(state).toEqual({
        tableId: 'table1',
        stage: 'preflop',
        players,
        activePlayer: '',
        pot: 0,
        communityCards: [],
        currentBet: 0,
        dealerPosition: 0,
        smallBlind: 5,
        bigBlind: 10,
        minRaise: 10,
        lastRaise: 0
      });
    });
  });

  describe('Starting New Hand', () => {
    it('should deal hole cards and post blinds when starting new hand', () => {
      const players = [
        createPlayer('p1', 0), // Dealer
        createPlayer('p2', 1), // Small blind
        createPlayer('p3', 2)  // Big blind
      ];
      const engine = new PokerEngine('table1', players, 5, 10);
      engine.startNewHand();
      const state = engine.getState();

      // Check that hole cards were dealt
      state.players.forEach(player => {
        expect(player.holeCards).toBeDefined();
        expect(player.holeCards?.length).toBe(2);
      });

      // The blinds are the two players after the button
      const d = state.dealerPosition;
      const smallBlindPlayer = state.players[(d + 1) % 3];
      const bigBlindPlayer = state.players[(d + 2) % 3];
      expect(smallBlindPlayer).toBeDefined();
      expect(bigBlindPlayer).toBeDefined();
      
      expect(smallBlindPlayer?.currentBet).toBe(5);
      expect(bigBlindPlayer?.currentBet).toBe(10);
      expect(state.pot).toBe(15);
      expect(state.currentBet).toBe(10);
      expect(state.minRaise).toBe(10);
    });
  });

  describe('Player Actions', () => {
    it('should process valid player actions', () => {
      const players = [
        createPlayer('p1', 0),
        createPlayer('p2', 1),
        createPlayer('p3', 2)
      ];
      const engine = new PokerEngine('table1', players, 5, 10);
      engine.startNewHand();
      let state = engine.getState();

      // Find active player
      const activePlayer = state.players.find(p => p.id === state.activePlayer);
      expect(activePlayer).toBeDefined();

      // Test call action
      const action = createAction('call', activePlayer!.id, state.currentBet);

      engine.handleAction(action);
      state = engine.getState();

      expect(state.pot).toBeGreaterThan(15); // Original pot was 15 from blinds
      expect(state.activePlayer).not.toBe(activePlayer!.id); // Should move to next player
    });

    it('should throw error for invalid player action', () => {
      const players = [
        createPlayer('p1', 0),
        createPlayer('p2', 1),
        createPlayer('p3', 2)
      ];
      const engine = new PokerEngine('table1', players, 5, 10);
      engine.startNewHand();

      const invalidAction = createAction('call', 'invalid-player', 10);

      expect(() => {
        engine.handleAction(invalidAction);
      }).toThrow('Player not found');
    });

    it('should handle raise action correctly', () => {
      const players = [
        createPlayer('p1', 0),
        createPlayer('p2', 1),
        createPlayer('p3', 2)
      ];
      const engine = new PokerEngine('table1', players, 5, 10);
      engine.startNewHand();
      let state = engine.getState();

      // The min raise should be at least the big blind size
      const raiseAmount = state.currentBet + 10; // Current bet (10) + min raise size (10) = 20
      const raiseAction = createAction('raise', state.activePlayer, raiseAmount);

      engine.handleAction(raiseAction);
      state = engine.getState();

      expect(state.currentBet).toBe(20); // New bet should be 20
      expect(state.minRaise).toBe(10); // Min raise should stay at big blind size
    });
  });

  describe('Stage Transitions', () => {
    it('should deal flop after preflop round completes', () => {
      const players = [
        createPlayer('p1', 0),
        createPlayer('p2', 1),
        createPlayer('p3', 2)
      ];
      const engine = new PokerEngine('table1', players, 5, 10);
      engine.startNewHand();
      let state = engine.getState();

      // Complete preflop round with calls
      let guard = 50; // Safety guard to prevent infinite loops
      while (state.stage === 'preflop' && guard-- > 0) {
        if (state.activePlayer) {
          engine.handleAction(createAction('call', state.activePlayer, state.currentBet));
        }
        state = engine.getState();
      }

      expect(state.stage).toBe('flop');
      expect(state.communityCards.length).toBe(3);
    });

    it('should deal turn and river cards at appropriate stages', () => {
      const players = [
        createPlayer('p1', 0),
        createPlayer('p2', 1),
        createPlayer('p3', 2)
      ];
      const engine = new PokerEngine('table1', players, 5, 10);
      engine.startNewHand();
      let state = engine.getState();

      // Helper function to complete betting round
      const completeBettingRound = () => {
        const currentStage = state.stage;
        while (state.stage === currentStage && state.activePlayer) {
          engine.handleAction(createAction('call', state.activePlayer, state.currentBet));
          state = engine.getState();
        }
      };

      // Helper function to ensure all remaining players have acted
      const allPlayersActed = () => {
        const bettingPlayers = state.players.filter(p => !p.isFolded && !p.isAllIn);
        const currentBet = state.currentBet;
        return bettingPlayers.every(p => p.hasActed && p.currentBet === currentBet);
      };

      // Complete preflop
      completeBettingRound();
      expect(state.stage).toBe('flop');
      expect(state.communityCards.length).toBe(3);
      
      state.players.forEach(p => { p.hasActed = false; }); // Reset for next round

      // Complete flop
      completeBettingRound();
      expect(state.stage).toBe('turn');
      expect(state.communityCards.length).toBe(4);
      
      state.players.forEach(p => { p.hasActed = false; }); // Reset for next round

      // Complete turn
      completeBettingRound();
      expect(state.stage).toBe('river');
      expect(state.communityCards.length).toBe(5);
      
      state.players.forEach(p => { p.hasActed = false; }); // Reset for next round

      // Complete river - should go to showdown
      completeBettingRound();
      expect(state.stage).toBe('showdown');
      expect(state.communityCards.length).toBe(5);
    });
  });

  describe('Winner Determination', () => {
    it('should handle win by fold', () => {
      const players = [
        createPlayer('p1', 0),
        createPlayer('p2', 1),
        createPlayer('p3', 2)
      ];
      const initialStack = 1000;
      const engine = new PokerEngine('table1', players, 5, 10);
      engine.startNewHand();
      let state = engine.getState();

      // The first player to act calls, the blinds fold
      const caller = state.activePlayer;
      let guard2 = 50; // Safety guard to prevent infinite loops
      while (state.stage === 'preflop' && guard2-- > 0) {
        if (state.activePlayer) {
          const action = state.activePlayer === caller ? 'call' : 'fold';
          engine.handleAction(createAction(action, state.activePlayer, state.currentBet));
        }
        state = engine.getState();
      }

      // First player should win the entire pot (25 = 5 + 10 + 10)
      const winner = state.players.find(p => !p.isFolded);
      expect(winner).toBeDefined();
      expect(winner!.stack).toBe(initialStack - 10 + 25); // Initial - call amount + pot
    });

    it('should correctly determine winner in showdown', () => {
      const players = [
        createPlayer('p1', 0), // Dealer
        createPlayer('p2', 1), // Small blind
        createPlayer('p3', 2)  // Big blind
      ];
      const initialStack = 1000;
      const engine = new PokerEngine('table1', players, 5, 10);
      engine.startNewHand();

      // Fix the cards so the hand can't end in a split pot: p1 makes a royal flush.
      // The deck deals from the end, so the board comes out Qh Jh 10h, then 2c, then 3d.
      const internal = (engine as any).state as TableState;
      const hole: Record<string, Card[]> = {
        p1: [{ rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'hearts' }],
        p2: [{ rank: '4', suit: 'clubs' }, { rank: '5', suit: 'diamonds' }],
        p3: [{ rank: '6', suit: 'clubs' }, { rank: '7', suit: 'diamonds' }],
      };
      internal.players.forEach(p => { p.holeCards = hole[p.id]; });
      const board: Card[] = [
        { rank: 'Q', suit: 'hearts' }, { rank: 'J', suit: 'hearts' }, { rank: '10', suit: 'hearts' },
        { rank: '2', suit: 'clubs' }, { rank: '3', suit: 'diamonds' },
      ];
      (engine as any).deckManager = DeckManager.fromSerialized([...board].reverse());
      let state = engine.getState();

      // Complete all betting rounds with calls
      let guard3 = 100; // Safety guard to prevent infinite loops
      while (state.stage !== 'showdown' && guard3-- > 0) {
        if (state.activePlayer) {
          engine.handleAction(createAction('call', state.activePlayer, state.currentBet));
        }
        state = engine.getState();
      }

      // Check that pot was distributed
      expect(state.stage).toBe('showdown');
      expect(state.pot).toBe(0); // Pot should be empty after distribution
      const stackOf = (id: string) => state.players.find(p => p.id === id)!.stack;
      expect(stackOf('p1')).toBeGreaterThan(initialStack); // p1's royal flush wins
      expect(stackOf('p2')).toBeLessThan(initialStack);
      expect(stackOf('p3')).toBeLessThan(initialStack);
      expect(state.players.reduce((sum, p) => sum + p.stack, 0)).toBe(initialStack * players.length); // Total chips should remain constant
    });
  });

  describe('Run-It-Twice prompt persistence', () => {
    it('should preserve the active prompt through engine serialization', () => {
      const engine = new PokerEngine('table1', [createPlayer('p1', 0), createPlayer('p2', 1)], 5, 10);
      const prompt = {
        playerId: 'p1',
        reason: 'lowest-hand' as const,
        createdAt: Date.now(),
        boardCardsCount: 0,
      };

      engine.setRunItTwicePrompt(prompt);
      const restored = PokerEngine.fromSerialized(engine.serialize());

      expect(restored.getState().runItTwicePrompt).toEqual(prompt);
      expect(restored.getState().activePlayer).toBe('p1');
    });
  });

  it('clears the active player during automatic all-in runout', () => {
    const engine = new PokerEngine('table1', [createPlayer('p1', 0), createPlayer('p2', 1)], 5, 10);
    const communityCards = [createCard('2', 'hearts'), createCard('3', 'clubs'), createCard('4', 'spades')];

    engine.setAutoRunoutProgress('flop', communityCards);

    expect(engine.getState()).toEqual(expect.objectContaining({
      stage: 'flop',
      communityCards,
      activePlayer: '',
    }));
  });

  it('runs out the remaining streets automatically in seven-card stud', () => {
    const engine = new PokerEngine(
      'table1',
      [createPlayer('p1', 0), createPlayer('p2', 1)],
      5,
      10,
      { variant: 'seven-card-stud' },
    );
    engine.startNewHand();

    engine.runStudAllInToShowdown();

    const state = engine.getState();
    expect(state.stage).toBe('showdown');
    expect(state.activePlayer).toBe('');
    state.players.forEach(player => {
      const cards = state.studState?.playerCards[player.id];
      expect((cards?.downCards.length || 0) + (cards?.upCards.length || 0)).toBe(7);
    });
  });
});
