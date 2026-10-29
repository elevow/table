import { createPokerEngine } from '../engine-factory';
import { Player } from '../../../types/poker';

const P = (id: string, pos: number, stack = 20): Player => ({
  id, name: id, position: pos, stack, currentBet: 0,
  hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000,
});

const act = (engine: any, type: string, amount?: number) => {
  const st = engine.getState();
  engine.handleAction({ type, amount, playerId: st.activePlayer, tableId: st.tableId, timestamp: Date.now() });
};

// Bring it in when that is the choice, otherwise check or call, until the hand reaches showdown
const playPassively = (engine: any) => {
  let guard = 100;
  while (engine.getState().stage !== 'showdown' && guard-- > 0) {
    const st = engine.getState();
    if (st.studState?.bringIn?.pending) { act(engine, 'bring-in'); continue; }
    const me = st.players.find((p: Player) => p.id === st.activePlayer)!;
    act(engine, st.currentBet > me.currentBet ? 'call' : 'check');
  }
};

describe.each(['seven-card-stud', 'seven-card-stud-hi-lo', 'five-card-stud'] as const)('Stud bring-in (%s)', (variant) => {
  const start = (tableId: string, mode?: 'fixed-limit') => {
    const engine = createPokerEngine({ tableId, players: [P('a', 0), P('b', 1), P('c', 2)], smallBlind: 1, bigBlind: 2, state: { variant, ...(mode ? { bettingMode: mode } : {}) } });
    engine.startNewHand();
    return engine;
  };

  test('the bring-in player acts first and nothing is posted until they choose', () => {
    const engine = start('bi0');
    const s = engine.getState();
    const bringIn = s.studState!.bringIn!;
    expect(bringIn.pending).toBe(true);
    expect(s.activePlayer).toBe(bringIn.player);
    expect(s.pot).toBe(0);
    expect(s.currentBet).toBe(0);
    // A forced bet: no checking or folding out of it
    expect(() => act(engine, 'check')).toThrow('Bring it in or complete the bet');
    expect(() => act(engine, 'fold')).toThrow('Bring it in or complete the bet');
  });

  test('bringing it in posts the bring-in, and the others must call it', () => {
    const engine = start('bi');
    const bringInPlayer = engine.getState().activePlayer;
    act(engine, 'bring-in');
    const s = engine.getState();
    const bringIn = s.studState!.bringIn!;
    expect(bringIn.pending).toBeUndefined();
    expect(s.currentBet).toBe(1);
    expect(s.pot).toBe(1);
    expect(s.handActions!.at(-1)).toMatchObject({ playerId: bringInPlayer, action: 'bring-in', put: 1 });
    // Action moves to the next player, who cannot check
    expect(s.activePlayer).not.toBe(bringInPlayer);
    expect(() => act(engine, 'check')).toThrow();
    // There is only one bring-in
    expect(() => act(engine, 'bring-in')).toThrow('There is no bring-in to post');
  });

  test('the bring-in player can complete to a full bet instead', () => {
    const engine = start('bi-c');
    const bringInPlayer = engine.getState().activePlayer;
    act(engine, 'bet', 2);
    const s = engine.getState();
    expect(s.studState!.bringIn!.pending).toBeUndefined();
    expect(s.currentBet).toBe(2);
    expect(s.pot).toBe(2);
    expect(s.handActions!.at(-1)).toMatchObject({ playerId: bringInPlayer, action: 'bet', put: 2 });
    expect(s.activePlayer).not.toBe(bringInPlayer);
  });

  test('in fixed limit, completing is one small bet and the next raise goes to two', () => {
    const engine = start('bi-fl', 'fixed-limit');
    act(engine, 'raise', 50);
    expect(engine.getState().currentBet).toBe(2);
    act(engine, 'raise');
    expect(engine.getState().currentBet).toBe(4);
  });

  test('running out of time brings it in', () => {
    const engine = start('bi-t');
    const s0 = engine.getState();
    const out = engine.handleTimeout(s0.turnDeadline!);
    expect(out).toMatchObject({ playerId: s0.activePlayer, action: 'bring-in' });
    const s = engine.getState();
    expect(s.pot).toBe(1);
    expect(s.handActions!.at(-1)).toMatchObject({ action: 'bring-in', auto: true });
  });

  test('a bring-in player who leaves still posts the bring-in', () => {
    const engine = start('bi-l');
    const bringInPlayer = engine.getState().activePlayer;
    engine.forceFold(bringInPlayer);
    const s = engine.getState();
    expect(s.pot).toBe(1);
    expect(s.players.find(p => p.id === bringInPlayer)!.isFolded).toBe(true);
    expect(s.activePlayer).not.toBe(bringInPlayer);
  });

  test('when everyone calls the bring-in, each player has put in the same amount', () => {
    const engine = start('bi2');
    let guard = 10;
    while (engine.getState().stage === 'third' && guard-- > 0) {
      const st = engine.getState();
      if (st.studState?.bringIn?.pending) { act(engine, 'bring-in'); continue; }
      const me = st.players.find(p => p.id === st.activePlayer)!;
      act(engine, st.currentBet > me.currentBet ? 'call' : 'check');
    }
    const s = engine.getState();
    expect(s.stage).toBe('fourth');
    expect(s.pot).toBe(3);
    s.players.forEach(p => expect(p.stack).toBe(19));
  });

  test('a checked-down hand ends with no chips refunded to the bring-in as a side pot', () => {
    const engine = start('bi3');
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
