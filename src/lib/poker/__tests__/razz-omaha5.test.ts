import { createPokerEngine } from '../engine-factory';
import { DeckManager } from '../deck-manager';
import { HandEvaluator } from '../hand-evaluator';
import { PokerEngine } from '../poker-engine';
import { holeCardCount, isOmahaVariant, isSevenCardStudVariant, isStudVariant } from '../variant-rules';
import { HandRank } from '../../../types/poker';
import type { Card, Player } from '../../../types/poker';

const P = (id: string, pos: number, stack = 100): Player => ({
  id, name: id, position: pos, stack, currentBet: 0,
  hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

const c = (s: string): Card => {
  const suit = ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[s.slice(-1) as 'h' | 'd' | 'c' | 's'];
  return { rank: s.slice(0, -1) as Card['rank'], suit };
};
const cards = (s: string) => s.split(' ').map(c);

// Make the next shuffle deal these cards in this order (the deck deals from its end)
const stackDeck = (order: string) => {
  const deck = cards(order).reverse();
  return jest.spyOn(DeckManager.prototype, 'resetDeck').mockImplementation(function (this: any) {
    this.deck = [...deck];
  });
};

const act = (engine: PokerEngine, type: 'call' | 'check' | 'fold' | 'bet' | 'raise' | 'bring-in') => {
  const s = engine.getState();
  engine.handleAction({ type, playerId: s.activePlayer, tableId: s.tableId, timestamp: Date.now() });
};
const passive = (engine: PokerEngine) => {
  const s = engine.getState();
  if (s.studState?.bringIn?.pending) return act(engine, 'bring-in');
  const me = s.players.find(p => p.id === s.activePlayer)!;
  act(engine, s.currentBet > me.currentBet ? 'call' : 'check');
};

afterEach(() => jest.restoreAllMocks());

describe('variant facts', () => {
  test('razz is a seven-card stud game; 5-card Omaha deals five', () => {
    expect(isStudVariant('razz')).toBe(true);
    expect(isSevenCardStudVariant('razz')).toBe(true);
    expect(isOmahaVariant('omaha-5')).toBe(true);
    expect(holeCardCount('omaha-5')).toBe(5);
    expect(holeCardCount('omaha')).toBe(4);
    expect(holeCardCount('texas-holdem')).toBe(2);
    expect(holeCardCount(undefined)).toBe(2);
  });
});

describe('razz evaluation (ace-to-five low)', () => {
  const key = (s: string) => HandEvaluator.razzLowKey(cards(s));
  const better = (a: string, b: string) => HandEvaluator.compareRazzLow(key(a), key(b)) < 0;

  test('the wheel is the best hand; straights and flushes do not count', () => {
    expect(key('5h 4h 3h 2h Ah')).toEqual([0, 5, 4, 3, 2, 1]);
    expect(better('5h 4h 3h 2h Ah', '6c 4d 3s 2h Ac')).toBe(true);
    expect(HandEvaluator.evaluateRazzLow(cards('5h 4h 3h 2h Ah')).description).toBe('5-4-3-2-A low');
  });

  test('compares the highest card first, then down', () => {
    expect(better('8c 6d 4s 3h 2c', '8c 7d 3s 2h Ac')).toBe(true);
    expect(better('9c 5d 4s 3h 2c', '8c 7d 6s 5h 4c')).toBe(false);
    expect(HandEvaluator.compareRazzLow(key('7c 5d 4s 3h 2c'), key('7h 5s 4d 3c 2h'))).toBe(0);
  });

  test('any hand without a pair beats any paired hand', () => {
    expect(better('Kc Qd Js 10h 9c', 'Ac Ad 2s 3h 4c')).toBe(true);
    expect(better('Ac Ad 2s 3h 4c', '2c 2d As 3h 4c')).toBe(true);
    expect(better('3c 3d 2s 2h Ac', 'Ac Ad 2s 3h 4c')).toBe(false);
    expect(key('3c 3d 3s 2h Ac')[0]).toBe(3);
    expect(key('3c 3d 3s 2h 2c')[0]).toBe(4);
    expect(key('3c 3d 3s 3h 2c')[0]).toBe(5);
    expect(HandEvaluator.evaluateRazzLow(cards('9c 9d 5s 3h 2c')).description).toBe('Pair (9-5-3-2)');
  });

  test('picks the best five of seven, avoiding pairs', () => {
    const best = HandEvaluator.evaluateRazzLow(cards('Kc Kd 7s 5h 4c 2d As'));
    expect(best.key).toEqual([0, 7, 5, 4, 2, 1]);
    expect(best.description).toBe('7-5-4-2-A low');
    expect(best.lowCards).toHaveLength(5);
    // Only four ranks among seven cards: the best is the lowest pair, aces
    const paired = HandEvaluator.evaluateRazzLow(cards('Ac Ad 2c 2d 3c 3d 4c'));
    expect(paired.key).toEqual([1, 1, 4, 3, 2]);
    expect(paired.description).toBe('Pair (A-4-3-2)');
  });

  test('strength orders hands the same way, higher is better', () => {
    const order = ['5h 4d 3c 2s Ah', '6h 4d 3c 2s Ah', '8h 7d 6c 5s 4h', 'Kh Qd Jc 10s 9h', 'Ah Ad 2c 3s 4h', '2h 2d Ac 3s 4h', 'Ah Ad 2c 2s 3h'];
    const strengths = order.map(h => HandEvaluator.razzStrength(cards(h)));
    for (let i = 1; i < strengths.length; i++) expect(strengths[i - 1]).toBeGreaterThan(strengths[i]);
  });

  test('works on fewer than five cards (showing up cards)', () => {
    expect(better('7h 4d', '9c 3h')).toBe(true);
    expect(better('Kh Qd', '2c 2h')).toBe(true);
  });
});

describe('razz hands', () => {
  const engine3 = () => createPokerEngine({ tableId: 'razz', players: [P('a', 0), P('b', 1), P('c', 2)], smallBlind: 1, bigBlind: 2, state: { variant: 'razz' } });

  test('the highest up card brings it in, with the highest suit breaking a tie', () => {
    stackDeck('2c 3c 4c 5c 6c 7c Kc Ks 3d');
    const engine = engine3();
    engine.startNewHand();
    expect(engine.getState().activePlayer).toBe('b');
    act(engine, 'bring-in');
    const s = engine.getState();
    expect(s.studState!.bringIn!.player).toBe('b');
    expect(s.currentBet).toBe(1);
    expect(s.activePlayer).toBe('c');
  });

  test('aces are low for the bring-in', () => {
    stackDeck('2c 3c 4c 5c 6c 7c As 2s 5h');
    const engine = engine3();
    engine.startNewHand();
    expect(engine.getState().studState!.bringIn!.player).toBe('c');
  });

  test('the lowest showing hand acts first after third street, and the best low takes the whole pot', () => {
    // Dealt in order: two down cards each, then one up card each per street, then the last down card
    stackDeck([
      'Ac Kc Qc', '2d Kd Jd',
      '4s 9c 10d',
      '7h 3h 10c',
      '8h 6d Qs',
      '3c 5d Js',
      '6c 2c 9h',
    ].join(' '));
    const engine = engine3();
    engine.startNewHand();
    let s = engine.getState();
    // 10 is the highest up card
    expect(s.studState!.bringIn!.player).toBe('c');
    while (engine.getState().stage === 'third') passive(engine);
    s = engine.getState();
    expect(s.stage).toBe('fourth');
    // Showing 7-4 beats 9-3 and a pair of tens
    expect(s.activePlayer).toBe('a');
    let guard = 40;
    while (engine.getState().stage !== 'showdown' && guard-- > 0) passive(engine);
    s = engine.getState();
    expect(s.handWinners).toEqual(['a']);
    expect(s.players.find(p => p.id === 'a')!.stack).toBe(104);
    expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(300);
  });

  test('a razz hand played passively always settles with chips conserved', () => {
    for (let i = 0; i < 5; i++) {
      const engine = engine3();
      engine.startNewHand();
      let guard = 60;
      while (engine.getState().stage !== 'showdown' && guard-- > 0) passive(engine);
      const s = engine.getState();
      expect(s.stage).toBe('showdown');
      expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(300);
    }
  });
});

describe('5-card Omaha', () => {
  test('uses exactly two of the five hole cards', () => {
    // One heart in hand cannot make a flush with four on the board
    const noFlush = HandEvaluator.getOmahaHandRanking(cards('10h 3s 4d 5c 6s'), cards('Ah Kh Qh Jh 2c'));
    expect(noFlush.rank).toBe(HandRank.HighCard);
    // The fourth and fifth hole cards are considered too
    const boat = HandEvaluator.getOmahaHandRanking(cards('2d 3d 4d Ks Kc'), cards('Kh 7s 7d 9c 2h'));
    expect(boat.rank).toBe(HandRank.FullHouse);
    expect(boat.cards.filter(x => ['Ks', 'Kc'].includes(`${x.rank}${x.suit[0]}`)).length).toBe(2);
  });

  test('deals five hole cards, defaults to pot limit and settles a hand', () => {
    const engine = createPokerEngine({ tableId: 'plo5', players: [P('a', 0), P('b', 1), P('c', 2)], smallBlind: 1, bigBlind: 2, state: { variant: 'omaha-5' } });
    engine.startNewHand();
    let s = engine.getState();
    expect(s.bettingMode).toBe('pot-limit');
    expect(s.players.every(p => p.holeCards!.length === 5)).toBe(true);
    let guard = 40;
    while (engine.getState().stage !== 'showdown' && guard-- > 0) passive(engine);
    s = engine.getState();
    expect(s.communityCards).toHaveLength(5);
    expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(300);
    expect((s.handWinners || []).length).toBeGreaterThan(0);
  });
});
