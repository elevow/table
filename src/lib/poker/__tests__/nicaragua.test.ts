import { DeckManager } from '../deck-manager';
import { PokerEngine } from '../poker-engine';
import { describeNicaraguaHand, nicaraguaCount, nicaraguaScore } from '../nicaragua';
import { isDrawVariant, maxPlayersForGame, parseMixedGames, wildAllowedFor } from '../variant-rules';
import type { Card, Player, PlayerAction } from '../../../types/poker';

const c = (s: string): Card => {
  const suit = ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[s.slice(-1) as 'h' | 'd' | 'c' | 's'];
  return { rank: s.slice(0, -1) as Card['rank'], suit };
};
const cards = (s: string) => s.split(' ').map(c);

const P = (id: string, pos: number, stack = 100): Player => ({
  id, name: id, position: pos, stack, currentBet: 0,
  hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

// Each hand of the game deals these two hands, a first (b has the button)
const stackDecks = (...hands: Array<[string, string]>) => {
  const decks = hands.map(([a, b]) => {
    const [ha, hb] = [cards(a), cards(b)];
    const order: Card[] = [];
    for (let r = 0; r < 5; r++) order.push(ha[r], hb[r]);
    return [...order, ...cards('Kc Ks Js 10s 9s 8s')].reverse();
  });
  let n = 0;
  jest.spyOn(DeckManager.prototype, 'resetDeck').mockImplementation(function (this: any) {
    this.deck = [...decks[Math.min(n++, decks.length - 1)]];
  });
};

// Blinds 1/2: each player antes 1 and a bet before the draw is 2
const nicaragua = () => new PokerEngine('t', [P('a', 1), P('b', 2)], 1, 2, { variant: 'nicaragua', bettingMode: 'fixed-limit' });

const act = (engine: PokerEngine, type: PlayerAction['type'], extra: Partial<PlayerAction> = {}, playerId = engine.getState().activePlayer) =>
  engine.handleAction({ type, playerId, tableId: 't', timestamp: Date.now(), ...extra });

const player = (engine: PokerEngine, id: string) => engine.getState().players.find(p => p.id === id)!;

// a opens, b calls, both stand pat, both check: the showdown
const playOpened = (engine: PokerEngine, method: PlayerAction['method']) => {
  act(engine, 'bet', { method });
  act(engine, 'call');
  act(engine, 'draw', { discards: [] });
  act(engine, 'draw', { discards: [] });
  act(engine, 'check');
  act(engine, 'check');
};

// High cards and low cards: which wins depends on the method
const HIGH = 'Ah Kd Qc Jd 9s';
const LOW = '2h 3d 4c 6d 7s';

afterEach(() => jest.restoreAllMocks());

describe('Nicaragua scoring', () => {
  test('counts: picture cards are 10, aces 11 for the highest count and 1 for the lowest', () => {
    expect(nicaraguaCount(cards('Ah Kd Qc 2d 3s'), 'high-count')).toBe(36);
    expect(nicaraguaCount(cards('Ah Kd Qc 2d 3s'), 'low-count')).toBe(26);
    expect(nicaraguaScore(cards(LOW), 'low-count')).toBeGreaterThan(nicaraguaScore(cards(HIGH), 'low-count'));
    expect(nicaraguaScore(cards(HIGH), 'high-count')).toBeGreaterThan(nicaraguaScore(cards(LOW), 'high-count'));
    expect(describeNicaraguaHand(cards(LOW), 'low-count')).toBe('Count of 22');
  });

  test('the lowest hand is ace-to-five: aces low, straights and flushes ignored', () => {
    const wheel = cards('Ah 2h 3h 4h 5h');
    expect(nicaraguaScore(wheel, 'low')).toBeGreaterThan(nicaraguaScore(cards(LOW), 'low'));
    expect(nicaraguaScore(cards(HIGH), 'high')).toBeGreaterThan(nicaraguaScore(cards(LOW), 'high'));
  });
});

describe('Nicaragua', () => {
  test("is a Dealer's Choice draw game for up to 7, without wild cards or a place in mixed games", () => {
    expect(isDrawVariant('nicaragua')).toBe(true);
    expect(maxPlayersForGame('nicaragua')).toBe(7);
    expect(wildAllowedFor('nicaragua', 2)).toBe(false);
    expect(parseMixedGames(['nicaragua', 'razz'], () => 'no-limit')).toEqual([{ variant: 'razz', bettingMode: 'no-limit' }]);
  });

  test('the opener must say how the hand is won', () => {
    stackDecks([HIGH, LOW]);
    const engine = nicaragua();
    engine.startNewHand();
    expect(() => act(engine, 'bet')).toThrow(/Choose how the hand is won/);
    act(engine, 'bet', { method: 'low-count' });
    expect(engine.getState().nicaragua).toMatchObject({ opener: 'a', method: 'low-count' });
    expect(engine.getState().handActions?.find(x => x.action === 'bet')?.method).toBe('low-count');
  });

  test('an opener who wins ends the game', () => {
    stackDecks([HIGH, LOW]);
    const engine = nicaragua();
    engine.startNewHand();
    playOpened(engine, 'high');
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(player(engine, 'a').stack).toBe(103);
    expect(s.nicaragua).toMatchObject({ over: true, carry: 0 });
  });

  test('an opener who loses pays the size of the pot into the next hand, dealt from the same button with no antes', () => {
    stackDecks([HIGH, LOW], [LOW, HIGH]);
    const engine = nicaragua();
    engine.startNewHand();
    const button = engine.getState().dealerPosition;
    // a opens for the lowest count with high cards, so b's low cards win the 6-chip pot
    playOpened(engine, 'low-count');
    let s = engine.getState();
    expect(s.handResult?.winnings).toEqual({ b: 6 });
    expect(s.nicaragua).toMatchObject({ carry: 6 });
    expect(s.nicaragua?.over).toBeFalsy();
    expect(player(engine, 'a').stack).toBe(91);
    expect(player(engine, 'b').stack).toBe(103);
    expect(s.handActions?.at(-1)).toMatchObject({ playerId: 'a', action: 'match-pot', put: 6 });

    engine.startNewHand();
    s = engine.getState();
    expect(s.dealerPosition).toBe(button);
    expect(s.pot).toBe(6);
    expect(s.handActions?.some(x => x.action === 'ante')).toBe(false);
    expect(s.nicaragua?.opener).toBeUndefined();
    // a opens again, this time for the lowest count with the low cards, and wins: game over
    playOpened(engine, 'low-count');
    s = engine.getState();
    expect(player(engine, 'a').stack).toBe(91 - 2 + 10);
    expect(s.nicaragua).toMatchObject({ over: true, carry: 0 });
    // Every chip is accounted for
    expect(player(engine, 'a').stack + player(engine, 'b').stack).toBe(200);
  });

  test('a hand nobody opens carries its pot into the next hand', () => {
    stackDecks([HIGH, LOW]);
    const engine = nicaragua();
    engine.startNewHand();
    act(engine, 'check');
    act(engine, 'check');
    let s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.handResult).toEqual({ pot: 2, winnings: {} });
    expect(s.nicaragua).toMatchObject({ carry: 2 });
    engine.startNewHand();
    s = engine.getState();
    expect(s.pot).toBe(2);
    expect(player(engine, 'a').stack).toBe(99);
  });

  test('when everyone folds to the opener, the opener wins and the game ends', () => {
    stackDecks([HIGH, LOW]);
    const engine = nicaragua();
    engine.startNewHand();
    act(engine, 'bet', { method: 'high' });
    act(engine, 'fold');
    expect(engine.getState().nicaragua).toMatchObject({ over: true });
    expect(player(engine, 'a').stack).toBe(101);
  });

  test('an opener who folds has lost, and refills the pot', () => {
    stackDecks([HIGH, LOW]);
    const engine = nicaragua();
    engine.startNewHand();
    act(engine, 'bet', { method: 'high' });
    act(engine, 'raise');
    act(engine, 'fold');
    const s = engine.getState();
    expect(s.nicaragua?.over).toBeFalsy();
    expect(s.nicaragua?.carry).toBe(s.handResult?.pot);
  });
});
