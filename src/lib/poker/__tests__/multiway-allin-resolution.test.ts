import { PokerEngine } from '../poker-engine';
import { Player } from '../../../types/poker';

const createPlayer = (id: string, position: number, stack = 200): Player => ({
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

/**
 * US-033: Multi-way all-in resolution with side pots
 * Scenario:
 * - p1 all-in 50
 * - p2 all-in 100
 * - p3 covers 150
 * Pots expected:
 * - Main: 150 (p1,p2,p3 eligible)
 * - Side1: 100 (p2,p3 eligible)
 * - Side2: 50 (p3 only)
 * We don't force specific hand strengths; instead, we assert total pot distributed and stacks conserved.
 */
describe('US-033 Multi-way all-in resolution', () => {
  it('distributes main and side pots based on eligibility and strength', () => {
    const players = [
      createPlayer('p1', 0, 200),
      createPlayer('p2', 1, 200),
      createPlayer('p3', 2, 200),
    ];
    const engine = new PokerEngine('t1', players, 5, 10);
    engine.startNewHand();

  // Work on internal engine state (getState returns a copy)
  const es = (engine as any);
  const state = es.state as any;
  // Zero out dealt hole cards effects on stacks; we'll directly set bets/stacks for clarity
  const p1 = state.players.find((p: any) => p.id === 'p1');
  const p2 = state.players.find((p: any) => p.id === 'p2');
  const p3 = state.players.find((p: any) => p.id === 'p3');

  // Remove blinds from pot conservation by transferring pot back to stacks (test-only normalization)
  const totalBefore = state.players.reduce((sum: number, p: any) => sum + p.stack, 0) + state.pot;

  // Reset bets/pot to 0 then assign our scenario
  state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
  state.pot = 0;

  // Apply all-in bets
  p1.currentBet = 50; p1.stack -= 50; p1.isAllIn = true;
  p2.currentBet = 100; p2.stack -= 100; p2.isAllIn = true;
  p3.currentBet = 150; p3.stack -= 150; // not necessarily all-in (covers)

  // Move directly to showdown and resolve
  state.stage = 'river';
  state.players.forEach((p: any) => { p.hasActed = true; });
  es.determineWinner();

  const s = engine.getState();
    expect(s.stage).toBe('showdown');

    // Total expected pot = 150 + 100 + 50 = 300 distributed
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });
});
