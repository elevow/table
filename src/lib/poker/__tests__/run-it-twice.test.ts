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

  test('RIT creates correct number of boards', () => {
    const players = [
      createPlayer('p1', 0, 1000),
      createPlayer('p2', 1, 1000),
      createPlayer('p3', 2, 1000),
    ];
    const engine = new PokerEngine('t1', players, 5, 10);
    engine.startNewHand();
    const state = engine.getState();

    // Mark players all-in
    state.players[0].isAllIn = true;
    state.players[1].isAllIn = true;
    state.players[2].isAllIn = true;

    // Enable RIT with 2 runs
    engine.enableRunItTwice(2, ['board1', 'board2']);
    engine.runItTwiceNow();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.runItTwice?.results.length).toBe(2);
    expect(s.runItTwice?.boards.length).toBe(2);

    // Each board should be complete
    s.runItTwice!.boards.forEach(board => {
      expect(board.length).toBe(5);
    });

    // Each run should have winners
    s.runItTwice!.results.forEach(run => {
      expect(run.winners.length).toBeGreaterThan(0);
      const runPotTotal = run.winners.reduce((sum, w) => sum + w.potShare, 0);
      expect(runPotTotal).toBeGreaterThan(0);
    });

    expect(s.pot).toBe(0);
  });

  test('RIT with 3 runs creates 3 boards', () => {
    const players = [
      createPlayer('p1', 0, 600),
      createPlayer('p2', 1, 600),
      createPlayer('p3', 2, 600),
    ];
    const engine = new PokerEngine('t1', players, 5, 10);
    engine.startNewHand();
    const state = engine.getState();

    state.players[0].isAllIn = true;
    state.players[1].isAllIn = true;
    state.players[2].isAllIn = true;

    engine.enableRunItTwice(3, ['run1', 'run2', 'run3']);
    engine.runItTwiceNow();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.runItTwice?.boards.length).toBe(3);
    expect(s.runItTwice?.results.length).toBe(3);

    // Verify each run has results
    s.runItTwice!.results.forEach(run => {
      const runTotal = run.winners.reduce((sum, w) => sum + w.potShare, 0);
      expect(runTotal).toBeGreaterThan(0);
    });

    expect(s.pot).toBe(0);
  });

  test('RIT distributes entire pot', () => {
    const players = [
      createPlayer('p1', 0, 500),
      createPlayer('p2', 1, 500),
    ];
    const engine = new PokerEngine('t1', players, 5, 10);
    engine.startNewHand();
    const state = engine.getState();

    // Capture actual pot from state
    const potBefore = state.pot;

    state.players[0].isAllIn = true;
    state.players[1].isAllIn = true;

    engine.enableRunItTwice(2, ['distA', 'distB']);
    engine.runItTwiceNow();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');

    // Verify entire pot distributed
    const distributed = s.runItTwice?.potDistribution.reduce((sum, p) => sum + p.amount, 0) || 0;
    expect(distributed).toBe(potBefore);

    expect(s.pot).toBe(0);
  });

  test('RIT handles ties within a run', () => {
    const players = [
      createPlayer('p1', 0, 500),
      createPlayer('p2', 1, 500),
      createPlayer('p3', 2, 500),
    ];
    const engine = new PokerEngine('t1', players, 5, 10);
    engine.startNewHand();
    const state = engine.getState();

    state.players[0].isAllIn = true;
    state.players[1].isAllIn = true;
    state.players[2].isAllIn = true;

    engine.enableRunItTwice(2, ['tie1', 'tie2']);
    engine.runItTwiceNow();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.runItTwice?.results.length).toBe(2);

    // If there's a tie, multiple winners should exist in at least one run
    // Each winner in a tied run should get a fraction of that run's pot
    s.runItTwice!.results.forEach(run => {
      const totalAwarded = run.winners.reduce((sum, w) => sum + w.potShare, 0);
      expect(totalAwarded).toBeGreaterThan(0);
      
      // If multiple winners, each should get less than the full run pot
      if (run.winners.length > 1) {
        run.winners.forEach(w => {
          expect(w.potShare).toBeLessThan(totalAwarded);
        });
      }
    });

    expect(s.pot).toBe(0);
  });
});
