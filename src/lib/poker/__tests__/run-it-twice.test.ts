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

describe('US-029 Run It Twice', () => {
  test('executes two runs, splits pot, preserves chip total', () => {
    const players = [
      createPlayer('a', 0, 500),
      createPlayer('b', 1, 500),
      createPlayer('c', 2, 500),
    ];
    const engine = new PokerEngine('t1', players, 5, 10);
    engine.startNewHand();
  const state0 = engine.getState();

    // Force an all-in agreement scenario: mark two players all-in and push some pot
    state0.players[0].isAllIn = true;
    state0.players[1].isAllIn = true;
  const potBefore = state0.pot; // from blinds
  const totalBefore = state0.players.reduce((sum, p) => sum + p.stack, 0) + potBefore;

    // Enable Run It Twice with 2 runs and deterministic seeds
    engine.enableRunItTwice(2, ['seed1', 'seed2']);
    // Execute RIT now
    engine.runItTwiceNow();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.runItTwice?.enabled).toBe(true);
    expect(s.runItTwice?.boards.length).toBe(2);
    expect(s.runItTwice?.results.length).toBe(2);

  const distributed = s.runItTwice?.potDistribution.reduce((sum, p) => sum + p.amount, 0) || 0;
  // Entire pre-run pot must be distributed and pot cleared; compare to sum of per-run pots
  const totalPerRun = (s.runItTwice?.results || []).reduce((sum, r) => sum + r.winners.reduce((acc, w) => acc + w.potShare, 0), 0);
  expect(distributed).toBe(totalPerRun);
    expect(s.pot).toBe(0);

    // Chip conservation: total stacks should equal initial total (players start 1500, - blinds + pot became 300 then distributed back)
  const totalChips = s.players.reduce((sum, p) => sum + p.stack, 0);
  expect(totalChips).toBe(totalBefore); // Conservation of chips
  });
});
