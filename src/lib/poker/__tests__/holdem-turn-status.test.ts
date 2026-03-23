import { PokerEngine } from '../poker-engine';
describe('Holdem Turn Status - Stage Transition Race Condition', () => {
  const players = [
    { id: 'player-21', name: 'Player21', position: 0, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 0 },
    { id: 'player-55', name: 'Player55', position: 1, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 0 },
  ];
  const completeBettingRound = (engine: PokerEngine) => {
    const startStage = engine.getState().stage;
    let iterations = 0;
    const maxIterations = 20;
    while (engine.getState().stage === startStage && iterations < maxIterations) {
      const state = engine.getState();
      const activePlayerId = state.activePlayer;
      try {
        engine.handleAction({ type: 'check', playerId: activePlayerId, tableId: state.tableId, timestamp: Date.now() });
      } catch {
        engine.handleAction({ type: 'call', playerId: activePlayerId, tableId: state.tableId, amount: state.currentBet, timestamp: Date.now() });
      }
      iterations++;
    }
  };
  test('activePlayer is set atomically on flop transition', () => {
    const engine = new PokerEngine('holdem-flop-test', players, 5, 10);
    engine.startNewHand();
    expect(engine.getState().stage).toBe('preflop');
    completeBettingRound(engine);
    const stateAfterFlop = engine.getState();
    expect(stateAfterFlop.stage).toBe('flop');
    expect(stateAfterFlop.communityCards.length).toBe(3);
    // activePlayer must be set immediately and unambiguously
    expect(stateAfterFlop.activePlayer).toBeTruthy();
    expect(stateAfterFlop.activePlayer).not.toBe('');
    expect([players[0].id, players[1].id]).toContain(stateAfterFlop.activePlayer);
  });
  test('activePlayer is set atomically on turn transition', () => {
    const engine = new PokerEngine('holdem-turn-test', players, 5, 10);
    engine.startNewHand();
    completeBettingRound(engine); // preflop -> flop
    expect(engine.getState().stage).toBe('flop');
    completeBettingRound(engine); // flop -> turn
    const stateAfterTurn = engine.getState();
    expect(stateAfterTurn.stage).toBe('turn');
    expect(stateAfterTurn.communityCards.length).toBe(4);
    expect(stateAfterTurn.activePlayer).toBeTruthy();
    expect(stateAfterTurn.activePlayer).not.toBe('');
    expect([players[0].id, players[1].id]).toContain(stateAfterTurn.activePlayer);
  });
  test('activePlayer is set atomically on river transition', () => {
    const engine = new PokerEngine('holdem-river-test', players, 5, 10);
    engine.startNewHand();
    completeBettingRound(engine); // preflop -> flop
    completeBettingRound(engine); // flop -> turn
    completeBettingRound(engine); // turn -> river
    const stateAfterRiver = engine.getState();
    expect(stateAfterRiver.stage).toBe('river');
    expect(stateAfterRiver.communityCards.length).toBe(5);
    expect(stateAfterRiver.activePlayer).toBeTruthy();
    expect(stateAfterRiver.activePlayer).not.toBe('');
    expect([players[0].id, players[1].id]).toContain(stateAfterRiver.activePlayer);
  });
  test('neither player sees isMyTurn simultaneously at different streets', () => {
    // Reproduce the bug scenario: check then bet causes the next street
    // to have conflicting activePlayer states for the two players
    const engine = new PokerEngine('holdem-conflict-test', players, 5, 10);
    engine.startNewHand();
    // Complete preflop
    completeBettingRound(engine);
    expect(engine.getState().stage).toBe('flop');
    // On flop: first player checks, second player bets, first player calls
    const stateFlop1 = engine.getState();
    const firstToActFlop = stateFlop1.activePlayer;
    engine.handleAction({ type: 'check', playerId: firstToActFlop, tableId: stateFlop1.tableId, timestamp: Date.now() });
    const stateFlop2 = engine.getState();
    const secondToActFlop = stateFlop2.activePlayer;
    expect(secondToActFlop).not.toBe(firstToActFlop);
    engine.handleAction({ type: 'bet', playerId: secondToActFlop, tableId: stateFlop2.tableId, amount: 20, timestamp: Date.now() });
    const stateFlop3 = engine.getState();
    expect(stateFlop3.activePlayer).toBe(firstToActFlop);
    engine.handleAction({ type: 'call', playerId: firstToActFlop, tableId: stateFlop3.tableId, timestamp: Date.now() });
    // After flop completes -> turn
    const stateAfterTurn = engine.getState();
    expect(stateAfterTurn.stage).toBe('turn');
    // Only one player should have isMyTurn === true
    const turnActivePlayer = stateAfterTurn.activePlayer;
    expect(turnActivePlayer).toBeTruthy();
    expect(turnActivePlayer).not.toBe('');
    // Exactly one player should be active
    const player21IsActive = turnActivePlayer === players[0].id;
    const player55IsActive = turnActivePlayer === players[1].id;
    expect(player21IsActive !== player55IsActive).toBe(true);
  });
});