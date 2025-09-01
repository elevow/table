import { PokerEngine } from '../poker-engine';
import { Player } from '../../../types/poker';
import { RunItTwiceOutcomeInput } from '../../../types/game-history';

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

describe('US-029 Run It Twice - persistence hook', () => {
  test('invokes onOutcome once per run with expected payload', async () => {
    const players = [
      createPlayer('a', 0, 500),
      createPlayer('b', 1, 500),
      createPlayer('c', 2, 500),
    ];
    const engine = new PokerEngine('t1', players, 5, 10);
    engine.startNewHand();
    const state0 = engine.getState();
    // Force all-in scenario
    state0.players[0].isAllIn = true;
    state0.players[1].isAllIn = true;
    const potBefore = state0.pot; // blinds-only pot

    const calls: RunItTwiceOutcomeInput[] = [];
    engine.configureRunItTwicePersistence('hand-123', async (input) => {
      calls.push(input);
    });

    engine.enableRunItTwice(2, ['seed1', 'seed2']);
    engine.runItTwiceNow();

    // Callback should have been fired twice
    expect(calls.length).toBe(2);
    // Validate payloads
    const boardNumbers = calls.map(c => c.boardNumber).sort((a,b)=>a-b);
    expect(boardNumbers).toEqual([1,2]);
    calls.forEach(c => {
      expect(c.handId).toBe('hand-123');
      expect(Array.isArray(c.communityCards)).toBe(true);
      expect(c.communityCards.length).toBe(5);
      // cards like 'As', 'Kd', '10h'
      c.communityCards.forEach(card => expect(/^(10|[2-9]|[JQKA])[cdhs]$/.test(card)).toBe(true));
      expect(Array.isArray(c.winners)).toBe(true);
      expect(typeof c.potAmount).toBe('number');
      expect(c.potAmount).toBeGreaterThan(0);
    });
    // Pot split across runs should equal original pot
    const totalPersisted = calls.reduce((sum, c) => sum + c.potAmount, 0);
    expect(totalPersisted).toBe(potBefore);

    // Engine state finalized
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.pot).toBe(0);
  });

  test('persistence errors are caught and do not break execution', () => {
    const players = [
      createPlayer('a', 0, 500),
      createPlayer('b', 1, 500),
      createPlayer('c', 2, 500),
    ];
    const engine = new PokerEngine('t1', players, 5, 10);
    engine.startNewHand();
    const state0 = engine.getState();
    state0.players[0].isAllIn = true;
    state0.players[1].isAllIn = true;

    let calls = 0;
    engine.configureRunItTwicePersistence('hid-err', async () => {
      calls++;
      throw new Error('network down');
    });

    engine.enableRunItTwice(2, ['seed1', 'seed2']);
    // Should not throw despite callback throwing
    expect(() => engine.runItTwiceNow()).not.toThrow();
    // Callback attempted twice
    expect(calls).toBe(2);
    // Engine still finishes correctly
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.pot).toBe(0);
  });
});
