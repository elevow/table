import { createPokerEngine } from '../engine-factory';
import { Card, Player, HandRank } from '../../../types/poker';
import { DeckManager } from '../deck-manager';
import { HandEvaluator } from '../hand-evaluator';

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

describe('US-051 Omaha Core Rules', () => {
  test('deals 4 hole cards when variant is omaha and defaults to pot-limit', () => {
    const players = [P('a', 0), P('b', 1), P('c', 2)];
    const engine = createPokerEngine({
      tableId: 'o1', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha' }
    });

    engine.startNewHand();
    const s = engine.getState();
    // Omaha should default to pot-limit
    expect(s.bettingMode).toBe('pot-limit');
    // Every player has 4 hole cards
    expect(s.players.every(p => (p.holeCards || []).length === 4)).toBe(true);
  });

  test('Omaha flush tie-breakers: same-suit flushes decided by higher kicker ranks (must use 2-from-hole)', () => {
    // Need at least 3 seats for blinds (positions 0,1,2)
    const players = [P('p1', 0, 400), P('p2', 1, 400), P('p3', 2, 400)];
    const engine = createPokerEngine({ tableId: 'o4', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    // Board: exactly three hearts to require 2 hearts from hole for a flush
    state.communityCards = [
      { rank: '9', suit: 'hearts' },
      { rank: '6', suit: 'hearts' },
      { rank: '2', suit: 'hearts' },
      { rank: 'K', suit: 'spades' },
      { rank: '3', suit: 'clubs' },
    ];

    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };

    // p1 has Ah Kh -> flush A,K,9,6,2 (top flush)
    assign('p1', [
      { rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'hearts' },
      { rank: '5', suit: 'spades' }, { rank: '8', suit: 'diamonds' },
    ]);
    // p2 has Qh Jh -> flush Q,J,9,6,2 (lower flush)
    assign('p2', [
      { rank: 'Q', suit: 'hearts' }, { rank: 'J', suit: 'hearts' },
      { rank: '4', suit: 'clubs' }, { rank: '7', suit: 'spades' },
    ]);

  // Normalize pot and set equal all-ins 100 each for p1 and p2 only; p3 folds out
  const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot;
  state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
  state.pot = 0;
  const a = state.players.find((p: any) => p.id === 'p1');
  const b = state.players.find((p: any) => p.id === 'p2');
  const c = state.players.find((p: any) => p.id === 'p3');
  a.currentBet = 100; a.stack -= 100; a.isAllIn = true;
  b.currentBet = 100; b.stack -= 100; b.isAllIn = true;
  c.isFolded = true; c.hasActed = true; c.currentBet = 0;
    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });

    es.determineWinner();
    const s = engine.getState();
    const p1 = s.players.find(p => p.id === 'p1')!;
    const p2 = s.players.find(p => p.id === 'p2')!;
    expect(p1.stack).toBeGreaterThan(p2.stack); // p1 should win the entire pot
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });

  test('Omaha full-house tie-break: same trips (777), higher pair wins (KK > 22)', () => {
  const players = [P('p1', 0, 500), P('p2', 1, 500), P('p3', 2, 500)];
    const engine = createPokerEngine({ tableId: 'o5', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    // Board: 7d 7c 2h Kd Qs
    state.communityCards = [
      { rank: '7', suit: 'diamonds' },
      { rank: '7', suit: 'clubs' },
      { rank: '2', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: 'Q', suit: 'spades' },
    ];

    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };

    // p1: 7h and 2s to make 77722 using exactly two holes
    assign('p1', [
      { rank: '7', suit: 'hearts' }, { rank: '2', suit: 'spades' },
      { rank: '4', suit: 'clubs' }, { rank: '9', suit: 'hearts' },
    ]);
    // p2: 7s and Kc to make 777KK using exactly two holes
    assign('p2', [
      { rank: '7', suit: 'spades' }, { rank: 'K', suit: 'clubs' },
      { rank: '5', suit: 'diamonds' }, { rank: '3', suit: 'clubs' },
    ]);

  // Equal all-ins 120 each for p1 and p2; p3 folds out
  const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot;
  state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
  state.pot = 0;
  const a2 = state.players.find((p: any) => p.id === 'p1');
  const b2 = state.players.find((p: any) => p.id === 'p2');
  const c2 = state.players.find((p: any) => p.id === 'p3');
  a2.currentBet = 120; a2.stack -= 120; a2.isAllIn = true;
  b2.currentBet = 120; b2.stack -= 120; b2.isAllIn = true;
  c2.isFolded = true; c2.hasActed = true; c2.currentBet = 0;
    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });

    es.determineWinner();
    const s = engine.getState();
    const p1 = s.players.find(p => p.id === 'p1')!;
    const p2 = s.players.find(p => p.id === 'p2')!;
    expect(p2.stack).toBeGreaterThan(p1.stack); // p2 should win (777KK beats 77722)
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });

  test('RIT Omaha: results use Omaha evaluator and pot splits sum to pot', () => {
    const players = [P('p1', 0, 600), P('p2', 1, 600), P('p3', 2, 600)];
    const engine = createPokerEngine({ tableId: 'o6', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    // Set an arbitrary flop so missing > 0 for RIT
    state.communityCards = [
      { rank: 'A', suit: 'clubs' },
      { rank: 'K', suit: 'hearts' },
      { rank: '3', suit: 'spades' },
    ];
    // Give each 4 distinct hole cards
    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };
    assign('p1', [
      { rank: 'A', suit: 'hearts' }, { rank: 'Q', suit: 'diamonds' }, { rank: '7', suit: 'clubs' }, { rank: '4', suit: 'hearts' },
    ]);
    assign('p2', [
      { rank: 'K', suit: 'clubs' }, { rank: 'Q', suit: 'spades' }, { rank: '8', suit: 'diamonds' }, { rank: '2', suit: 'hearts' },
    ]);

  // Equal all-ins 150 each to have a clean total; p3 stays out of the pot
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 0;
  const a = state.players.find((p: any) => p.id === 'p1');
  const b = state.players.find((p: any) => p.id === 'p2');
  const c = state.players.find((p: any) => p.id === 'p3');
  a.currentBet = 150; a.stack -= 150; a.isAllIn = true;
  b.currentBet = 150; b.stack -= 150; b.isAllIn = true;
  // p3: no bet
  c.currentBet = 0; c.isAllIn = false;
  // Move the bets into the pot to match engine's RIT pot-based split logic
  state.pot = a.currentBet + b.currentBet;
    state.stage = 'turn'; // allow missing 2 cards per run
    state.players.forEach((p: any) => { p.hasActed = true; });
  const totalBefore = state.players.reduce((sum: number, p: any) => sum + p.stack, 0) + state.pot;

    // Enable RIT with fixed seeds for determinism (content not asserted, only consistency)
    engine.enableRunItTwice(2, ['seedA', 'seedB']);
    engine.runItTwiceNow();

    const s = engine.getState();
    expect(s.runItTwice?.enabled).toBe(true);
    expect(s.runItTwice?.results.length).toBe(2);

    // Validate that recorded winningHand matches recomputed Omaha ranking for each run
    const playersById = new Map(s.players.map(p => [p.id, p]));
    s.runItTwice!.results.forEach(run => {
      const board = run.boardId ? s.runItTwice!.boards[parseInt(run.boardId.split('-')[1], 10) - 1] : s.runItTwice!.boards[0];
      run.winners.forEach(w => {
        const player = playersById.get(w.playerId)!;
        const recomputed = HandEvaluator.getOmahaHandRanking(player.holeCards || [], board);
        expect(recomputed.rank).toBe(w.winningHand.rank);
        expect(typeof w.winningHand.name).toBe('string');
      });
    });

    // Pot distribution sums to total pot and stacks conserved
  const distributed = s.runItTwice!.potDistribution.reduce((sum, d) => sum + d.amount, 0);
    expect(distributed).toBe(300); // 150 + 150
  const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
  expect(totalAfter).toBe(totalBefore);
  });

  test('omaha evaluator enforces exactly two hole cards and three board cards', () => {
    // Construct a simple scenario: player holes: Ah As Kd Qc, board: Kh Qh Jh 9h 2c
    const holes: Card[] = [
      { rank: 'A', suit: 'hearts' },
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'diamonds' },
      { rank: 'Q', suit: 'clubs' },
    ];
    const board: Card[] = [
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
      { rank: '9', suit: 'hearts' },
      { rank: '2', suit: 'clubs' },
    ];
    // Best Omaha hand must use exactly two from holes and three from board.
    // Here, a possible strong hand is Straight (Q-K-A not available fully) or Flush using two hearts from holes? Only one heart in holes.
    // Ensure it does not incorrectly pick 1 hole + 4 board (illegal in Omaha).
    const ranking = HandEvaluator.getOmahaHandRanking(holes, board);
    expect(ranking.cards.length).toBe(5);
    // The selection must include exactly two from holes
    const holeSet = new Set((holes).map(c => `${c.rank}-${c.suit}`));
    const usedFromHoles = ranking.cards.filter(c => holeSet.has(`${c.rank}-${c.suit}`)).length;
    expect(usedFromHoles).toBe(2);
  });

  test('flush vs. straight: cannot make flush with 1 heart in holes + 4 hearts on board (must use 2 holes), should pick straight instead', () => {
    const holes: Card[] = [
      { rank: 'A', suit: 'hearts' }, // only one heart in holes
      { rank: 'K', suit: 'diamonds' },
      { rank: '4', suit: 'clubs' },
      { rank: '7', suit: 'spades' },
    ];
    const board: Card[] = [
      { rank: 'Q', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
      { rank: '10', suit: 'hearts' },
      { rank: '9', suit: 'hearts' },
      { rank: '2', suit: 'clubs' },
    ];
    const ranking = HandEvaluator.getOmahaHandRanking(holes, board);
    expect(ranking.rank).toBe(HandRank.Straight);
    expect(ranking.name.toLowerCase()).toContain('straight');
    expect(ranking.name.toLowerCase()).not.toContain('flush');
  });

  test('multi-way tie split under Omaha (3-way Broadway straight)', () => {
    const P = (id: string, pos: number, stack = 300): Player => ({
      id, name: id, position: pos, stack, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000
    });
    const players = [P('p1', 0), P('p2', 1), P('p3', 2)];
    const engine = createPokerEngine({ tableId: 'o2', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;
    // Set fixed board (Q J 10 9 2) and give A K to all players to form Broadway with exactly two holes
    state.communityCards = [
      { rank: 'Q', suit: 'diamonds' },
      { rank: 'J', suit: 'clubs' },
      { rank: '10', suit: 'spades' },
      { rank: '9', suit: 'hearts' },
      { rank: '2', suit: 'clubs' },
    ];
    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };
    assign('p1', [
      { rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }, { rank: '4', suit: 'diamonds' }, { rank: '7', suit: 'clubs' },
    ]);
    assign('p2', [
      { rank: 'A', suit: 'clubs' }, { rank: 'K', suit: 'diamonds' }, { rank: '5', suit: 'spades' }, { rank: '8', suit: 'hearts' },
    ]);
    assign('p3', [
      { rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'clubs' }, { rank: '3', suit: 'hearts' }, { rank: '6', suit: 'diamonds' },
    ]);

    // Normalize pot: remove blinds, then set equal all-ins 90 each
    const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot;
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 0;
    state.players.forEach((p: any) => { p.currentBet = 90; p.stack -= 90; p.isAllIn = true; });
    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });

    es.determineWinner();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    const potTotal = 90 * 3;
    // 3-way split; deterministic remainders assigned but totals conserved
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
    const gains = s.players.map(p => p.stack);
    // Everyone started from (initial - 90). Check they received close to equal shares
    const min = Math.min(...gains);
    const max = Math.max(...gains);
    expect(max - min).toBeLessThanOrEqual(1); // odd chip at most 1 difference
  });

  test('Omaha side pots: p1 & p2 tie main; p2 wins side; p3 takes solo side2', () => {
    const P = (id: string, pos: number, stack = 500): Player => ({
      id, name: id, position: pos, stack, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000
    });
    const players = [P('p1', 0), P('p2', 1), P('p3', 2)];
    const engine = createPokerEngine({ tableId: 'o3', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    // Board for straight scenarios (Q J 10 9 8)
    state.communityCards = [
      { rank: 'Q', suit: 'diamonds' },
      { rank: 'J', suit: 'clubs' },
      { rank: '10', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: '8', suit: 'clubs' },
    ];
    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };
    // p1 and p2 have A-K to make Broadway; p3 has K-Q to make lower straight
    assign('p1', [
      { rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }, { rank: '2', suit: 'diamonds' }, { rank: '3', suit: 'clubs' },
    ]);
    assign('p2', [
      { rank: 'A', suit: 'clubs' }, { rank: 'K', suit: 'diamonds' }, { rank: '4', suit: 'clubs' }, { rank: '5', suit: 'diamonds' },
    ]);
    assign('p3', [
      { rank: 'K', suit: 'clubs' }, { rank: 'Q', suit: 'hearts' }, { rank: '6', suit: 'diamonds' }, { rank: '7', suit: 'hearts' },
    ]);

    // Normalize pot and set uneven all-ins: 50, 100, 150
    const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot;
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 0;
    const p1 = state.players.find((p: any) => p.id === 'p1');
    const p2 = state.players.find((p: any) => p.id === 'p2');
    const p3 = state.players.find((p: any) => p.id === 'p3');
  p1.currentBet = 50; p1.stack -= 50; p1.isAllIn = true;
  p2.currentBet = 100; p2.stack -= 100; p2.isAllIn = true;
  p3.currentBet = 150; p3.stack -= 150; // covers

  // Capture pre-distribution stacks after bets
  const preStacks = new Map<string, number>(state.players.map((p: any) => [p.id, p.stack]));

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });

    es.determineWinner();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');

    // Pots: main 150 split p1 & p2 -> 75 each; side1 100 to p2; side2 50 to p3
  const s1 = s.players.find(p => p.id === 'p1')!;
  const s2 = s.players.find(p => p.id === 'p2')!;
  const s3 = s.players.find(p => p.id === 'p3')!;

  // Compute net winnings relative to stacks after placing bets
  const w1 = s1.stack - (preStacks.get('p1')!);
  const w2 = s2.stack - (preStacks.get('p2')!);
  const w3 = s3.stack - (preStacks.get('p3')!);
  // p2 should net 100 more than p1 from side1; p3 should net +50 from exclusive side2
  expect(w2 - w1).toBe(100);
  expect(w3).toBe(50);
    // Conservation
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });
});
