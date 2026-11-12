import { DeckManager } from '../deck-manager';
import { PokerEngine } from '../poker-engine';
import { sanitizeStateForPlayer } from '../state-sanitizer';
import { isAutoRunoutEligible } from '../run-it-twice-manager';
import { holeCardCount } from '../variant-rules';
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

const pineapple = (players: Player[] = [P('a', 1), P('b', 2)]) =>
  new PokerEngine('t', players, 1, 2, { variant: 'pineapple', bettingMode: 'no-limit' });

const act = (engine: PokerEngine, type: PlayerAction['type'], extra: Partial<PlayerAction> = {}, playerId = engine.getState().activePlayer) =>
  engine.handleAction({ type, playerId, tableId: 't', timestamp: Date.now(), ...extra });

const player = (engine: PokerEngine, id: string) => engine.getState().players.find(p => p.id === id)!;
const hand = (engine: PokerEngine, id: string) => show(player(engine, id).holeCards);

const A = 'As Kd 2c';
const B = 'Qh Qs 3c';
const BOARD = '9h 8d 7c Jd 4s';

// b (the button) calls preflop and a checks: the betting before the flop is over
const finishPreflop = (engine: PokerEngine) => {
  act(engine, 'call');
  act(engine, 'check');
};

afterEach(() => jest.restoreAllMocks());

describe('Pineapple', () => {
  test('deals three hole cards and bets on them before the flop', () => {
    expect(holeCardCount('pineapple')).toBe(3);
    stackDeck(A, B, BOARD);
    const engine = pineapple();
    engine.startNewHand();
    expect(hand(engine, 'a')).toEqual(['As', 'Kd', '2c']);
    expect(engine.getState().stage).toBe('preflop');
    expect(engine.getState().discardState).toBeUndefined();
  });

  test('after the preflop betting everyone throws a card away, in any order, before the flop', () => {
    stackDeck(A, B, BOARD);
    const engine = pineapple();
    engine.startNewHand();
    finishPreflop(engine);
    let s = engine.getState();
    expect(s.discardState?.pending).toEqual(['a', 'b']);
    expect(s.communityCards).toHaveLength(0);
    expect(() => act(engine, 'check', {}, 'a')).toThrow(/Choose a card to throw away/);
    expect(() => act(engine, 'discard', { discards: [5] }, 'a')).toThrow(/from your hand/);
    // b goes first although the clock shows on a
    act(engine, 'discard', { discards: [2] }, 'b');
    expect(() => act(engine, 'discard', { discards: [0] }, 'b')).toThrow(/already discarded/);
    expect(hand(engine, 'b')).toEqual(['Qh', 'Qs']);
    expect(engine.getState().communityCards).toHaveLength(0);
    act(engine, 'discard', { discards: [2] }, 'a');
    s = engine.getState();
    expect(hand(engine, 'a')).toEqual(['As', 'Kd']);
    expect(s.discardState).toBeUndefined();
    expect(s.stage).toBe('flop');
    expect(show(s.communityCards)).toEqual(['9h', '8d', '7c']);
    expect(s.handActions?.filter(x => x.action === 'discard').map(x => x.playerId)).toEqual(['b', 'a']);
  });

  test('the discard has one clock for everyone: a discard does not restart it', () => {
    stackDeck(A, B, BOARD);
    const engine = pineapple();
    engine.startNewHand();
    finishPreflop(engine);
    const deadline = engine.getState().turnDeadline;
    act(engine, 'discard', { discards: [2] }, 'a');
    expect(engine.getState().turnDeadline).toBe(deadline);
    expect(engine.getState().activePlayer).toBe('b');
  });

  test('when the clock runs out, everyone still choosing throws away their lowest card', () => {
    stackDeck(A, B, BOARD);
    const engine = pineapple();
    engine.startNewHand();
    finishPreflop(engine);
    expect(engine.handleTimeout(Date.now() + 1e9).action).toBe('discard');
    expect(hand(engine, 'a')).toEqual(['As', 'Kd']);
    expect(hand(engine, 'b')).toEqual(['Qh', 'Qs']);
    expect(engine.getState().stage).toBe('flop');
    expect(engine.getState().handActions?.filter(x => x.action === 'discard').every(x => x.auto)).toBe(true);
  });

  test('all-in before the flop: the discard still comes first, with the cards kept hidden', () => {
    stackDeck(A, B, BOARD);
    const engine = pineapple();
    engine.startNewHand();
    act(engine, 'raise', { amount: 100 });
    act(engine, 'call');
    let s = engine.getState();
    expect(s.discardState?.pending).toEqual(['a', 'b']);
    expect(isAutoRunoutEligible(s)).toBe(false);
    expect(sanitizeStateForPlayer(s, 'a').players.find(p => p.id === 'b')?.holeCards).toBeUndefined();
    act(engine, 'discard', { discards: [2] }, 'a');
    act(engine, 'discard', { discards: [2] }, 'b');
    s = engine.getState();
    expect(s.communityCards).toHaveLength(3);
    // Now the board runs out as in Hold'em
    expect(isAutoRunoutEligible(s)).toBe(true);
  });

  test('blinds that put everyone all-in still get the discard before any board card', () => {
    stackDeck(A, B, BOARD);
    const engine = pineapple([P('a', 1, 2), P('b', 2, 1)]);
    engine.startNewHand();
    const s = engine.getState();
    expect(s.discardState?.pending).toEqual(['a', 'b']);
    expect(s.communityCards).toHaveLength(0);
  });

  test('the discard survives saving and restoring the game', () => {
    stackDeck(A, B, BOARD);
    const engine = pineapple();
    engine.startNewHand();
    finishPreflop(engine);
    const restored = PokerEngine.fromSerialized(engine.serialize() as any);
    act(restored, 'discard', { discards: [0] }, 'b');
    expect(show(restored.getState().players.find(p => p.id === 'b')?.holeCards)).toEqual(['Qs', '3c']);
  });
});
