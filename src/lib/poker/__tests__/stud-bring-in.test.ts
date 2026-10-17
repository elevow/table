import { createPokerEngine } from '../engine-factory';
import { Player } from '../../../types/poker';

const P = (id: string, pos: number, stack = 20): Player => ({
  id, name: id, position: pos, stack, currentBet: 0,
  hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000,
});

// Check or call every turn until the hand reaches showdown
const playPassively = (engine: any) => {
  let guard = 100;
  while (engine.getState().stage !== 'showdown' && guard-- > 0) {
    const st = engine.getState();
    const me = st.players.find((p: Player) => p.id === st.activePlayer)!;
    const type = st.currentBet > me.currentBet ? 'call' : 'check';
    engine.handleAction({ type, playerId: st.activePlayer, tableId: st.tableId, timestamp: Date.now() });
  }
};

describe.each(['seven-card-stud', 'seven-card-stud-hi-lo', 'five-card-stud'] as const)('Stud bring-in (%s)', (variant) => {
  test('the bring-in is a bet the other players must call', () => {
    const engine = createPokerEngine({ tableId: 'bi', players: [P('a', 0), P('b', 1), P('c', 2)], smallBlind: 1, bigBlind: 2, state: { variant } });
    engine.startNewHand();
    const s = engine.getState();
    const bringIn = s.studState!.bringIn!;
    expect(s.currentBet).toBe(bringIn.amount);
    // Action starts with the player after the bring-in, who cannot check
    expect(s.activePlayer).not.toBe(bringIn.player);
    expect(() => engine.handleAction({ type: 'check', playerId: s.activePlayer, tableId: s.tableId, timestamp: Date.now() })).toThrow();
  });

  test('when everyone calls the bring-in, each player has put in the same amount', () => {
    const engine = createPokerEngine({ tableId: 'bi2', players: [P('a', 0), P('b', 1), P('c', 2)], smallBlind: 1, bigBlind: 2, state: { variant } });
    engine.startNewHand();
    let guard = 10;
    while (engine.getState().stage === 'third' && guard-- > 0) {
      const st = engine.getState();
      const me = st.players.find(p => p.id === st.activePlayer)!;
      const type = st.currentBet > me.currentBet ? 'call' : 'check';
      engine.handleAction({ type, playerId: st.activePlayer, tableId: st.tableId, timestamp: Date.now() });
    }
    const s = engine.getState();
    expect(s.stage).toBe('fourth');
    expect(s.pot).toBe(3);
    s.players.forEach(p => expect(p.stack).toBe(19));
  });

  test('a checked-down hand ends with no chips refunded to the bring-in as a side pot', () => {
    const engine = createPokerEngine({ tableId: 'bi3', players: [P('a', 0), P('b', 1), P('c', 2)], smallBlind: 1, bigBlind: 2, state: { variant } });
    engine.startNewHand();
    playPassively(engine);
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(60);
    // Every player paid 1, so a player who won nothing finishes on 19
    s.players.filter(p => p.stack <= 20).forEach(p => expect([19, 20]).toContain(p.stack));
    if (variant === 'seven-card-stud-hi-lo' && s.lastHiLoResult && !s.lastHiLoResult.low) {
      const amounts = s.lastHiLoResult.high.map(h => h.amount);
      expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
    }
  });
});
