import { PokerEngine } from '../poker-engine';

const mk = (id: string, position: number): any => ({
  id, name: id, position, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

const act = (engine: PokerEngine, type: string, amount?: number) => {
  const s = engine.getState();
  engine.handleAction({ type, amount, playerId: s.activePlayer, tableId: s.tableId, timestamp: Date.now() } as any);
};

describe('turnSeq', () => {
  it('increases with every accepted action and every new hand', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    const start = engine.getState().turnSeq!;
    expect(start).toBeGreaterThan(0);

    act(engine, 'call');
    expect(engine.getState().turnSeq).toBe(start + 1);
    act(engine, 'check');
    expect(engine.getState().turnSeq).toBe(start + 2);

    engine.startNewHand();
    expect(engine.getState().turnSeq).toBe(start + 3);
  });

  it('does not change when an action is rejected', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    const before = engine.getState().turnSeq;
    const s = engine.getState();
    const waiting = s.players.find(p => p.id !== s.activePlayer)!;
    expect(() => engine.handleAction({ type: 'check', playerId: waiting.id, tableId: 't', timestamp: 0 } as any)).toThrow();
    expect(engine.getState().turnSeq).toBe(before);
  });

  it('differs between the decision that closes a street and the same player acting on the next', () => {
    // Heads-up: the big blind checks to close preflop, then acts first on the flop
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    act(engine, 'call');
    const closing = engine.getState();
    const bigBlind = closing.activePlayer;
    act(engine, 'check');
    const flop = engine.getState();
    expect(flop.stage).toBe('flop');
    expect(flop.activePlayer).toBe(bigBlind);
    // A duplicate of the preflop check carries the old value, so the action route refuses it
    expect(flop.turnSeq).not.toBe(closing.turnSeq);
  });

  it('survives saving and restoring the engine', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    act(engine, 'call');
    const restored = PokerEngine.fromSerialized(JSON.parse(JSON.stringify(engine.serialize())));
    expect(restored.getState().turnSeq).toBe(engine.getState().turnSeq);
  });
});
