import { createPokerEngine } from '../engine-factory';
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

describe('engine-factory: createPokerEngine wiring', () => {
  test('applies defaults when state not provided (bettingMode omitted, unanimity off)', () => {
    const players = [P('a', 0), P('b', 1), P('c', 2)];
    const engine = createPokerEngine({ tableId: 't1', players, smallBlind: 5, bigBlind: 10 });
    engine.startNewHand();
    const state = engine.getState();
    expect(state.bettingMode).toBeUndefined();
    // Ensure gameplay works under defaults: blinds posted and active player set
    expect(state.pot).toBeGreaterThan(0);
    expect(state.activePlayer).toBeTruthy();
  });

  test('wires bettingMode and unanimity from state', () => {
    const players = [P('a', 0), P('b', 1), P('c', 2)];
    const engine = createPokerEngine({
      tableId: 't2',
      players,
      smallBlind: 5,
      bigBlind: 10,
      state: { bettingMode: 'pot-limit', requireRunItTwiceUnanimous: true },
    });

    engine.startNewHand();
    const s0 = engine.getState();
    expect(s0.bettingMode).toBe('pot-limit');

    // Force all-in condition, but without unanimous consent it should throw
    s0.players[0].isAllIn = true;
    s0.players[1].isAllIn = true;
    expect(() => engine.enableRunItTwice(2, ['x', 'y'])).toThrow(/unanimous/i);

    // After remaining player consents it should succeed
    engine.recordRunItTwiceConsent('a', true);
    engine.recordRunItTwiceConsent('b', true);
    engine.recordRunItTwiceConsent('c', true);
    expect(() => engine.enableRunItTwice(2, ['x', 'y'])).not.toThrow();
  });

  test('configures run-it-twice persistence hook from factory options', async () => {
    const players = [P('a', 0), P('b', 1), P('c', 2)];
    const onOutcome = jest.fn().mockResolvedValue(undefined);
    const engine = createPokerEngine({
      tableId: 't3',
      players,
      smallBlind: 5,
      bigBlind: 10,
      state: { bettingMode: 'no-limit', requireRunItTwiceUnanimous: false },
      runItTwicePersistence: { handId: 'h-123', onOutcome },
    });

    engine.startNewHand();
    const s0 = engine.getState();
    // Make at least two players all-in to satisfy RIT precondition
    s0.players[0].isAllIn = true;
    s0.players[1].isAllIn = true;

    // Enable RIT with 2 runs and execute immediately
    engine.enableRunItTwice(2, ['seedA', 'seedB']);
    engine.runItTwiceNow();

    // onOutcome is called fire-and-forget; wait a microtask tick
    await new Promise(res => setTimeout(res, 0));

    expect(onOutcome).toHaveBeenCalledTimes(2);
    const calls = onOutcome.mock.calls.map(c => c[0]);
    // Validate payload basics
    expect(calls.every((c: any) => c.handId === 'h-123')).toBe(true);
    expect(new Set(calls.map((c: any) => c.boardNumber))).toEqual(new Set([1, 2]));
    // Pot distribution per run should be >0 when blinds are posted
    expect(calls.every((c: any) => typeof c.potAmount === 'number' && c.potAmount > 0)).toBe(true);
  });
});
