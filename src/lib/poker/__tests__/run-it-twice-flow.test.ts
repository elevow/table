import { PokerEngine } from '../poker-engine';
import { runSupabaseAutoRunoutSync } from '../supabase-auto-runout';
import { sanitizeStateForBroadcast } from '../state-sanitizer';
import type { Card, TableState } from '../../../types/poker';

const mk = (id: string, position: number, stack: number): any => ({
  id, name: id, position, stack, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});
const key = (c: Card) => `${c.rank}${c.suit}`;
const c = (s: string): Card => ({
  rank: s.slice(0, -1) as Card['rank'],
  suit: ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[s.slice(-1) as 'h' | 'd' | 'c' | 's'],
});

/** Three players: one folds, the other two are all-in preflop. */
function allInPreflop(variant?: 'omaha-hi-lo') {
  const engine = new PokerEngine('t', [mk('a', 1, 100), mk('b', 2, 100), mk('c', 3, 100)], 1, 2, variant ? { variant } : undefined);
  engine.startNewHand();
  const act = (type: string, amount?: number) => {
    const s = engine.getState();
    engine.handleAction({ type, amount, playerId: s.activePlayer, tableId: 't', timestamp: 0 } as any);
  };
  act('fold');
  act('raise', 100);
  act('call');
  return engine;
}

describe('run it twice, through the real runout', () => {
  it('deals separate boards from one deck, reveals them run by run, and settles both', async () => {
    const engine = allInPreflop();
    // The engine dealt a flop when betting closed; players had not seen it when they chose
    expect(engine.getState().communityCards).toHaveLength(3);
    const startTotal = engine.getState().players.reduce((sum, p) => sum + p.stack, 0) + engine.getState().pot;

    engine.startRunItTwice(2, 0);
    expect(engine.getState().communityCards).toHaveLength(0);

    const seen: TableState[] = [];
    await runSupabaseAutoRunoutSync('t', engine as any, async state => { seen.push(sanitizeStateForBroadcast(state)); }, 0);

    const final = engine.getState();
    const rit = final.runItTwice!;
    expect(final.stage).toBe('showdown');
    expect(rit.enabled).toBe(true);
    expect(rit.boards).toHaveLength(2);
    rit.boards.forEach(board => expect(board).toHaveLength(5));
    expect(rit.results).toHaveLength(2);

    // No card twice anywhere: every player's cards (the folded hand too) and both boards
    const all = [...final.players.flatMap(p => p.holeCards || []), ...rit.boards.flat()].map(key);
    expect(new Set(all).size).toBe(all.length);

    // Clients saw run 1 fill up (3, 4, 5 cards) before run 2 started
    const revealSteps = seen
      .filter(s => s.stage !== 'showdown')
      .map(s => (s.runItTwice?.boards || []).map(b => b.length).join(','));
    expect(revealSteps).toEqual(['3,0', '4,0', '5,0', '5,3', '5,4', '5,5']);

    // Winners and the pot are recorded, and no chips appear or vanish
    // The player who folded was under the gun and had put nothing in
    expect(final.handResult!.pot).toBe(200);
    expect(final.handWinners!.length).toBeGreaterThan(0);
    const endTotal = final.players.reduce((sum, p) => sum + p.stack, 0);
    expect(endTotal).toBe(startTotal);
    const paid = rit.potDistribution.reduce((sum, d) => sum + d.amount, 0);
    expect(paid).toBe(200);
  });

  it('keeps the cards already shown when the all-in happened on the flop', async () => {
    const engine = allInPreflop();
    const flop = engine.getState().communityCards.slice();
    engine.startRunItTwice(2, 3);
    await runSupabaseAutoRunoutSync('t', engine as any, async () => {}, 0);
    const boards = engine.getState().runItTwice!.boards;
    boards.forEach(board => expect(board.slice(0, 3).map(key)).toEqual(flop.map(key)));
    // The turn and river differ between the runs
    expect(new Set([...boards[0].slice(3), ...boards[1].slice(3)].map(key)).size).toBe(4);
  });

  it('hides each board beyond what has been revealed', () => {
    const engine = allInPreflop();
    engine.startRunItTwice(2, 0);
    let view = sanitizeStateForBroadcast(engine.getState());
    expect(view.runItTwice!.boards.map(b => b.length)).toEqual([0, 0]);
    engine.revealRunItTwiceStep();
    view = sanitizeStateForBroadcast(engine.getState());
    expect(view.runItTwice!.boards.map(b => b.length)).toEqual([3, 0]);
  });

  it('refuses more runs than there are cards for', () => {
    const engine = allInPreflop();
    expect(() => engine.startRunItTwice(10, 0)).toThrow('Not enough cards');
    expect(engine.getState().runItTwice).toBeUndefined();
  });
});

describe('run it twice in Omaha Hi-Lo', () => {
  it('splits each run between the best high and the best qualifying low', () => {
    const engine = allInPreflop('omaha-hi-lo');
    const state = engine.getState();
    const [x, y] = state.players.filter(p => !p.isFolded);
    // x: A-2 for the low, kings for the high; y: queens and jacks
    x.holeCards = [c('Ah'), c('2d'), c('Kc'), c('Ks')];
    y.holeCards = [c('Qh'), c('Qd'), c('Jc'), c('Js')];
    engine.startRunItTwice(2, 0);
    const rit = engine.getState().runItTwice!;
    // Run 1: y makes trip queens (high), x makes 8-4-3-2-A (low): split
    // Run 2: no low possible (only two low ranks), x makes kings full: x takes it all
    rit.boards = [
      [c('3s'), c('4h'), c('8d'), c('Qc'), c('9h')],
      [c('Kh'), c('7c'), c('4d'), c('4s'), c('9s')],
    ];
    const before = new Map(engine.getState().players.map(p => [p.id, p.stack]));
    engine.runItTwiceNow();

    const after = engine.getState();
    const won = (id: string) => after.players.find(p => p.id === id)!.stack - before.get(id)!;
    const pot = after.handResult!.pot;
    // Half of run 1 (a quarter of the pot) to y; x gets the low quarter plus all of run 2
    expect(won(y.id)).toBe(Math.ceil(pot / 2 / 2));
    expect(won(x.id)).toBe(pot - Math.ceil(pot / 2 / 2));

    const run1 = after.runItTwice!.results[0].winners;
    expect(run1.find(w => w.playerId === x.id)!.side).toBe('low');
    expect(run1.find(w => w.playerId === y.id)!.side).toBe('high');
    expect(after.runItTwice!.results[1].winners).toEqual([expect.objectContaining({ playerId: x.id, side: 'high' })]);
  });
});
