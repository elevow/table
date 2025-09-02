import { PokerEngine } from '../poker-engine';
import { Player, Card } from '../../../types/poker';

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

describe('US-033: remainder distribution permutations - three-way ties across multiple pots', () => {
  it('three-way tie on base + single-level side pot (remainder 1 on base goes to first winner)', () => {
    const players = [
      createPlayer('p1', 0, 200),
      createPlayer('p2', 1, 200),
      createPlayer('p3', 2, 200),
    ];
    const engine = new PokerEngine('t-rem-1', players, 5, 10);
    engine.startNewHand();

    const es = engine as any;
    const state = es.state as any;

    // Normalize away blinds/pot
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 0;

    // Set base pot (potBefore) larger than betsTotal so basePot > 0 and has remainder 1 when split by 3
    // betsTotal will be 210 (70 each), so choose potBefore=280 => basePot = 70 (70 % 3 = 1)
    state.pot = 280;

    // Equal contributions to form a single side pot among all three (amount 210)
    const p1 = state.players.find((p: any) => p.id === 'p1');
    const p2 = state.players.find((p: any) => p.id === 'p2');
    const p3 = state.players.find((p: any) => p.id === 'p3');
    p1.currentBet = 70; p1.stack -= 70; p1.isAllIn = true;
    p2.currentBet = 70; p2.stack -= 70; p2.isAllIn = true;
    p3.currentBet = 70; p3.stack -= 70; // covers

    // Force a board-tie (royal flush on board) so all hands tie for both pots
    const board: Card[] = [
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
      { rank: '10', suit: 'hearts' },
    ];
    state.communityCards = board;
    p1.holeCards = [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'spades' }];
    p2.holeCards = [{ rank: '4', suit: 'clubs' }, { rank: '5', suit: 'spades' }];
    p3.holeCards = [{ rank: '6', suit: 'clubs' }, { rank: '7', suit: 'spades' }];

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');

    // Expectations:
    // - Side pot 210 split equally (70 each)
    // - Base pot 70 -> split 23/23/24 with remainder +1 to first in order (p1)
    const fp1 = s.players.find(p => p.id === 'p1')!;
    const fp2 = s.players.find(p => p.id === 'p2')!;
    const fp3 = s.players.find(p => p.id === 'p3')!;
    expect(fp1.stack).toBe(224); // 200-70 + 70 + 24
    expect(fp2.stack).toBe(223); // 200-70 + 70 + 23
    expect(fp3.stack).toBe(223); // 200-70 + 70 + 23
  });

  it('three equal winners across two side pots with remainders (folded contributors inflate pots)', () => {
    // Five players: p1-p3 active and tying; p4 and p5 folded but with bets to create remaindered pots
    const players: Player[] = [
      createPlayer('p1', 0, 200),
      createPlayer('p2', 1, 200),
      createPlayer('p3', 2, 200),
      createPlayer('p4', 3, 200),
      createPlayer('p5', 4, 200),
    ];
    const engine = new PokerEngine('t-rem-3', players, 5, 10);
    engine.startNewHand();

    const es = engine as any;
    const state = es.state as any;

    // Normalize away blinds/pot
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 0;

    // Bets: winners all at 113; folded contributors at 50 and 81 to make levels [50,81,113]
    const p1 = state.players.find((p: any) => p.id === 'p1');
    const p2 = state.players.find((p: any) => p.id === 'p2');
    const p3 = state.players.find((p: any) => p.id === 'p3');
    const p4 = state.players.find((p: any) => p.id === 'p4');
    const p5 = state.players.find((p: any) => p.id === 'p5');
    p1.currentBet = 113; p1.stack -= 113;
    p2.currentBet = 113; p2.stack -= 113;
    p3.currentBet = 113; p3.stack -= 113;
    p4.currentBet = 50;  p4.stack -= 50;  p4.isFolded = true;
    p5.currentBet = 81;  p5.stack -= 81;  p5.isFolded = true;

    // Royal flush on board so p1-p3 are equal winners for all eligible pots
    const board: Card[] = [
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
      { rank: '10', suit: 'hearts' },
    ];
    state.communityCards = board;
    p1.holeCards = [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'spades' }];
    p2.holeCards = [{ rank: '4', suit: 'clubs' }, { rank: '5', suit: 'spades' }];
    p3.holeCards = [{ rank: '6', suit: 'clubs' }, { rank: '7', suit: 'spades' }];

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');

    // Pots expected:
    // - Level 50: 5 contributors => 250 split among 3 winners => 84,83,83 (remainder +1 to p1)
    // - Level 81: 4 contributors => 124 split among 3 winners => 42,41,41 (remainder +1 to p1)
    // - Level 113: 3 contributors => 96 split among 3 winners => 32 each
    const fp1 = s.players.find(p => p.id === 'p1')!;
    const fp2 = s.players.find(p => p.id === 'p2')!;
    const fp3 = s.players.find(p => p.id === 'p3')!;
    const fp4 = s.players.find(p => p.id === 'p4')!;
    const fp5 = s.players.find(p => p.id === 'p5')!;

    expect(fp1.stack).toBe(245); // 200-113 + (84+42+32)
    expect(fp2.stack).toBe(243); // 200-113 + (83+41+32)
    expect(fp3.stack).toBe(243); // 200-113 + (83+41+32)
    expect(fp4.stack).toBe(150); // 200-50
    expect(fp5.stack).toBe(119); // 200-81
  });
  it('three-way tie on base + tiered side pots (base remainder 2 goes to p1 then p2; unmatched top returns)', () => {
    const players = [
      createPlayer('p1', 0, 200),
      createPlayer('p2', 1, 200),
      createPlayer('p3', 2, 200),
    ];
    const engine = new PokerEngine('t-rem-2', players, 5, 10);
    engine.startNewHand();

    const es = engine as any;
    const state = es.state as any;

    // Normalize away blinds/pot
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 0;

    // Contributions: p1=70, p2=70, p3=120 -> levels 70 (all three), 120 (p3 only)
    const p1 = state.players.find((p: any) => p.id === 'p1');
    const p2 = state.players.find((p: any) => p.id === 'p2');
    const p3 = state.players.find((p: any) => p.id === 'p3');
    p1.currentBet = 70; p1.stack -= 70; p1.isAllIn = true;
    p2.currentBet = 70; p2.stack -= 70; p2.isAllIn = true;
    p3.currentBet = 120; p3.stack -= 120; // covers higher level alone

    // Set base pot so basePot has remainder 2 when split by 3: basePot = potBefore - betsTotal
    // betsTotal = 260, choose potBefore = 331 => basePot = 71 (71 % 3 = 2)
    state.pot = 331;

    // Board ties all three
    const board: Card[] = [
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
      { rank: '10', suit: 'hearts' },
    ];
    state.communityCards = board;
    p1.holeCards = [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'spades' }];
    p2.holeCards = [{ rank: '4', suit: 'clubs' }, { rank: '5', suit: 'spades' }];
    p3.holeCards = [{ rank: '6', suit: 'clubs' }, { rank: '7', suit: 'spades' }];

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');

    // Expectations:
    // - Side pot level 70: 210 split equally (70 each)
    // - Side pot level 120: 50 goes entirely to p3 (sole eligible)
    // - Base pot 71 -> split 24 (p1), 24 (p2), 23 (p3) due to remainder 2
    const fp1 = s.players.find(p => p.id === 'p1')!;
    const fp2 = s.players.find(p => p.id === 'p2')!;
    const fp3 = s.players.find(p => p.id === 'p3')!;
    expect(fp1.stack).toBe(224); // 200-70 + 70 + 24
    expect(fp2.stack).toBe(224); // 200-70 + 70 + 24
    expect(fp3.stack).toBe(223); // 200-120 + 70 + 23 + 50
  });
});
