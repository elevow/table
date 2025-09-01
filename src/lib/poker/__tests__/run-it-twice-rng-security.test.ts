import { PokerEngine } from '../poker-engine';
import { Player } from '../../../types/poker';

const createPlayer = (id: string, position: number, stack = 1000): Player => ({
  id,
  name: `P${id}`,
  position,
  stack,
  currentBet: 0,
  hasActed: false,
  isFolded: false,
  isAllIn: false,
  timeBank: 30000,
});

describe('US-030 Run It Twice RNG Security', () => {
  test('generates unique seeds with audit metadata and verifies chain', () => {
    const players = [
      createPlayer('a', 0, 500),
      createPlayer('b', 1, 500),
      createPlayer('c', 2, 500),
    ];
    const engine = new PokerEngine('t1', players, 5, 10);
    engine.startNewHand();
    const s0 = engine.getState();
    s0.players[0].isAllIn = true;
    s0.players[1].isAllIn = true;

    // Enable without passing seeds; provide some player-driven entropy (room id, hand nonce, etc.)
    engine.enableRunItTwice(2, undefined, 'room-1:hand-1');
    const s = engine.getState();
    expect(s.runItTwice?.seeds.length).toBe(2);
    // Seeds should look like hex sha256 strings
    s.runItTwice!.seeds.forEach(seed => expect(/^[a-f0-9]{64}$/i.test(seed)).toBe(true));
    // RNG metadata present
    expect(s.runItTwice?.rngSecurity?.verification.publicSeed).toBeTruthy();
    expect(s.runItTwice?.rngSecurity?.verification.hashChain.length).toBe(2);
    // Engine helper verifies seeds vs chain
    expect(engine.verifyRunItTwiceSeeds()).toBe(true);
  });

  test('still works when custom seeds provided (verification returns true as no RNG metadata)', () => {
    const players = [
      createPlayer('a', 0, 500),
      createPlayer('b', 1, 500),
  // Include a third player in big blind position so blinds can be posted
  createPlayer('c', 2, 500),
    ];
    const engine = new PokerEngine('t2', players, 5, 10);
    engine.startNewHand();
    const s0 = engine.getState();
    s0.players[0].isAllIn = true;
    s0.players[1].isAllIn = true;

    engine.enableRunItTwice(2, ['seedX', 'seedY']);
    const s = engine.getState();
    expect(s.runItTwice?.rngSecurity).toBeUndefined();
    expect(engine.verifyRunItTwiceSeeds()).toBe(true);
  });
});
