import { DeckManager } from '../deck-manager';
import { PokerEngine } from '../poker-engine';
import { sanitizeStateForPlayer } from '../state-sanitizer';
import { isAutoRunoutEligible } from '../run-it-twice-manager';
import { maxPlayersForGame } from '../variant-rules';
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

// Seven cards each, dealt one at a time in seat order (a, then b)
const stackDeck = (a: string, b: string) => {
  const [ha, hb] = [cards(a), cards(b)];
  const order: Card[] = [];
  for (let r = 0; r < 7; r++) order.push(ha[r], hb[r]);
  const deck = order.reverse();
  jest.spyOn(DeckManager.prototype, 'resetDeck').mockImplementation(function (this: any) {
    this.deck = [...deck];
  });
};

const trash = (players: Player[] = [P('a', 1), P('b', 2)]) =>
  new PokerEngine('t', players, 1, 2, { variant: 'pass-the-trash', bettingMode: 'fixed-limit' });

const act = (engine: PokerEngine, playerId: string, type: PlayerAction['type'], discards?: number[]) =>
  engine.handleAction({ type, playerId, tableId: 't', timestamp: Date.now(), discards });

const down = (engine: PokerEngine, id: string) => show(engine.getState().studState?.playerCards[id]?.downCards);
const up = (engine: PokerEngine, id: string) => show(engine.getState().studState?.playerCards[id]?.upCards);

// Both check the betting round in progress
const checkRound = (engine: PokerEngine) => {
  act(engine, engine.getState().activePlayer, 'check');
  act(engine, engine.getState().activePlayer, 'check');
};

// a: four aces among junk. b: kings.
const A = 'As Ad Ac Ah 2c 3d 4h';
const B = 'Ks Kd Kc 9h 8c 7d 6h';

afterEach(() => jest.restoreAllMocks());

describe('Pass the Trash', () => {
  test('seats seven, deals seven down after the antes, then everyone passes three at once', () => {
    expect(maxPlayersForGame('pass-the-trash')).toBe(7);
    stackDeck(A, B);
    const engine = trash();
    engine.startNewHand();
    const s = engine.getState();
    expect(s.pot).toBe(2);
    expect(down(engine, 'a')).toHaveLength(7);
    expect(s.trash?.pending).toEqual(['a', 'b']);
    expect(isAutoRunoutEligible(s)).toBe(false);
    expect(() => act(engine, 'a', 'pass', [0, 1])).toThrow(/Pass exactly 3 cards/);
  });

  test('passes go to the left once everyone has chosen, and each choice stays secret until then', () => {
    stackDeck(A, B);
    const engine = trash();
    engine.startNewHand();
    act(engine, 'b', 'pass', [4, 5, 6]);
    expect(sanitizeStateForPlayer(engine.getState(), 'a').trash?.picks).toEqual({});
    expect(down(engine, 'a')).toHaveLength(7);
    act(engine, 'a', 'pass', [4, 5, 6]);
    // a passed 2c 3d 4h to b; b passed 8c 7d 6h to a
    expect(down(engine, 'a')).toEqual(['As', 'Ad', 'Ac', 'Ah', '8c', '7d', '6h']);
    expect(down(engine, 'b')).toEqual(['Ks', 'Kd', 'Kc', '9h', '2c', '3d', '4h']);
    expect(engine.getState().trash?.pending).toEqual([]);
    expect(engine.getState().activePlayer).toBe('a');
  });

  test('a whole hand: passes of 3, 2 and 1, keep five, then five cards turned up, betting after the first four', () => {
    stackDeck(A, B);
    const engine = trash();
    engine.startNewHand();
    for (const n of [3, 2, 1]) {
      const pick = Array.from({ length: n }, (_, i) => 6 - i);
      act(engine, 'a', 'pass', pick);
      act(engine, 'b', 'pass', pick);
      checkRound(engine);
    }
    // Keep five, in the order they will be turned up
    expect(() => act(engine, 'a', 'keep', [0, 1])).toThrow(/Keep exactly five/);
    act(engine, 'a', 'keep', [3, 2, 1, 0, 4]);
    act(engine, 'b', 'keep', [0, 1, 2, 3, 4]);
    // The first kept card is turned up straight away
    expect(up(engine, 'a')).toEqual(['Ah']);
    expect(down(engine, 'a').slice(0, 3)).toEqual(['Ac', 'Ad', 'As']);
    for (let turn = 1; turn <= 4; turn++) {
      expect(up(engine, 'a')).toHaveLength(turn);
      checkRound(engine);
    }
    // The fifth card shows the whole hand: straight to the showdown, with no more betting
    const s = engine.getState();
    expect(up(engine, 'a')).toHaveLength(5);
    expect(s.stage).toBe('showdown');
    expect(s.handResult?.winnings).toEqual({ a: 2 });
    expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(200);
  });

  test('running out of time passes the lowest cards, and keeps the best five', () => {
    stackDeck(A, B);
    const engine = trash();
    engine.startNewHand();
    expect(engine.handleTimeout(Date.now() + 1e9).action).toBe('pass');
    expect(down(engine, 'a')).toEqual(['As', 'Ad', 'Ac', 'Ah', '8c', '7d', '6h']);
  });

  test('a player who folds during a pass is out, and the pass goes on without them', () => {
    const engine = trash([P('a', 1), P('b', 2), P('c', 3)]);
    engine.startNewHand();
    const s = engine.getState();
    const [first, second, third] = s.trash!.pending!;
    act(engine, first, 'fold');
    act(engine, second, 'pass', [0, 1, 2]);
    act(engine, third, 'pass', [0, 1, 2]);
    expect(engine.getState().trash?.pending).toEqual([]);
    expect(down(engine, second)).toHaveLength(7);
  });
});
