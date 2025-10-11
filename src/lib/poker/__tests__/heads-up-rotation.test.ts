import { GameStateManager } from '../game-state-manager';
import { TableState, Player } from '../../../types/poker';

describe('Heads-up starting player rotation', () => {
  let state: TableState;
  let gameStateManager: GameStateManager;

  beforeEach(() => {
    const p1: Player = { id: 'p1', name: 'P1', position: 1, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 };
    const p2: Player = { id: 'p2', name: 'P2', position: 2, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 };
    state = {
      tableId: 't-hu',
      stage: 'preflop',
      players: [p1, p2],
      activePlayer: '',
      pot: 0,
      communityCards: [],
      currentBet: 0,
      dealerPosition: 0, // p1 is dealer (button)
      smallBlind: 5,
      bigBlind: 10,
      minRaise: 10,
      lastRaise: 0,
    };
    gameStateManager = new GameStateManager(state);
  });

  it('preflop: dealer acts first; postflop: non-dealer acts first', () => {
    // Preflop should start with dealer (p1)
    gameStateManager.startBettingRound('preflop');
    expect(state.activePlayer).toBe('p1');

    // Postflop (flop) should start with non-dealer (p2)
    gameStateManager.startBettingRound('flop');
    expect(state.activePlayer).toBe('p2');
  });
});
