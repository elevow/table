import { PokerEngine } from '../../poker/poker-engine';
import { buildGameFlow } from '../../poker/game-flow';
import { Player } from '../../../types/poker';

function createPlayer(id: string, position: number, stack: number = 1000): Player {
  return {
    id,
    name: id,
    position,
    stack,
    currentBet: 0,
    hasActed: false,
    isFolded: false,
    isAllIn: false,
    timeBank: 30000,
  };
}

describe('US-025: Basic Game Flow', () => {
  it('pre-game setup assigns positions, posts blinds, and deals hole cards', () => {
    const players = [
      createPlayer('p1', 0), // UTG
      createPlayer('p2', 1), // SB
      createPlayer('p3', 2), // BB
    ];
    const engine = new PokerEngine('t1', players, 5, 10);
    engine.startNewHand();

    const state = engine.getState();
    const flow = buildGameFlow(state);

    // Stage and blinds visible in GameFlow
    expect(flow.stage).toBe('preflop');
    expect(flow.blinds.small).toBe(5);
    expect(flow.blinds.big).toBe(10);

    // Button starts at 1 after rotation for a new hand
    expect(typeof flow.button).toBe('number');

    // Positions mapped
    expect(flow.positions.get('p1')).toBe(0);
    expect(flow.positions.get('p2')).toBe(1);
    expect(flow.positions.get('p3')).toBe(2);

    // Blinds should be posted into the pot
    expect(flow.pot).toBeGreaterThanOrEqual(15);
    expect(flow.currentBet).toBe(10);

    // Hole cards dealt
    state.players.forEach(p => expect(p.holeCards?.length).toBe(2));
  });

  it('progresses through betting rounds and reaches showdown', () => {
    const players = [
      createPlayer('p1', 0),
      createPlayer('p2', 1),
      createPlayer('p3', 2),
    ];
    const engine = new PokerEngine('t1', players, 5, 10);
    engine.startNewHand();
    let state = engine.getState();

    // Helper: complete a betting round by calling to match current bet
    const completeRound = () => {
      const stage = state.stage;
      // Safety: break if no activePlayer for any reason
      let guard = 20;
      while (state.stage === stage && state.activePlayer && guard-- > 0) {
        engine.handleAction({ type: 'call', amount: state.currentBet, playerId: state.activePlayer, tableId: state.tableId, timestamp: Date.now() });
        state = engine.getState();
      }
    };

    // Preflop -> Flop (deal 3)
    completeRound();
    state = engine.getState();
    expect(state.stage).toBe('flop');
    expect(state.communityCards.length).toBe(3);

    // Flop -> Turn (deal 1)
    completeRound();
    state = engine.getState();
    expect(state.stage).toBe('turn');
    expect(state.communityCards.length).toBe(4);

    // Turn -> River (deal 1)
    completeRound();
    state = engine.getState();
    expect(state.stage).toBe('river');
    expect(state.communityCards.length).toBe(5);

    // River -> Showdown
    completeRound();
    state = engine.getState();
    expect(state.stage).toBe('showdown');
    // After showdown, pot should be distributed (0 or small rounding left)
    expect(state.pot).toBe(0);
  });
});
