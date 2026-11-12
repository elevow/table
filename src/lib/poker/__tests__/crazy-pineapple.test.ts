import { DeckManager } from '../deck-manager';
import { PokerEngine } from '../poker-engine';
import { isAutoRunoutEligible } from '../run-it-twice-manager';
import { holeCardCount, pineappleDiscardStage } from '../variant-rules';
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

// Heads-up the button (b) posts the small blind; a is dealt first, one card at a time, then the board
const stackDeck = (a: string, b: string, board: string) => {
  const [ha, hb] = [cards(a), cards(b)];
  const order: Card[] = [];
  for (let r = 0; r < 3; r++) order.push(ha[r], hb[r]);
  const deck = [...order, ...cards(board)].reverse();
  jest.spyOn(DeckManager.prototype, 'resetDeck').mockImplementation(function (this: any) {
    this.deck = [...deck];
  });
};

const crazy = () => new PokerEngine('t', [P('a', 1), P('b', 2)], 1, 2, { variant: 'crazy-pineapple', bettingMode: 'no-limit' });

const act = (engine: PokerEngine, type: PlayerAction['type'], extra: Partial<PlayerAction> = {}, playerId = engine.getState().activePlayer) =>
  engine.handleAction({ type, playerId, tableId: 't', timestamp: Date.now(), ...extra });

const hand = (engine: PokerEngine, id: string) => show(engine.getState().players.find(p => p.id === id)?.holeCards);

const A = 'As Kd 2c';
const B = 'Qh Qs 3c';
const BOARD = '9h 8d 7c Jd 4s';

afterEach(() => jest.restoreAllMocks());

describe('Crazy Pineapple', () => {
  test('keeps three cards through the flop betting, then everyone discards before the turn', () => {
    expect(holeCardCount('crazy-pineapple')).toBe(3);
    expect(pineappleDiscardStage('crazy-pineapple')).toBe('flop');
    stackDeck(A, B, BOARD);
    const engine = crazy();
    engine.startNewHand();
    act(engine, 'call');
    act(engine, 'check');
    let s = engine.getState();
    expect(s.stage).toBe('flop');
    expect(s.discardState).toBeUndefined();
    expect(hand(engine, 'a')).toHaveLength(3);
    act(engine, 'check');
    act(engine, 'check');
    s = engine.getState();
    expect(s.discardState?.pending).toEqual(['a', 'b']);
    expect(s.communityCards).toHaveLength(3);
    act(engine, 'discard', { discards: [2] }, 'b');
    act(engine, 'discard', { discards: [2] }, 'a');
    s = engine.getState();
    expect(s.stage).toBe('turn');
    expect(show(s.communityCards)).toEqual(['9h', '8d', '7c', 'Jd']);
    expect(hand(engine, 'a')).toEqual(['As', 'Kd']);
  });

  test('all-in before the flop: the flop comes, then the discard, before the board runs out', () => {
    stackDeck(A, B, BOARD);
    const engine = crazy();
    engine.startNewHand();
    act(engine, 'raise', { amount: 100 });
    act(engine, 'call');
    let s = engine.getState();
    expect(s.communityCards).toHaveLength(3);
    expect(s.discardState?.pending).toEqual(['a', 'b']);
    expect(isAutoRunoutEligible(s)).toBe(false);
    expect(engine.handleTimeout(Date.now() + 1e9).action).toBe('discard');
    s = engine.getState();
    expect(s.communityCards).toHaveLength(4);
    expect(isAutoRunoutEligible(s)).toBe(true);
  });

  test('blinds that put everyone all-in deal the flop and then wait for the discard', () => {
    stackDeck(A, B, BOARD);
    const engine = new PokerEngine('t', [P('a', 1, 2), P('b', 2, 1)], 1, 2, { variant: 'crazy-pineapple', bettingMode: 'no-limit' });
    engine.startNewHand();
    const s = engine.getState();
    expect(s.stage).toBe('flop');
    expect(s.communityCards).toHaveLength(3);
    expect(s.discardState?.pending).toEqual(['a', 'b']);
  });
});
