import { PokerEngine } from '../poker-engine';

const mk = (id: string, position: number, stack = 100): any => ({
  id, name: id, position, stack, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

const seat = (id: string, seatNumber: number, chips = 100) => ({ id, name: id.toUpperCase(), seatNumber, chips });

// Fold the hand away so the table is between hands
const foldOut = (engine: PokerEngine) => {
  const s = engine.getState();
  engine.handleAction({ type: 'fold', playerId: s.activePlayer, tableId: s.tableId, timestamp: Date.now() } as any);
  expect(engine.getState().stage).toBe('showdown');
};

describe('bringing seated players into the game between hands', () => {
  it('a player who stands up and sits back down is dealt into the next hand', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 3)], 1, 2);
    engine.configureClock({ timeBanks: 2 });
    engine.startNewHand();
    // b stands up mid-hand: folded out, and dropped from the next hand
    engine.removePlayer('b');
    engine.ensureWinByFoldIfSingle();
    expect(engine.getState().stage).toBe('showdown');
    expect(engine.canStartNewHand()).toBe(false);

    // ...then sits back down (in another seat) with a fresh buy-in
    expect(engine.syncSeatedPlayers([seat('a', 1, 999), seat('b', 5, 150)])).toBe(true);
    expect(engine.isRemoved('b')).toBe(false);
    expect(engine.canStartNewHand()).toBe(true);
    engine.startNewHand();
    const s = engine.getState();
    expect(s.stage).toBe('preflop');
    expect(s.players.map(p => p.id)).toEqual(['a', 'b']);
    const b = s.players.find(p => p.id === 'b')!;
    expect(b.position).toBe(5);
    expect(b.timeBanks).toBe(2);
    // b's stack is the new buy-in (less any blind); a keeps the game stack, not the seat's buy-in
    expect(b.stack + b.currentBet).toBe(150);
    const a = s.players.find(p => p.id === 'a')!;
    expect(a.stack + a.currentBet).toBeLessThan(999);
  });

  it('a player who sat down after the game started joins at the next hand, in seat order', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('c', 6)], 1, 2);
    engine.startNewHand();
    foldOut(engine);
    expect(engine.syncSeatedPlayers([seat('a', 1), seat('b', 3, 80), seat('c', 6)])).toBe(true);
    engine.startNewHand();
    const s = engine.getState();
    expect(s.players.map(p => p.id)).toEqual(['a', 'b', 'c']);
    expect(s.players.every(p => (p.holeCards || []).length === 2)).toBe(true);
  });

  it('changes nothing during a hand, or when everyone seated is already playing', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    expect(engine.syncSeatedPlayers([seat('a', 1), seat('b', 2), seat('c', 3)])).toBe(false);
    foldOut(engine);
    expect(engine.syncSeatedPlayers([seat('a', 1), seat('b', 2)])).toBe(false);
    // A busted seat is left to the rebuy flow
    expect(engine.syncSeatedPlayers([seat('c', 3, 0)])).toBe(false);
  });

  it('players who stay keep their seat numbers when someone leaves', () => {
    const engine = new PokerEngine('t', [mk('a', 2), mk('b', 4), mk('c', 7)], 1, 2);
    engine.startNewHand();
    engine.removePlayer('b');
    // Fold the rest of the hand away
    let guard = 10;
    while (engine.getState().stage !== 'showdown' && guard-- > 0) engine.forceFold(engine.getState().activePlayer);
    engine.startNewHand();
    expect(engine.getState().players.map(p => [p.id, p.position])).toEqual([['a', 2], ['c', 7]]);
  });
});
