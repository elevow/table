import { createPokerEngine } from '../engine-factory';

describe('Stud Turn Status Bug - Fifth Street', () => {
  const players = [
    { id: 'player-check', name: 'CheckPlayer', position: 0, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 0 },
    { id: 'player-bet', name: 'BetPlayer', position: 1, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 0 },
  ];

  test('activePlayer should be correctly set immediately after transitioning to fifth street', () => {
    const engine = createPokerEngine({
      tableId: 'stud-turn-test',
      players,
      smallBlind: 5,
      bigBlind: 10,
      state: { variant: 'seven-card-stud' }
    });

    // Start hand: two down + one up dealt automatically
    engine.startNewHand();
    const initialState = engine.getState();
    expect(initialState.stage).toBe('third');

    // Helper to complete a betting round
    const completeBettingRound = () => {
      let iterations = 0;
      const maxIterations = 10;
      const startStage = engine.getState().stage;

      while (engine.getState().stage === startStage && iterations < maxIterations) {
        const state = engine.getState();
        const activePlayerId = state.activePlayer;

        // Use check action to advance through the round
        try {
          engine.handleAction({
            type: 'check',
            playerId: activePlayerId,
            tableId: state.tableId,
            timestamp: Date.now()
          });
        } catch (e) {
          // If check fails, try call (in case there's a bet)
          engine.handleAction({
            type: 'call',
            playerId: activePlayerId,
            tableId: state.tableId,
            timestamp: Date.now()
          });
        }
        iterations++;
      }
    };

    // Complete third street betting
    completeBettingRound();
    const afterThird = engine.getState();
    expect(afterThird.stage).toBe('fourth');
    // activePlayer should be set correctly for fourth street
    expect(afterThird.activePlayer).toBeTruthy();
    expect(afterThird.activePlayer).not.toBe('');
    const fourthStreetActivePlayer = afterThird.activePlayer;

    // Complete fourth street betting with a check then a bet scenario
    // First player checks
    const state4 = engine.getState();
    const firstToActFourth = state4.activePlayer;
    engine.handleAction({
      type: 'check',
      playerId: firstToActFourth,
      tableId: state4.tableId,
      timestamp: Date.now()
    });

    // Second player bets (this triggers the bug scenario)
    const state4b = engine.getState();
    const secondToActFourth = state4b.activePlayer;
    expect(secondToActFourth).not.toBe(firstToActFourth); // Should be different player
    engine.handleAction({
      type: 'bet',
      playerId: secondToActFourth,
      tableId: state4b.tableId,
      amount: 20,
      timestamp: Date.now()
    });

    // First player calls to complete the round
    const state4c = engine.getState();
    expect(state4c.activePlayer).toBe(firstToActFourth); // Back to first player
    engine.handleAction({
      type: 'call',
      playerId: firstToActFourth,
      tableId: state4c.tableId,
      timestamp: Date.now()
    });

    // CRITICAL CHECK: After transitioning to fifth street, activePlayer should be set immediately
    const afterFourth = engine.getState();
    expect(afterFourth.stage).toBe('fifth');

    // BUG: activePlayer should be set to whoever acts first on fifth street
    // It should NOT be empty or still set to the last person who acted on fourth street
    expect(afterFourth.activePlayer).toBeTruthy();
    expect(afterFourth.activePlayer).not.toBe('');

    // The activePlayer should be determined by the highest upcard rule for fifth street
    // It should be one of the two players, not an empty string or invalid value
    expect([players[0].id, players[1].id]).toContain(afterFourth.activePlayer);

    // Additional check: each player should have the correct number of cards for fifth street
    for (const p of afterFourth.players) {
      const pc = afterFourth.studState!.playerCards[p.id];
      expect(pc).toBeTruthy();
      expect(pc.downCards.length).toBe(2);
      expect(pc.upCards.length).toBe(3); // Should have 3 up cards on fifth street
    }
  });

  test('activePlayer should be consistent across rapid stage transitions', () => {
    const engine = createPokerEngine({
      tableId: 'stud-consistency-test',
      players,
      smallBlind: 5,
      bigBlind: 10,
      state: { variant: 'seven-card-stud' }
    });

    engine.startNewHand();

    // Advance through multiple streets and verify activePlayer is always valid
    const stages = ['third', 'fourth', 'fifth', 'sixth', 'seventh'];

    for (let i = 0; i < stages.length - 1; i++) {
      const currentStage = stages[i];
      let iterations = 0;
      const maxIterations = 10;

      while (engine.getState().stage === currentStage && iterations < maxIterations) {
        const state = engine.getState();

        // Verify activePlayer is always valid during the current stage
        expect(state.activePlayer).toBeTruthy();
        expect(state.activePlayer).not.toBe('');
        expect([players[0].id, players[1].id]).toContain(state.activePlayer);

        const activePlayerId = state.activePlayer;

        try {
          engine.handleAction({
            type: 'check',
            playerId: activePlayerId,
            tableId: state.tableId,
            timestamp: Date.now()
          });
        } catch (e) {
          // If check fails, break to advance to next stage
          break;
        }
        iterations++;
      }

      // After stage transition, verify activePlayer is immediately valid
      const stateAfterTransition = engine.getState();
      if (stateAfterTransition.stage !== 'showdown') {
        expect(stateAfterTransition.activePlayer).toBeTruthy();
        expect(stateAfterTransition.activePlayer).not.toBe('');
        expect([players[0].id, players[1].id]).toContain(stateAfterTransition.activePlayer);
      }
    }
  });
});
