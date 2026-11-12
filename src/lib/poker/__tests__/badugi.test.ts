import { DeckManager } from '../deck-manager';
import { PokerEngine } from '../poker-engine';
import { evaluateBadugi } from '../badugi';
import { sanitizeStateForPlayer } from '../state-sanitizer';
import { isAutoRunoutEligible } from '../run-it-twice-manager';
import { holeCardCount, wildAllowedFor } from '../variant-rules';
import { formatHandResult } from '../../utils/hand-result-formatter';
import type { Card, Player, PlayerAction } from '../../../types/poker';

const c = (s: string): Card => {
  const suit = ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[s.slice(-1) as 'h' | 'd' | 'c' | 's'];
  return { rank: s.slice(0, -1) as Card['rank'], suit };
};
const cards = (s: string) => s.split(' ').map(c);
const show = (list: Card[] | undefined) => (list || []).map(x => `${x.rank}${x.suit[0]}`);

const P = (id: string, pos: number, stack = 100): Player => ({
  id, name: id, position: pos, stack, currentBet: 0,
  hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

// Heads-up the button (b) posts the small blind; a is dealt first, then the draws come from the rest
const stackDeck = (a: string, b: string, rest: string) => {
  const [ha, hb] = [cards(a), cards(b)];
  const order: Card[] = [];
  for (let r = 0; r < 4; r++) order.push(ha[r], hb[r]);
  const deck = [...order, ...cards(rest)].reverse();
  jest.spyOn(DeckManager.prototype, 'resetDeck').mockImplementation(function (this: any) {
    this.deck = [...deck];
  });
};

const badugi = (players: Player[] = [P('a', 1), P('b', 2)]) =>
  new PokerEngine('t', players, 1, 2, { variant: 'badugi', bettingMode: 'fixed-limit' });

const act = (engine: PokerEngine, type: PlayerAction['type'], extra: Partial<PlayerAction> = {}) =>
  engine.handleAction({ type, playerId: engine.getState().activePlayer, tableId: 't', timestamp: Date.now(), ...extra });

const player = (engine: PokerEngine, id: string) => engine.getState().players.find(p => p.id === id)!;

// a: the best badugi. b: king-queen-jack, a three-card hand.
const A = 'As 2d 3h 4c';
const B = 'Ks Kd Qs Jh';
const REST = '9c 8c 7c 6c 5c 10c Jc Qc';

afterEach(() => jest.restoreAllMocks());

describe('Badugi hands', () => {
  test('more cards beat fewer; then the lowest wins, aces low', () => {
    expect(evaluateBadugi(cards('As 2d 3h 4c')).description).toBe('Badugi 4-3-2-A');
    expect(evaluateBadugi(cards('Ks Kd Qs Jh')).description).toBe('3-card K-Q-J');
    expect(evaluateBadugi(cards('2c 3c 4c 5c')).description).toBe('1-card 2');
    const score = (s: string) => evaluateBadugi(cards(s)).score;
    expect(score('As 2d 3h 4c')).toBeGreaterThan(score('As 2d 3h 5c'));
    expect(score('Ks Qd Jh 10c')).toBeGreaterThan(score('As 2d 3h 3c'));
    expect(score('8s 4d 3h')).toBeGreaterThan(score('8s 5d 2h'));
  });
});

describe('Badugi', () => {
  test('four cards each, blinds, no wild cards', () => {
    expect(holeCardCount('badugi')).toBe(4);
    expect(wildAllowedFor('badugi', 2)).toBe(false);
    stackDeck(A, B, REST);
    const engine = badugi();
    engine.startNewHand();
    const s = engine.getState();
    expect(show(player(engine, 'a').holeCards)).toEqual(['As', '2d', '3h', '4c']);
    expect(s.handActions?.map(x => x.action)).toEqual(['small-blind', 'big-blind']);
    expect(s.stage).toBe('preflop');
  });

  test('three draws, each followed by betting, then the showdown', () => {
    stackDeck(A, B, REST);
    const engine = badugi();
    engine.startNewHand();
    act(engine, 'call');
    act(engine, 'check');
    for (const stage of ['flop', 'turn', 'river']) {
      let s = engine.getState();
      expect(s.stage).toBe(stage);
      expect(s.drawState?.pending).toEqual(['a', 'b']);
      act(engine, 'draw', { discards: [] });
      // b throws away all four cards each time
      act(engine, 'draw', { discards: [0, 1, 2, 3] });
      s = engine.getState();
      expect(s.drawState?.pending).toEqual([]);
      expect(s.currentBet).toBe(0);
      act(engine, 'check');
      act(engine, 'check');
    }
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.handResult?.winnings).toEqual({ a: 4 });
    expect(s.handActions?.filter(x => x.action === 'draw').map(x => x.stage)).toEqual(['flop', 'flop', 'turn', 'turn', 'river', 'river']);
    expect(formatHandResult(s)?.message).toMatch(/a wins with Badugi 4-3-2-A/);
  });

  test('the big bet applies after the second draw, as in triple draw', () => {
    stackDeck(A, B, REST);
    const engine = badugi();
    engine.startNewHand();
    act(engine, 'call');
    act(engine, 'check');
    act(engine, 'draw', { discards: [] });
    act(engine, 'draw', { discards: [] });
    act(engine, 'bet');
    expect(engine.getState().currentBet).toBe(2);
    act(engine, 'call');
    act(engine, 'draw', { discards: [] });
    act(engine, 'draw', { discards: [] });
    act(engine, 'bet');
    expect(engine.getState().currentBet).toBe(4);
  });

  test('all-in players still draw three times, and hands stay hidden until the showdown', () => {
    stackDeck(A, B, REST);
    const engine = badugi([P('a', 1, 2), P('b', 2, 1)]);
    engine.startNewHand();
    let s = engine.getState();
    expect(s.stage).toBe('flop');
    expect(s.drawState?.pending).toEqual(['a', 'b']);
    expect(isAutoRunoutEligible(s)).toBe(false);
    expect(sanitizeStateForPlayer(s, 'a').players.find(p => p.id === 'b')?.holeCards).toBeUndefined();
    for (let i = 0; i < 6; i++) act(engine, 'draw', { discards: [] });
    s = engine.getState();
    expect(s.stage).toBe('showdown');
  });

  test('a timeout in the draw stands pat', () => {
    stackDeck(A, B, REST);
    const engine = badugi();
    engine.startNewHand();
    act(engine, 'call');
    act(engine, 'check');
    expect(engine.handleTimeout(Date.now() + 1e9).action).toBe('draw');
    expect(show(player(engine, 'a').holeCards)).toEqual(['As', '2d', '3h', '4c']);
  });
});
