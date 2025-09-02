import { createPokerEngine } from '../engine-factory';
import { Card, Player } from '../../../types/poker';

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

describe('US-052 Omaha Hi-Lo (8 or Better) showdown distribution', () => {
  test('no qualifying low: entire pot awarded to high winner; lastHiLoResult.low is null', () => {
    const players = [P('p1', 0), P('p2', 1), P('p3', 2)];
    const engine = createPokerEngine({ tableId: 'hilo1', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha-hi-lo' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    // Board has only two low cards (A and 2) -> no player can qualify for low (needs 3 on board)
    state.communityCards = [
      { rank: '9', suit: 'diamonds' },
      { rank: '9', suit: 'clubs' },
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: '2', suit: 'spades' },
    ] as Card[];

    // p1: two 9s in holes to make four-of-a-kind using 2-from-hole + 3-from-board
    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };
    assign('p1', [
      { rank: '9', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: 'Q', suit: 'clubs' },
      { rank: '3', suit: 'diamonds' },
    ]);
    // p2: weaker high hand
    assign('p2', [
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'diamonds' },
      { rank: 'J', suit: 'clubs' },
      { rank: '8', suit: 'hearts' },
    ]);

  // Seed an existing pot (base pot) so distribution uses a single pot of fixed size with no current bets
  state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 200;
    const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot;
  // Fold out third player
  const p3 = state.players.find((pp: any) => pp.id === 'p3');
  p3.isFolded = true; p3.hasActed = true;

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    // No qualifying low -> all to high winner p1
    const p1 = s.players.find(p => p.id === 'p1')!;
    const p2 = s.players.find(p => p.id === 'p2')!;
    expect((s.lastHiLoResult!.low)).toBeNull();
    const highTotal = s.lastHiLoResult!.high.reduce((sum, h) => sum + h.amount, 0);
    expect(highTotal).toBe(200);
    expect(p1.stack).toBeGreaterThan(p2.stack);
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });

  test('qualifying low present: pot split hi/lo with odd chip to high; lastHiLoResult populated', () => {
    const players = [P('p1', 0), P('p2', 1), P('p3', 2)];
    const engine = createPokerEngine({ tableId: 'hilo2', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha-hi-lo' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    // Board contains three low cards (A,2,3) enabling a low; includes a K to enable strong high for p1
    state.communityCards = [
      { rank: 'A', suit: 'clubs' },
      { rank: '2', suit: 'diamonds' },
      { rank: '3', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: 'K', suit: 'clubs' },
    ] as Card[];

    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };
    // p1: two Kings to win high (trips with board K); no low (no low holes)
    assign('p1', [
      { rank: 'K', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: 'Q', suit: 'spades' },
      { rank: 'J', suit: 'clubs' },
    ]);
    // p2: two low cards (4,6) to make A-2-3-4-6 low (no high straight)
    assign('p2', [
      { rank: '4', suit: 'hearts' },
      { rank: '6', suit: 'clubs' },
      { rank: '8', suit: 'diamonds' },
      { rank: '7', suit: 'spades' },
    ]);

    // Seed odd-sized base pot to test odd chip assignment to high side
  state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 101; // odd -> 51 to high, 50 to low when single winners each
    const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot;
  // Fold out third player
  const p3b = state.players.find((pp: any) => pp.id === 'p3');
  p3b.isFolded = true; p3b.hasActed = true;

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    // Expect hi/lo split: p1 gets 51 (high), p2 gets 50 (low)
    const p1 = s.players.find(p => p.id === 'p1')!;
    const p2 = s.players.find(p => p.id === 'p2')!;
    const high = s.lastHiLoResult!.high.find(h => h.playerId === 'p1')?.amount || 0;
    const low = s.lastHiLoResult!.low?.find(l => l.playerId === 'p2')?.amount || 0;
    expect(high).toBe(51);
    expect(low).toBe(50);
    expect(p1.stack - p2.stack).toBe(1); // odd chip to high side
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });

  test('multi-way split: two high winners tie; two low winners tie; single even base pot splits evenly', () => {
    const players = [P('p1', 0), P('p2', 1), P('p3', 2), P('p4', 3)];
    const engine = createPokerEngine({ tableId: 'hilo3', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha-hi-lo' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    // Board enables a low (A,2,6) and a K to allow trips K with two Ks in holes, but avoids wheel straight for 4-5
    state.communityCards = [
      { rank: 'A', suit: 'clubs' },
      { rank: '2', suit: 'diamonds' },
      { rank: '6', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: 'K', suit: 'clubs' },
    ] as Card[];

    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };
    // High tie: p1 and p2 both have KK in holes -> trips K with board K, identical kickers from board
    assign('p1', [
      { rank: 'K', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: 'Q', suit: 'spades' },
      { rank: 'J', suit: 'clubs' },
    ]);
    assign('p2', [
      { rank: 'K', suit: 'spades' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'hearts' },
      { rank: 'J', suit: 'diamonds' },
    ]);
    // Low tie: p3 and p4 both make A-2-3-4-5 low using 4 and 5 in holes
    assign('p3', [
      { rank: '4', suit: 'hearts' },
      { rank: '5', suit: 'clubs' },
      { rank: '8', suit: 'diamonds' },
      { rank: '8', suit: 'clubs' },
    ]);
    assign('p4', [
      { rank: '4', suit: 'spades' },
      { rank: '5', suit: 'diamonds' },
      { rank: '7', suit: 'clubs' },
      { rank: '7', suit: 'hearts' },
    ]);

    // Neutralize blinds and seed an even base pot
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 200; // even -> 100 high, 100 low
    const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot;

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    // High split between p1 and p2; Low split between p3 and p4
    const high = s.lastHiLoResult!.high;
    const low = s.lastHiLoResult!.low!;
    const h1 = high.find(h => h.playerId === 'p1')?.amount || 0;
    const h2 = high.find(h => h.playerId === 'p2')?.amount || 0;
    const l3 = low.find(l => l.playerId === 'p3')?.amount || 0;
    const l4 = low.find(l => l.playerId === 'p4')?.amount || 0;
    expect(h1).toBe(50);
    expect(h2).toBe(50);
    expect(l3).toBe(50);
    expect(l4).toBe(50);
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });

  test('side pots under Omaha Hi-Lo: main and side pots split hi/lo among eligible winners', () => {
    const players = [P('p1', 0), P('p2', 1), P('p3', 2)];
    const engine = createPokerEngine({ tableId: 'hilo4', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha-hi-lo' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    // Board with three low cards (A,2,7) but avoids wheel straight for 3-4
    state.communityCards = [
      { rank: 'A', suit: 'clubs' },
      { rank: '2', suit: 'diamonds' },
      { rank: '7', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: 'K', suit: 'clubs' },
    ] as Card[];

    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };

    // p2: high winner (trips K); no low
    assign('p2', [
      { rank: 'K', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: 'Q', suit: 'spades' },
      { rank: 'J', suit: 'clubs' },
    ]);
    // p3: low winner (A-2-3-4-7 or similar); ensure no straight high
    assign('p3', [
      { rank: '3', suit: 'hearts' },
      { rank: '4', suit: 'clubs' },
      { rank: '8', suit: 'diamonds' },
      { rank: '8', suit: 'clubs' },
    ]);
    // p1: weak hand
    assign('p1', [
      { rank: 'Q', suit: 'hearts' },
      { rank: 'J', suit: 'diamonds' },
      { rank: '10', suit: 'spades' },
      { rank: '9', suit: 'clubs' },
    ]);

    // Zero pot, forge side pots via current bets: p1=50, p2=150, p3=150
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 0;
    const setBet = (pid: string, amt: number) => { const p = state.players.find((pp: any) => pp.id === pid); p.currentBet = amt; };
    setBet('p1', 50); setBet('p2', 150); setBet('p3', 150);
    const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot + state.players.reduce((s: number, p: any) => s + p.currentBet, 0);

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    // Pots expected:
    // - Main 150 (50x3): 75 high -> p2, 75 low -> p3
    // - Side 200 (100x2): 100 high -> p2, 100 low -> p3
    const h2 = s.lastHiLoResult!.high.find(h => h.playerId === 'p2')?.amount || 0;
    const l3 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p3')?.amount || 0;
    expect(h2).toBe(175);
    expect(l3).toBe(175);
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });

  test('tie on low: two players split low half; odd chip from total pot still goes to high side', () => {
    const players = [P('p1', 0), P('p2', 1), P('p3', 2)];
    const engine = createPokerEngine({ tableId: 'hilo5', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha-hi-lo' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    state.communityCards = [
      { rank: 'A', suit: 'clubs' },
      { rank: '2', suit: 'diamonds' },
      { rank: '3', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: 'K', suit: 'clubs' },
    ] as Card[];

    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };
    // p3 high winner (trips K)
    assign('p3', [
      { rank: 'K', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: 'Q', suit: 'spades' },
      { rank: 'J', suit: 'clubs' },
    ]);
    // p1 and p2 both make same low (4 and 6 in holes)
    assign('p1', [
      { rank: '4', suit: 'hearts' },
      { rank: '6', suit: 'clubs' },
      { rank: '8', suit: 'diamonds' },
      { rank: '7', suit: 'spades' },
    ]);
    assign('p2', [
      { rank: '4', suit: 'spades' },
      { rank: '6', suit: 'diamonds' },
      { rank: '7', suit: 'clubs' },
      { rank: '8', suit: 'hearts' },
    ]);

    // Neutralize blinds and use an odd base pot to verify odd chip goes to high side
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 101; // -> highPortion 51 (to p3), lowPortion 50 split 25/25 between p1 & p2
    const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot;

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    const high = s.lastHiLoResult!.high.find(h => h.playerId === 'p3')?.amount || 0;
    const low1 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p1')?.amount || 0;
    const low2 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p2')?.amount || 0;
    expect(high).toBe(51);
    expect(low1).toBe(25);
    expect(low2).toBe(25);
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });

  test('three-way low tie: low split among three; high to single winner', () => {
    const players = [P('p1', 0), P('p2', 1), P('p3', 2), P('p4', 3)];
    const engine = createPokerEngine({ tableId: 'hilo6', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha-hi-lo' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    // Board enables low (A,2,6) and has K for strong high with KK holes
    state.communityCards = [
      { rank: 'A', suit: 'clubs' },
      { rank: '2', suit: 'diamonds' },
      { rank: '6', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: 'K', suit: 'clubs' },
    ] as Card[];

    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };

    // p1: high-only winner (trips K), no low
    assign('p1', [
      { rank: 'K', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: 'Q', suit: 'spades' },
      { rank: 'J', suit: 'clubs' },
    ]);
    // p2, p3, p4: identical low A-2-4-5-6
  const lowHoles: Card[] = [
      { rank: '4', suit: 'hearts' },
      { rank: '5', suit: 'clubs' },
      { rank: '8', suit: 'diamonds' },
      { rank: '7', suit: 'spades' },
  ];
    assign('p2', lowHoles);
    assign('p3', [
      { rank: '4', suit: 'spades' },
      { rank: '5', suit: 'diamonds' },
      { rank: '8', suit: 'hearts' },
      { rank: '7', suit: 'clubs' },
    ]);
    assign('p4', [
      { rank: '4', suit: 'diamonds' },
      { rank: '5', suit: 'spades' },
      { rank: '8', suit: 'clubs' },
      { rank: '7', suit: 'hearts' },
    ]);

    // Even base pot for clean split
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 102; // -> high 51 to p1; low 51 split 17 each among p2,p3,p4
    const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot;

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    const high = s.lastHiLoResult!.high.find(h => h.playerId === 'p1')?.amount || 0;
    const low2 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p2')?.amount || 0;
    const low3 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p3')?.amount || 0;
    const low4 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p4')?.amount || 0;
    expect(high).toBe(51);
    expect([low2, low3, low4].every(v => v === 17)).toBe(true);
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });

  test('mixed low eligibility: one player does not qualify; low half to qualifiers only', () => {
    const players = [P('p1', 0), P('p2', 1), P('p3', 2)];
    const engine = createPokerEngine({ tableId: 'hilo7', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha-hi-lo' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    state.communityCards = [
      { rank: 'A', suit: 'clubs' },
      { rank: '2', suit: 'diamonds' },
      { rank: '6', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: 'K', suit: 'clubs' },
    ] as Card[];

    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };
    // p1: high winner (KK), no low
    assign('p1', [
      { rank: 'K', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: 'Q', suit: 'spades' },
      { rank: 'J', suit: 'clubs' },
    ]);
    // p2: qualifies low (4,5)
    assign('p2', [
      { rank: '4', suit: 'hearts' },
      { rank: '5', suit: 'clubs' },
      { rank: '8', suit: 'diamonds' },
      { rank: '7', suit: 'spades' },
    ]);
    // p3: does not qualify low (all high cards)
    assign('p3', [
      { rank: 'Q', suit: 'hearts' },
      { rank: 'J', suit: 'diamonds' },
      { rank: '10', suit: 'spades' },
      { rank: '9', suit: 'clubs' },
    ]);

    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 103; // highPortion 52 -> p1, lowPortion 51 -> p2 only
    const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot;

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    const h1 = s.lastHiLoResult!.high.find(h => h.playerId === 'p1')?.amount || 0;
    const l2 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p2')?.amount || 0;
    expect(h1).toBe(52);
    expect(l2).toBe(51);
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });

  test('side pots: high half tie uses remainder; low to single winner across pots', () => {
    const players = [P('p1', 0), P('p2', 1), P('p3', 2)];
    const engine = createPokerEngine({ tableId: 'hilo8', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha-hi-lo' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    state.communityCards = [
      { rank: 'A', suit: 'clubs' },
      { rank: '2', suit: 'diamonds' },
      { rank: '6', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: 'K', suit: 'clubs' },
    ] as Card[];

    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };
    // p1 and p2 tie for high (trips K); p3 loses high; only p3 qualifies low
    assign('p1', [
      { rank: 'K', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: 'Q', suit: 'spades' },
      { rank: 'J', suit: 'clubs' },
    ]);
    assign('p2', [
      { rank: 'K', suit: 'spades' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'hearts' },
      { rank: 'J', suit: 'diamonds' },
    ]);
    assign('p3', [
      { rank: '4', suit: 'hearts' },
      { rank: '5', suit: 'clubs' },
      { rank: '8', suit: 'diamonds' },
      { rank: '7', suit: 'spades' },
    ]);

    // Create two side pots from current bets: 150 (all three) and 200 (p2,p3)
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 0;
    const setBet = (pid: string, amt: number) => { const p = state.players.find((pp: any) => pp.id === pid); p.currentBet = amt; };
    setBet('p1', 50); setBet('p2', 150); setBet('p3', 150);
    const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot + state.players.reduce((s: number, p: any) => s + p.currentBet, 0);

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    // Expected totals:
    // Pot 150: high 75 split between p1/p2 => 38 to p1, 37 to p2 (remainder to earliest); low 75 -> p3
    // Pot 200: high 100 -> p2; low 100 -> p3
    const h1 = s.lastHiLoResult!.high.find(h => h.playerId === 'p1')?.amount || 0;
    const h2 = s.lastHiLoResult!.high.find(h => h.playerId === 'p2')?.amount || 0;
    const l3 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p3')?.amount || 0;
    expect(h1).toBe(38);
    expect(h2).toBe(137);
    expect(l3).toBe(175);
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });

  test('side pots: low half tie uses remainder; high to single winner across pots', () => {
    const players = [P('p1', 0), P('p2', 1), P('p3', 2)];
    const engine = createPokerEngine({ tableId: 'hilo9', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha-hi-lo' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    // Board enables low (A,2,6) and high (K on board)
    state.communityCards = [
      { rank: 'A', suit: 'clubs' },
      { rank: '2', suit: 'diamonds' },
      { rank: '6', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: 'K', suit: 'clubs' },
    ] as Card[];

    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };

    // p1: wins high (KK) and ties low with p2 (4,5)
    assign('p1', [
      { rank: 'K', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: '4', suit: 'spades' },
      { rank: '5', suit: 'diamonds' },
    ]);
    // p2: ties low with p1; weak high
    assign('p2', [
      { rank: '4', suit: 'hearts' },
      { rank: '5', suit: 'clubs' },
      { rank: 'Q', suit: 'spades' },
      { rank: 'J', suit: 'diamonds' },
    ]);
    // p3: best low (3,4) for main pot only; ineligible for side pot
    assign('p3', [
      { rank: '3', suit: 'hearts' },
      { rank: '4', suit: 'clubs' },
      { rank: '8', suit: 'diamonds' },
      { rank: '7', suit: 'spades' },
    ]);

    // Create main pot 150 (50x3) and side pot 150 (75x2) via current bets
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 0;
    const setBet = (pid: string, amt: number) => { const p = state.players.find((pp: any) => pp.id === pid); p.currentBet = amt; };
    setBet('p1', 125); setBet('p2', 125); setBet('p3', 50);
    const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot + state.players.reduce((s: number, p: any) => s + p.currentBet, 0);

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    // Expected distributions:
    // Main pot 150: high 75 -> p1; low 75 -> p3 (best low)
    // Side pot 150 (p1,p2): high 75 -> p1; low 75 split between p1/p2 with remainder -> p1:38, p2:37
    const h1 = s.lastHiLoResult!.high.find(h => h.playerId === 'p1')?.amount || 0; // 150
    const l1 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p1')?.amount || 0; // 38
    const l2 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p2')?.amount || 0; // 37
    const l3 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p3')?.amount || 0; // 75
    expect(h1).toBe(150);
    expect(l1).toBe(38);
    expect(l2).toBe(37);
    expect(l3).toBe(75);
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });

  test('combined remainders across pots: high remainder in main; low remainder in side', () => {
    const players = [P('p1', 0), P('p2', 1), P('p3', 2)];
    const engine = createPokerEngine({ tableId: 'hilo10', players, smallBlind: 1, bigBlind: 2, state: { variant: 'omaha-hi-lo' } });
    engine.startNewHand();
    const es = engine as any;
    const state = es.state as any;

    // Board supports both high (K on board) and qualifying low (A,2,6)
    state.communityCards = [
      { rank: 'A', suit: 'clubs' },
      { rank: '2', suit: 'diamonds' },
      { rank: '6', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: 'K', suit: 'clubs' },
    ] as Card[];

    const assign = (pid: string, holes: Card[]) => {
      const p = state.players.find((pp: any) => pp.id === pid);
      p.holeCards = holes;
    };

    // p1: KK for high + (4,5) for low
    assign('p1', [
      { rank: 'K', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: '4', suit: 'spades' },
      { rank: '5', suit: 'diamonds' },
    ]);
    // p2: KK for high + (4,5) for low (distinct suits where practical)
    assign('p2', [
      { rank: 'K', suit: 'spades' },
      { rank: 'K', suit: 'hearts' },
      { rank: '4', suit: 'hearts' },
      { rank: '5', suit: 'clubs' },
    ]);
    // p3: best low (3,4), weak high
    assign('p3', [
      { rank: '3', suit: 'hearts' },
      { rank: '4', suit: 'clubs' },
      { rank: '8', suit: 'diamonds' },
      { rank: '7', suit: 'spades' },
    ]);

    // Main pot 150 (50x3), Side pot 150 (extra 75 from p1 and p2 only)
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 0;
    const setBet = (pid: string, amt: number) => { const p = state.players.find((pp: any) => pp.id === pid); p.currentBet = amt; };
    setBet('p1', 125); setBet('p2', 125); setBet('p3', 50);
    const totalBefore = state.players.reduce((s: number, p: any) => s + p.stack, 0) + state.pot + state.players.reduce((s: number, p: any) => s + p.currentBet, 0);

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    // Expected per-pot logic:
    // Main 150: high 75 split p1/p2 -> 38/37 (remainder to earliest), low 75 -> p3
    // Side 150 (p1,p2): high 75 split p1/p2 -> 38/37, low 75 split p1/p2 -> 38/37
    const h1 = s.lastHiLoResult!.high.find(h => h.playerId === 'p1')?.amount || 0; // 38 + 38 = 76
    const h2 = s.lastHiLoResult!.high.find(h => h.playerId === 'p2')?.amount || 0; // 37 + 37 = 74
    const l1 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p1')?.amount || 0; // 38
    const l2 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p2')?.amount || 0; // 37
    const l3 = s.lastHiLoResult!.low!.find(l => l.playerId === 'p3')?.amount || 0; // 75
    expect(h1).toBe(76);
    expect(h2).toBe(74);
    expect(l1).toBe(38);
    expect(l2).toBe(37);
    expect(l3).toBe(75);
    const totalAfter = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    expect(totalAfter).toBe(totalBefore);
  });
});
