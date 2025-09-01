import { PokerEngine } from '../poker-engine';
import { Player } from '../../../types/poker';

const P = (id: string, pos: number, stack = 500): Player => ({
  id,
  name: id,
  position: pos,
  stack,
  currentBet: 0,
  hasActed: false,
  isFolded: false,
  isAllIn: false,
  timeBank: 30000,
});

describe('US-029 RIT unanimity toggle', () => {
  test('requires unanimous consent when enabled', () => {
    const players = [P('a',0), P('b',1), P('c',2)];
    const engine = new PokerEngine('t1', players, 5, 10, { requireRunItTwiceUnanimous: true });
    engine.startNewHand();
    const s0 = engine.getState();
    // force all-in condition
    s0.players[0].isAllIn = true;
    s0.players[1].isAllIn = true;
    // only two players consent
    engine.recordRunItTwiceConsent('a', true);
    engine.recordRunItTwiceConsent('b', true);
    expect(() => engine.enableRunItTwice(2, ['x','y'])).toThrow(/unanimous/i);
    // when remaining player consents, it should pass
    engine.recordRunItTwiceConsent('c', true);
    expect(() => engine.enableRunItTwice(2, ['x','y'])).not.toThrow();
  });

  test('does not require unanimity when toggle is off', () => {
    const players = [P('a',0), P('b',1), P('c',2)];
    const engine = new PokerEngine('t1', players, 5, 10, { requireRunItTwiceUnanimous: false });
    engine.startNewHand();
    const s0 = engine.getState();
    s0.players[0].isAllIn = true;
    s0.players[1].isAllIn = true;
    engine.recordRunItTwiceConsent('a', true);
    // Should not throw even if others haven't consented
    expect(() => engine.enableRunItTwice(2, ['s1','s2'])).not.toThrow();
  });
});
