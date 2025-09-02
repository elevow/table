import { createPokerEngine } from '../engine-factory';

describe('US-053 Seven-card Stud Core Mechanics', () => {
  const players = [
    { id: 'p1', name: 'A', position: 0, stack: 100, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 0 },
    { id: 'p2', name: 'B', position: 1, stack: 100, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 0 },
    { id: 'p3', name: 'C', position: 2, stack: 100, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 0 },
  ];

  test('deals 2 down, 1 up; subsequent up cards; final down; tracks exposed cards and no community', () => {
    const engine = createPokerEngine({ tableId: 'stud1', players, smallBlind: 1, bigBlind: 2, state: { variant: 'seven-card-stud' } });
    // Start hand: two down + one up dealt automatically
    engine.startNewHand();
    const s1 = engine.getState();
    expect(s1.stage).toBe('third');
    expect(s1.communityCards.length).toBe(0);
    // Bring-in applied to one player
    expect(s1.studState?.bringIn?.player).toBeTruthy();
    expect(s1.studState?.bringIn?.amount).toBeGreaterThanOrEqual(1);

    for (const p of s1.players) {
      const pc = s1.studState!.playerCards[p.id];
      expect(pc).toBeTruthy();
      expect(pc.downCards.length).toBe(2);
      expect(pc.upCards.length).toBe(1);
    }

    // Simulate closing betting to move stages quickly
    // We shortcut by forcing all players to have acted and currentBet to zero
    // then call handleAction with a fold from active to drive progression in this test-only flow
    const advance = (times: number) => {
      for (let i = 0; i < times; i++) {
        const prev = engine.getState().stage;
        let guard = 10;
        while (engine.getState().stage === prev && guard-- > 0) {
          const st = engine.getState();
          const active = st.activePlayer;
          engine.handleAction({ type: 'check', playerId: active, tableId: st.tableId, timestamp: Date.now() });
        }
      }
    };

    // Move to fourth (deal 1 up)
    advance(1);
    const s2 = engine.getState();
    expect(s2.stage === 'fourth' || s2.stage === 'fifth' || s2.stage === 'sixth' || s2.stage === 'seventh' || s2.stage === 'showdown').toBeTruthy();
    for (const p of s2.players) {
      const pc = s2.studState!.playerCards[p.id];
      expect(pc.upCards.length).toBeGreaterThanOrEqual(2);
    }

    // Move to fifth (another up)
    advance(1);
    const s3 = engine.getState();
    for (const p of s3.players) {
      const pc = s3.studState!.playerCards[p.id];
      expect(pc.upCards.length).toBeGreaterThanOrEqual(3);
    }

    // Move to sixth (another up)
    advance(1);
    const s4 = engine.getState();
    for (const p of s4.players) {
      const pc = s4.studState!.playerCards[p.id];
      expect(pc.upCards.length).toBeGreaterThanOrEqual(4);
    }

    // Move to seventh (final down)
    advance(1);
    const s5 = engine.getState();
    for (const p of s5.players) {
      const pc = s5.studState!.playerCards[p.id];
      expect(pc.downCards.length).toBeGreaterThanOrEqual(3);
    }
  });
});
