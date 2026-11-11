import { DeckManager } from '../deck-manager';
import { PokerEngine } from '../poker-engine';
import { sanitizeStateForPlayer } from '../state-sanitizer';
import { isAutoRunoutEligible } from '../run-it-twice-manager';
import { holeCardCount, maxPlayersForGame } from '../variant-rules';
import { formatHandResult } from '../../utils/hand-result-formatter';
import type { BettingMode, Card, Player, PlayerAction } from '../../../types/poker';

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

// Heads-up the button is b, so a is dealt first: the hands go round one card at a time, then the
// rest of the deck is drawn from in this order
const stackDeck = (a: string, b: string, rest: string) => {
  const [ha, hb] = [cards(a), cards(b)];
  const order: Card[] = [];
  for (let r = 0; r < 5; r++) order.push(ha[r], hb[r]);
  const deck = [...order, ...cards(rest)].reverse();
  jest.spyOn(DeckManager.prototype, 'resetDeck').mockImplementation(function (this: any) {
    this.deck = [...deck];
  });
};

// Blinds 1/2: each player antes 1, a bet is 2 before the draw and 4 after
const draw = (players: Player[] = [P('a', 1), P('b', 2)], bettingMode: BettingMode = 'fixed-limit') =>
  new PokerEngine('t', players, 1, 2, { variant: 'five-card-draw', bettingMode });

const act = (engine: PokerEngine, type: PlayerAction['type'], extra: Partial<PlayerAction> = {}, playerId = engine.getState().activePlayer) =>
  engine.handleAction({ type, playerId, tableId: 't', timestamp: Date.now(), ...extra });

const player = (engine: PokerEngine, id: string) => engine.getState().players.find(p => p.id === id)!;
const hand = (engine: PokerEngine, id: string) => show(player(engine, id).holeCards);

const A_HAND = 'Ah Kd 7c 4s 2h';
const B_HAND = 'Qs Qd 9c 6h 3d';
const REST = 'Ac As 8d 5c Jh 10s';

afterEach(() => jest.restoreAllMocks());

describe('Five-card draw', () => {
  test('deals five cards each, takes antes instead of blinds, and the first player after the button opens', () => {
    expect(holeCardCount('five-card-draw')).toBe(5);
    expect(maxPlayersForGame('five-card-draw')).toBe(7);
    stackDeck(A_HAND, B_HAND, REST);
    const engine = draw();
    engine.startNewHand();
    const s = engine.getState();
    expect(hand(engine, 'a')).toEqual(cards(A_HAND).map(x => `${x.rank}${x.suit[0]}`));
    expect(s.pot).toBe(2);
    expect(s.currentBet).toBe(0);
    expect(s.stage).toBe('preflop');
    expect(s.activePlayer).toBe('a');
    expect(s.handActions?.map(x => x.action)).toEqual(['ante', 'ante']);
  });

  test('after the first round everyone draws in turn, then the big bet applies', () => {
    stackDeck(A_HAND, B_HAND, REST);
    const engine = draw();
    engine.startNewHand();
    act(engine, 'check');
    act(engine, 'check');
    let s = engine.getState();
    expect(s.stage).toBe('draw');
    expect(s.drawState?.pending).toEqual(['a', 'b']);
    expect(s.activePlayer).toBe('a');
    expect(() => act(engine, 'check')).toThrow(/Choose cards to draw, or stand pat/);
    expect(() => act(engine, 'draw', {}, 'b')).toThrow(/not player's turn/);
    // a keeps the ace and king and draws three
    act(engine, 'draw', { discards: [2, 3, 4] });
    expect(hand(engine, 'a')).toEqual(['Ah', 'Kd', 'Ac', 'As', '8d']);
    // b stands pat
    act(engine, 'draw', { discards: [] });
    s = engine.getState();
    expect(s.drawState).toBeUndefined();
    expect(s.stage).toBe('draw');
    expect(s.activePlayer).toBe('a');
    act(engine, 'bet');
    expect(engine.getState().currentBet).toBe(4);
    act(engine, 'call');
    s = engine.getState();
    expect(s.stage).toBe('showdown');
    // Three aces beat queens
    expect(player(engine, 'a').stack).toBe(105);
    expect(s.handActions?.filter(x => x.action === 'draw').map(x => x.drawCount)).toEqual([3, 0]);
    expect(formatHandResult(s)?.message).toMatch(/a wins .*Three of a Kind/i);
  });

  test('a player draws at most 3, or 4 when the card they keep is an ace', () => {
    stackDeck(A_HAND, B_HAND, REST);
    const engine = draw();
    engine.startNewHand();
    act(engine, 'check');
    act(engine, 'check');
    expect(() => act(engine, 'draw', { discards: [0, 1, 2, 3, 4] })).toThrow(/up to 3 cards, or 4/);
    expect(() => act(engine, 'draw', { discards: [0, 2, 3, 4] })).toThrow(/up to 3 cards, or 4/);
    expect(() => act(engine, 'draw', { discards: [7] })).toThrow(/from your hand/);
    act(engine, 'draw', { discards: [1, 2, 3, 4] });
    expect(hand(engine, 'a')).toEqual(['Ah', 'Ac', 'As', '8d', '5c']);
  });

  test('running out of time in the draw stands pat', () => {
    stackDeck(A_HAND, B_HAND, REST);
    const engine = draw();
    engine.startNewHand();
    act(engine, 'check');
    act(engine, 'check');
    expect(engine.handleTimeout(Date.now() + 1e9).action).toBe('draw');
    expect(hand(engine, 'a')).toEqual(cards(A_HAND).map(x => `${x.rank}${x.suit[0]}`));
    expect(engine.getState().activePlayer).toBe('b');
  });

  test('a player all-in from the ante still draws, and the hand goes to the showdown with no more betting', () => {
    stackDeck(A_HAND, B_HAND, REST);
    const engine = draw([P('a', 1, 1), P('b', 2)]);
    engine.startNewHand();
    let s = engine.getState();
    expect(player(engine, 'a').isAllIn).toBe(true);
    expect(s.stage).toBe('draw');
    expect(s.activePlayer).toBe('a');
    // Hands stay hidden while the draw is still to come, and the pipeline doesn't run out a board
    expect(sanitizeStateForPlayer(s, 'b').players.find(p => p.id === 'a')?.holeCards).toBeUndefined();
    expect(isAutoRunoutEligible(s)).toBe(false);
    act(engine, 'draw', { discards: [2, 3, 4] });
    act(engine, 'draw', { discards: [] });
    s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(player(engine, 'a').stack).toBe(2);
  });

  test('the discards are never sent to players', () => {
    stackDeck(A_HAND, B_HAND, REST);
    const engine = draw();
    engine.startNewHand();
    act(engine, 'check');
    act(engine, 'check');
    act(engine, 'draw', { discards: [2, 3, 4] });
    expect(engine.getState().drawState?.muck).toHaveLength(3);
    expect(sanitizeStateForPlayer(engine.getState(), 'b').drawState).toEqual({ pending: ['b'] });
  });

  test('the discards are shuffled back in if the deck runs out', () => {
    // Seven players take 35 cards, leaving 17; six draws of 3 need 18
    const engine = draw(Array.from({ length: 7 }, (_, i) => P(`p${i}`, i + 1)), 'no-limit');
    engine.startNewHand();
    for (let i = 0; i < 7; i++) act(engine, 'check');
    expect(engine.getState().stage).toBe('draw');
    for (let i = 0; i < 7; i++) act(engine, 'draw', { discards: [0, 1, 2] });
    const held = engine.getState().players.flatMap(p => show(p.holeCards));
    expect(held).toHaveLength(35);
    expect(new Set(held).size).toBe(35);
    expect(engine.getState().stage).toBe('draw');
  });

  test('no Run It Twice at a draw table', () => {
    const engine = draw();
    engine.setAllowRunItTwice(true);
    expect(engine.getState().allowRunItTwice).toBe(false);
  });

  test('the draw survives saving and restoring the game', () => {
    stackDeck(A_HAND, B_HAND, REST);
    const engine = draw();
    engine.startNewHand();
    act(engine, 'check');
    act(engine, 'check');
    const restored = PokerEngine.fromSerialized(engine.serialize() as any);
    act(restored, 'draw', { discards: [2, 3, 4] }, 'a');
    expect(show(restored.getState().players[0].holeCards)).toEqual(['Ah', 'Kd', 'Ac', 'As', '8d']);
  });
});
