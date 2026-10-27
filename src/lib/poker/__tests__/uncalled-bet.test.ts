import { PokerEngine } from '../poker-engine';
import { describeAction } from '../../shared/hand-replay';

const mk = (id: string, position: number, stack: number): any => ({
  id, name: id, position, stack, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

const act = (engine: PokerEngine, type: string, amount?: number) => {
  const s = engine.getState();
  engine.handleAction({ type, amount, playerId: s.activePlayer, tableId: s.tableId, timestamp: 0 } as any);
};

const total = (engine: PokerEngine) => {
  const s = engine.getState();
  return s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
};

describe('uncalled bets', () => {
  it('returns the part of an all-in nobody can call before the next cards are dealt', () => {
    // Heads-up: the bigger stack shoves 1000, the short stack can only call 300
    const engine = new PokerEngine('t', [mk('short', 1, 300), mk('big', 2, 1000)], 5, 10);
    engine.startNewHand();
    const start = total(engine);
    const s0 = engine.getState();
    const shover = s0.activePlayer;
    const caller = s0.players.find(p => p.id !== shover)!.id;
    // Heads-up the button acts first preflop; the first hand puts the button on the second seat
    expect(shover).toBe('big');

    act(engine, 'raise', 1000);
    act(engine, 'call');

    const s = engine.getState();
    // Betting closed and the flop came; the pot is only what both players put in
    expect(s.communityCards.length).toBeGreaterThanOrEqual(3);
    expect(s.pot).toBe(600);
    expect(s.players.find(p => p.id === 'big')!.stack).toBe(700);
    expect(s.players.find(p => p.id === caller)!.stack).toBe(0);
    expect(total(engine)).toBe(start);

    const uncalled = s.handActions!.find(a => a.action === 'uncalled')!;
    expect(uncalled).toMatchObject({ playerId: 'big', put: -700 });
    expect(describeAction(uncalled, 'Big', n => `$${n}`)).toBe('Uncalled $700 returned to Big');
  });

  it('settles the hand correctly after returning the excess', () => {
    const engine = new PokerEngine('t', [mk('short', 1, 300), mk('big', 2, 1000)], 5, 10);
    engine.startNewHand();
    expect(engine.getState().activePlayer).toBe('big');
    act(engine, 'raise', 1000);
    act(engine, 'call');
    engine.finalizeToShowdown();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.handResult!.pot).toBe(600);
    expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(1300);
    // The bigger stack never risks more than 300
    expect(s.players.find(p => p.id === 'big')!.stack).toBeGreaterThanOrEqual(700);
  });

  it('returns nothing when the bets are matched', () => {
    const engine = new PokerEngine('t', [mk('a', 1, 1000), mk('b', 2, 1000)], 5, 10);
    engine.startNewHand();
    act(engine, 'call');
    act(engine, 'check');
    expect(engine.getState().handActions!.some(a => a.action === 'uncalled')).toBe(false);
    expect(engine.getState().pot).toBe(20);
  });
});
