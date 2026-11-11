import { DeckManager } from '../deck-manager';
import { PokerEngine } from '../poker-engine';
import { maxPlayersForGame, parseMixedGames, parseWildRule, supportsWildRule, variantAllowedFor, wildAllowedFor } from '../variant-rules';
import { wildMatcher } from '../wild-hands';
import { resolveVariantAndMode } from '../../game/variant-mapping';
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

// The next shuffle deals these cards in this order (the deck deals from its end)
const stackDeck = (order: string) => {
  const deck = cards(order).reverse();
  jest.spyOn(DeckManager.prototype, 'resetDeck').mockImplementation(function (this: any) {
    this.deck = [...deck];
  });
};

// Blinds 1/2, so each player antes 1
const baseball = (players: Player[] = [P('a', 1), P('b', 2)]) =>
  new PokerEngine('t', players, 1, 2, { variant: 'baseball', bettingMode: 'fixed-limit' });

const act = (engine: PokerEngine, type: PlayerAction['type'], playerId = engine.getState().activePlayer, amount?: number) =>
  engine.handleAction({ type, playerId, tableId: 't', timestamp: Date.now(), amount });

const player = (engine: PokerEngine, id: string) => engine.getState().players.find(p => p.id === id)!;

afterEach(() => jest.restoreAllMocks());

describe('Baseball', () => {
  test('3s and 9s are wild, and the game always plays them', () => {
    const wild = wildMatcher('baseball')!;
    expect(cards('3c 3h 9d 9s').every(wild)).toBe(true);
    expect(cards('2c 4h 8d Qs').some(wild)).toBe(false);
    const engine = baseball();
    expect(engine.getState().wildRule).toBe('baseball');
    engine.setWildRule(undefined);
    expect(engine.getState().wildRule).toBe('baseball');
    engine.setVariant('seven-card-stud');
    expect(engine.getState().wildRule).toBeUndefined();
  });

  test('table rules: 6 players, fixed limit, no wild option', () => {
    expect(maxPlayersForGame('baseball')).toBe(6);
    expect(variantAllowedFor('baseball', 6)).toBe(true);
    expect(variantAllowedFor('baseball', 7)).toBe(false);
    expect(supportsWildRule('baseball')).toBe(false);
    expect(wildAllowedFor('baseball', 2)).toBe(false);
    expect(parseWildRule('baseball')).toBeUndefined();
    expect(resolveVariantAndMode({ variant: 'baseball', bettingMode: 'no-limit' }).bettingMode).toBe('fixed-limit');
    expect(parseMixedGames([{ variant: 'baseball', bettingMode: 'pot-limit' }], () => 'no-limit')).toEqual([{ variant: 'baseball', bettingMode: 'fixed-limit' }]);
  });

  test('a face-up 4 deals the player an extra card face down', () => {
    // a: Kc 7h down, 4s up, then 2c as the extra card. b: Kd 8d down, 6c up.
    stackDeck('Kc Kd 7h 8d 4s 2c 6c');
    const engine = baseball();
    engine.startNewHand();
    const stud = engine.getState().studState!;
    expect(show(stud.playerCards.a.downCards)).toEqual(['Kc', '7h', '2c']);
    expect(show(stud.playerCards.a.upCards)).toEqual(['4s']);
    expect(show(stud.playerCards.b.upCards)).toEqual(['6c']);
    expect(stud.potMatch).toBeUndefined();
  });

  describe('a face-up 3', () => {
    // a is dealt the 3s face up on third street
    const THIRD = 'Kc Kd 7h 8d 3s 6c';

    test('waits for that player to match the pot or fold before the bring-in', () => {
      stackDeck(THIRD);
      const engine = baseball();
      engine.startNewHand();
      const s = engine.getState();
      expect(s.stage).toBe('third');
      expect(s.activePlayer).toBe('a');
      expect(s.studState?.potMatch?.queue).toEqual(['a']);
      expect(s.studState?.bringIn).toBeUndefined();
      expect(() => act(engine, 'check', 'b')).toThrow(/not player's turn/);
      expect(() => act(engine, 'check', 'a')).toThrow(/Match the pot or fold/);
    });

    test('matching pays the size of the pot, then the bring-in starts the betting', () => {
      stackDeck(THIRD);
      const engine = baseball();
      engine.startNewHand();
      act(engine, 'match-pot');
      const s = engine.getState();
      expect(s.pot).toBe(4);
      expect(player(engine, 'a').stack).toBe(97);
      expect(s.studState?.potMatch).toBeUndefined();
      expect(s.studState?.potMatched).toEqual({ a: 2 });
      // a's 3 is still the lowest up card, so a brings it in
      expect(s.studState?.bringIn).toMatchObject({ player: 'a', pending: true });
      expect(s.activePlayer).toBe('a');
      expect(s.handActions?.map(x => x.action)).toEqual(['ante', 'ante', 'match-pot']);
    });

    test('folding hands the pot to the last player in', () => {
      stackDeck(THIRD);
      const engine = baseball();
      engine.startNewHand();
      act(engine, 'fold');
      expect(engine.getState().stage).toBe('showdown');
      expect(player(engine, 'b').stack).toBe(101);
    });

    test('running out of time folds', () => {
      stackDeck(THIRD);
      const engine = baseball();
      engine.startNewHand();
      expect(engine.handleTimeout(Date.now() + 1e9).action).toBe('fold');
      expect(player(engine, 'a').isFolded).toBe(true);
    });

    test('is asked on later streets too, after that street is dealt', () => {
      // Third street: a 5s, b 6c up, so a brings in. Fourth street: a 3h, b 2d.
      stackDeck('Kc Kd 7h 8d 5s 6c 3h 2d');
      const engine = baseball();
      engine.startNewHand();
      act(engine, 'bring-in');
      act(engine, 'call');
      const s = engine.getState();
      expect(s.stage).toBe('fourth');
      expect(s.studState?.potMatch).toEqual({ queue: ['a'], stage: 'fourth' });
      const pot = s.pot;
      act(engine, 'match-pot');
      expect(engine.getState().pot).toBe(pot * 2);
      expect(engine.getState().studState?.potMatch).toBeUndefined();
    });

    test('matched chips are dead money: a short stack can win them but not side bets', () => {
      // a has 3 chips: after the ante, matching the 3-chip pot puts a all-in for 2 more.
      // a: As Ad down, 3h up (wild), Ac on fourth makes five aces. b and c bet on in a side pot.
      stackDeck([
        'As Kc Qc', 'Ad Kd Qd', '3h 2s 8s', // third street; b's deuce brings it in
        'Ac 7s 2d', '5c 6s 6h', '7c 8c 10s', // fourth to sixth
        'Jc Jd Jh', // seventh
      ].join(' '));
      const engine = baseball([P('a', 1, 3), P('b', 2), P('c', 3)]);
      engine.startNewHand();
      act(engine, 'match-pot');
      expect(player(engine, 'a')).toMatchObject({ stack: 0, isAllIn: true });
      for (let i = 0; i < 40 && engine.getState().stage !== 'showdown'; i++) {
        const s = engine.getState();
        if (!s.activePlayer) { engine.runStudAllInStreet(); continue; }
        const me = player(engine, s.activePlayer);
        if (s.studState?.bringIn?.pending) act(engine, 'bring-in');
        else if (s.currentBet > me.currentBet) act(engine, 'call');
        else if (s.stage === 'fourth' && s.currentBet === 0) act(engine, 'bet', s.activePlayer, 2);
        else act(engine, 'check');
      }
      expect(engine.getState().stage).toBe('showdown');
      // Main pot: three antes plus a's 2 matched chips. b and c's bets beyond the ante are a side pot.
      expect(player(engine, 'a').stack).toBe(5);
      const total = ['a', 'b', 'c'].reduce((sum, id) => sum + player(engine, id).stack, 0);
      expect(total).toBe(203);
    });
  });

  test('the pause survives saving and restoring the game', () => {
    stackDeck('Kc Kd 7h 8d 3s 6c');
    const engine = baseball();
    engine.startNewHand();
    const restored = PokerEngine.fromSerialized(engine.serialize() as any);
    act(restored, 'match-pot', 'a');
    expect(restored.getState().pot).toBe(4);
  });
});
