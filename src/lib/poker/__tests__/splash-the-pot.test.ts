import { PokerEngine } from '../poker-engine';

const mk = (id: string, position: number): any => ({
  id, name: id, position, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

describe('splashing the pot', () => {
  it('lets each player splash once per session, recording the latest for the table to see', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    expect(engine.hasSplashed('a')).toBe(false);

    engine.recordSplash('a', 40, 1_000);
    expect(engine.hasSplashed('a')).toBe(true);
    expect(engine.getState().lastSplash).toEqual({ playerId: 'a', amount: 40, at: 1_000 });
    expect(() => engine.recordSplash('a', 80, 2_000)).toThrow('already splashed');

    engine.recordSplash('b', 25, 3_000);
    expect(engine.getState().splashUsedBy).toEqual(['a', 'b']);
    expect(engine.getState().lastSplash).toEqual({ playerId: 'b', amount: 25, at: 3_000 });
  });

  it('keeps the once-per-session limit across hands', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    engine.recordSplash('a', 40);
    engine.startNewHand();
    expect(engine.hasSplashed('a')).toBe(true);
  });
});
