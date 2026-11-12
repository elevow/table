import { DeckManager } from '../deck-manager';
import { PokerEngine } from '../poker-engine';
import { chicagoSpade } from '../chicago';
import { isSevenCardStudVariant } from '../variant-rules';
import { formatHandResult } from '../../utils/hand-result-formatter';
import type { Card, GameVariant, Player, PlayerAction } from '../../../types/poker';

const c = (s: string): Card => {
  const suit = ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[s.slice(-1) as 'h' | 'd' | 'c' | 's'];
  return { rank: s.slice(0, -1) as Card['rank'], suit };
};
const cards = (s: string) => s.split(' ').map(c);

const P = (id: string, pos: number, stack = 100): Player => ({
  id, name: id, position: pos, stack, currentBet: 0,
  hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

// Each hand in deal order: two down, four up, one down. The cards go round one at a time.
const stackDeck = (a: string, b: string) => {
  const [ha, hb] = [cards(a), cards(b)];
  const order: Card[] = [];
  for (let r = 0; r < 7; r++) order.push(ha[r], hb[r]);
  const deck = order.reverse();
  jest.spyOn(DeckManager.prototype, 'resetDeck').mockImplementation(function (this: any) {
    this.deck = [...deck];
  });
};

const act = (engine: PokerEngine, type: PlayerAction['type']) =>
  engine.handleAction({ type, playerId: engine.getState().activePlayer, tableId: 't', timestamp: Date.now() });

// Everyone calls or checks to the showdown
const playOut = (variant: GameVariant) => {
  const engine = new PokerEngine('t', [P('a', 1), P('b', 2)], 1, 2, { variant, bettingMode: 'fixed-limit' });
  engine.startNewHand();
  for (let i = 0; i < 40 && engine.getState().stage !== 'showdown'; i++) {
    const s = engine.getState();
    const me = s.players.find(p => p.id === s.activePlayer)!;
    if (s.studState?.bringIn?.pending) act(engine, 'bring-in');
    else if (s.currentBet > me.currentBet) act(engine, 'call');
    else act(engine, 'check');
  }
  return engine;
};

// a: king-high with the K of spades in the hole. b: aces with the 2 of spades in the hole.
const A = 'Ks 2c 3d 7h 8c Jd 5h';
const B = '2s Qd Ac Ad 6c 10h 9h';

afterEach(() => jest.restoreAllMocks());

describe('High and Low Chicago', () => {
  test('pick the highest or lowest spade in the hole, aces high', () => {
    expect(isSevenCardStudVariant('high-chicago')).toBe(true);
    const down = cards('As 2s 7s Kh');
    expect(chicagoSpade(down, 'high-chicago')).toEqual(c('As'));
    expect(chicagoSpade(down, 'low-chicago')).toEqual(c('2s'));
    expect(chicagoSpade(cards('Kh Qd'), 'high-chicago')).toBeUndefined();
  });

  test('High Chicago: the highest spade in the hole wins half, the best hand the other half', () => {
    stackDeck(A, B);
    const engine = playOut('high-chicago');
    const s = engine.getState();
    const pot = s.handResult!.pot;
    expect(s.chicagoResult).toEqual([{ playerId: 'a', card: c('Ks'), amount: Math.floor(pot / 2) }]);
    expect(s.handResult?.winnings).toEqual({ a: Math.floor(pot / 2), b: pot - Math.floor(pot / 2) });
    expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(200);
    expect(formatHandResult(s)?.message).toMatch(/a wins \$\d+ with the K♠ in the hole/);
  });

  test('Low Chicago: the lowest spade wins half; here the best hand has it, so it takes everything', () => {
    stackDeck(A, B);
    const engine = playOut('low-chicago');
    const s = engine.getState();
    expect(s.chicagoResult).toEqual([{ playerId: 'b', card: c('2s'), amount: Math.floor(s.handResult!.pot / 2) }]);
    expect(Object.keys(s.handResult?.winnings || {})).toEqual(['b']);
  });

  test('with no spade in the hole, the best hand takes the whole pot', () => {
    stackDeck('Kh 2c 3d 7h 8c Jd 5h', 'Qh Qd Ac Ad 6c 10h 9h');
    const s = playOut('high-chicago').getState();
    expect(s.chicagoResult).toEqual([]);
    expect(Object.keys(s.handResult?.winnings || {})).toEqual(['b']);
  });
});
