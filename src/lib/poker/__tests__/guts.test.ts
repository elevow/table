import { DeckManager } from '../deck-manager';
import { PokerEngine } from '../poker-engine';
import { describeGutsHand, gutsScore } from '../guts';
import { sanitizeStateForPlayer } from '../state-sanitizer';
import { isDealersChoiceOnly, parseMixedGames, wildAllowedFor } from '../variant-rules';
import { formatHandResult } from '../../utils/hand-result-formatter';
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

// Each hand deals these two-card hands, a first (b has the button)
const stackDecks = (...hands: Array<[string, string]>) => {
  const decks = hands.map(([a, b]) => {
    const [ha, hb] = [cards(a), cards(b)];
    return [ha[0], hb[0], ha[1], hb[1], ...cards('2c 3c 4c 5c')].reverse();
  });
  let n = 0;
  jest.spyOn(DeckManager.prototype, 'resetDeck').mockImplementation(function (this: any) {
    this.deck = [...decks[Math.min(n++, decks.length - 1)]];
  });
};

// Blinds 1/2: each player antes 1; the cap is 10 big blinds (20) unless set
const guts = () => new PokerEngine('t', [P('a', 1), P('b', 2)], 1, 2, { variant: 'guts', bettingMode: 'no-limit' });

const declare = (engine: PokerEngine, playerId: string, type: PlayerAction['type']) =>
  engine.handleAction({ type, playerId, tableId: 't', timestamp: Date.now() });

const player = (engine: PokerEngine, id: string) => engine.getState().players.find(p => p.id === id)!;

const ACES = 'As Ad';
const KQ = 'Kc Qd';

afterEach(() => jest.restoreAllMocks());

describe('Guts hands', () => {
  test('a pair beats any high cards; then the higher card, aces high', () => {
    expect(gutsScore(cards('2c 2d'))).toBeGreaterThan(gutsScore(cards('Ac Kd')));
    expect(gutsScore(cards('Ac 2d'))).toBeGreaterThan(gutsScore(cards('Kc Qd')));
    expect(describeGutsHand(cards('Kc Kd'))).toBe('Pair of Kings');
    expect(describeGutsHand(cards('10c Ad'))).toBe('Ace-Ten');
  });

  test("is a Dealer's Choice game with no wild cards and no place in mixed games", () => {
    expect(isDealersChoiceOnly('guts')).toBe(true);
    expect(wildAllowedFor('guts', 2)).toBe(false);
    expect(parseMixedGames(['guts', 'razz'], () => 'no-limit')).toEqual([{ variant: 'razz', bettingMode: 'no-limit' }]);
  });
});

describe('Guts', () => {
  test('deals two cards each after an ante, and everyone declares at once, in secret', () => {
    stackDecks([ACES, KQ]);
    const engine = guts();
    engine.startNewHand();
    let s = engine.getState();
    expect(s.pot).toBe(2);
    expect(s.players[0].holeCards).toHaveLength(2);
    expect(s.guts?.pending).toEqual(['a', 'b']);
    // b declares first although the clock shows on a
    declare(engine, 'b', 'in');
    s = engine.getState();
    expect(sanitizeStateForPlayer(s, 'a').guts?.declared).toEqual({});
    expect(sanitizeStateForPlayer(s, 'b').guts?.declared).toEqual({ b: 'in' });
    expect(s.handActions?.some(x => x.action === 'in')).toBe(false);
    expect(() => declare(engine, 'b', 'out')).toThrow(/already declared/);
    expect(() => declare(engine, 'a', 'check')).toThrow(/Go in or stay out/);
  });

  test('one player in alone takes the pot and ends the game', () => {
    stackDecks([KQ, ACES]);
    const engine = guts();
    engine.startNewHand();
    declare(engine, 'a', 'in');
    declare(engine, 'b', 'out');
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(player(engine, 'a').stack).toBe(101);
    expect(s.guts).toMatchObject({ over: true, carry: 0 });
    expect(formatHandResult(s)?.message).toMatch(/a went in alone and wins the pot \| Guts is over/);
  });

  test('when several go in, the best hand wins and each loser pays the pot into the next hand', () => {
    stackDecks([ACES, KQ], [KQ, ACES]);
    const engine = guts();
    engine.startNewHand();
    const button = engine.getState().dealerPosition;
    declare(engine, 'a', 'in');
    declare(engine, 'b', 'in');
    let s = engine.getState();
    expect(s.handResult?.winnings).toEqual({ a: 2 });
    expect(s.guts).toMatchObject({ carry: 2, ins: ['a', 'b'] });
    expect(s.guts?.over).toBeFalsy();
    expect(player(engine, 'b').stack).toBe(97);
    expect(formatHandResult(s)?.message).toMatch(/a wins with Pair of Aces \| b pays \$2 into the next pot/);
    // Next hand: same button, no antes, played for the 2 carried
    engine.startNewHand();
    s = engine.getState();
    expect(s.dealerPosition).toBe(button);
    expect(s.pot).toBe(2);
    expect(player(engine, 'a').stack).toBe(101);
    declare(engine, 'a', 'out');
    declare(engine, 'b', 'in');
    expect(engine.getState().guts?.over).toBe(true);
    expect(player(engine, 'a').stack + player(engine, 'b').stack).toBe(200);
  });

  test('a loser pays no more than the cap', () => {
    stackDecks([ACES, KQ]);
    const engine = guts();
    engine.setGutsCap(0.5 + 0.5);
    engine.startNewHand();
    declare(engine, 'a', 'in');
    declare(engine, 'b', 'in');
    // The pot was 2; the cap is 1 big blind (2)
    expect(engine.getState().guts?.carry).toBe(2);
    expect(() => engine.setGutsCap(0)).toThrow(/1-1000/);
  });

  test('nobody in carries the pot to the next hand', () => {
    stackDecks([ACES, KQ]);
    const engine = guts();
    engine.startNewHand();
    declare(engine, 'a', 'out');
    declare(engine, 'b', 'out');
    let s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.handResult).toEqual({ pot: 2, winnings: {} });
    expect(s.guts).toMatchObject({ carry: 2 });
    engine.startNewHand();
    s = engine.getState();
    expect(s.pot).toBe(2);
  });

  test('running out of time counts as out for everyone still deciding', () => {
    stackDecks([ACES, KQ]);
    const engine = guts();
    engine.startNewHand();
    declare(engine, 'a', 'in');
    expect(engine.handleTimeout(Date.now() + 1e9).action).toBe('out');
    const s = engine.getState();
    expect(s.guts?.over).toBe(true);
    expect(player(engine, 'a').stack).toBe(101);
  });
});
