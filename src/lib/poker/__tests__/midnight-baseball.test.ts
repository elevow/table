import { DeckManager } from '../deck-manager';
import { PokerEngine } from '../poker-engine';
import { sanitizeStateForBroadcast, sanitizeStateForPlayer } from '../state-sanitizer';
import { maxPlayersForGame, parseWildRule, supportsWildRule, variantAllowedFor } from '../variant-rules';
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

// Seven rounds of one card each, dealt in seat order; each hand is listed in the order it is turned
const stackDeck = (...hands: string[]) => {
  const split = hands.map(cards);
  const order: Card[] = [];
  for (let r = 0; r < 7; r++) split.forEach(h => order.push(h[r]));
  const deck = [...order, ...cards('Ks Qs Js 10s 8s 6s')].reverse();
  jest.spyOn(DeckManager.prototype, 'resetDeck').mockImplementation(function (this: any) {
    this.deck = [...deck];
  });
};

// Blinds 1/2, so each player antes 1 and a bet is 2. The button moves to the second seat for the
// first hand, so the third seat (or, heads-up, the first) turns first.
const midnight = (players: Player[] = [P('a', 1), P('b', 2)]) =>
  new PokerEngine('t', players, 1, 2, { variant: 'midnight-baseball', bettingMode: 'fixed-limit' });

const act = (engine: PokerEngine, type: PlayerAction['type'], playerId = engine.getState().activePlayer, amount?: number) =>
  engine.handleAction({ type, playerId, tableId: 't', timestamp: Date.now(), amount });

const player = (engine: PokerEngine, id: string) => engine.getState().players.find(p => p.id === id)!;
const up = (engine: PokerEngine, id: string) => show(engine.getState().studState?.playerCards[id]?.upCards);

afterEach(() => jest.restoreAllMocks());

describe('Midnight Baseball', () => {
  test('table rules: 3s and 9s wild, 6 players, fixed limit, no wild option', () => {
    expect(midnight().getState().wildRule).toBe('baseball');
    expect(maxPlayersForGame('midnight-baseball')).toBe(6);
    expect(variantAllowedFor('midnight-baseball', 7)).toBe(false);
    expect(supportsWildRule('midnight-baseball')).toBe(false);
    expect(parseWildRule('midnight-baseball')).toBeUndefined();
    expect(resolveVariantAndMode({ variant: 'midnight-baseball', bettingMode: 'no-limit' }).bettingMode).toBe('fixed-limit');
  });

  test('everything is dealt face down; the first player turns a card and leads the betting', () => {
    stackDeck('Kc 2h 5d 6d 7s 8c Jh', 'Qc Ac 2c 5h 6h 7h 10s');
    const engine = midnight();
    engine.startNewHand();
    const s = engine.getState();
    expect(up(engine, 'a')).toEqual(['Kc']);
    expect(up(engine, 'b')).toEqual([]);
    expect(s.studState?.playerCards.b.downCards).toHaveLength(7);
    expect(s.studState?.midnight).toMatchObject({ holder: 'a', turn: 'b' });
    expect(s.activePlayer).toBe('a');
    expect(s.currentBet).toBe(0);
    expect(s.studState?.bringIn).toBeUndefined();
  });

  test('nobody sees a face-down card, not even their own, until the showdown', () => {
    stackDeck('Kc 2h 5d 6d 7s 8c Jh', 'Qc Ac 2c 5h 6h 7h 10s');
    const engine = midnight();
    engine.startNewHand();
    const mine = sanitizeStateForPlayer(engine.getState(), 'a').studState!.playerCards.a;
    expect(mine.downCards).toEqual([]);
    expect(mine.downCount).toBe(6);
    expect(show(mine.upCards)).toEqual(['Kc']);
    expect(sanitizeStateForBroadcast(engine.getState()).studState!.playerCards.b.downCount).toBe(7);
  });

  test('each player turns cards until they beat the high hand; turning them all without beating it is out', () => {
    stackDeck('Kc 2h 5d 6d 7s 8c Jh', 'Qc Ac 2c 5h 6h 7h 10s');
    const engine = midnight();
    engine.startNewHand();
    act(engine, 'check');
    act(engine, 'check');
    // b needs two cards to beat the king: Q, then A
    expect(up(engine, 'b')).toEqual(['Qc', 'Ac']);
    expect(engine.getState().studState?.midnight?.holder).toBe('b');
    expect(engine.getState().activePlayer).toBe('b');
    act(engine, 'bet');
    act(engine, 'call');
    // a turns every card and never beats ace-queen, so a is out and b takes the pot
    expect(up(engine, 'a')).toHaveLength(7);
    expect(player(engine, 'a').isFolded).toBe(true);
    // a went out once all nine cards were turned: a's first, b's two, then a's other six
    expect(engine.getState().studState?.midnight?.flips).toHaveLength(9);
    expect(engine.getState().studState?.midnight?.outAt).toEqual({ a: 9 });
    expect(engine.getState().stage).toBe('showdown');
    expect(player(engine, 'b').stack).toBe(103);
    expect(player(engine, 'a').stack).toBe(97);
  });

  test('a tie does not beat the high hand: a wild 9 as an ace only ties an ace', () => {
    stackDeck('Ac 2h 5d 6d 7s 8c Jh', '9h Kd 2c 5h 6h 7h 10s');
    const engine = midnight();
    engine.startNewHand();
    act(engine, 'check');
    act(engine, 'check');
    expect(up(engine, 'b')).toEqual(['9h', 'Kd']);
    expect(engine.getState().studState?.midnight?.holder).toBe('b');
  });

  test('a 4 turned up gets an extra face-down card to turn later', () => {
    stackDeck('4s 2h 5d 6d 7s 8c Jh', 'Qc Ac 2c 5h 6h 7h 10s');
    const engine = midnight();
    engine.startNewHand();
    const a = engine.getState().studState!.playerCards.a;
    expect(show(a.upCards)).toEqual(['4s']);
    expect(a.downCards).toHaveLength(7);
    expect(show(a.downCards).pop()).toBe('Ks');
  });

  describe('a 3 turned up', () => {
    test('stops to match the pot or fold; matching carries on and the 3 plays wild', () => {
      stackDeck('3h 2h 5d 6d 7s 8c Jh', 'Kc Qd 2c 5h 6h 7h 10s');
      const engine = midnight();
      engine.startNewHand();
      let s = engine.getState();
      expect(s.studState?.potMatch).toEqual({ queue: ['a'], stage: 'third' });
      expect(s.activePlayer).toBe('a');
      expect(() => act(engine, 'check', 'a')).toThrow(/Match the pot or fold/);
      act(engine, 'match-pot');
      s = engine.getState();
      expect(s.pot).toBe(4);
      expect(s.studState?.potMatched).toEqual({ a: 2 });
      expect(s.studState?.midnight?.holder).toBe('a');
      expect(s.activePlayer).toBe('a');
      // Nothing b turns beats a wild ace, so b is out
      act(engine, 'check');
      act(engine, 'check');
      expect(up(engine, 'b')).toEqual(['Kc', 'Qd', '2c', '5h', '6h', '7h', '10s']);
      expect(engine.getState().stage).toBe('showdown');
      expect(player(engine, 'a').stack).toBe(101);
    });

    test('folding hands the pot to the other player; a timeout folds', () => {
      stackDeck('3h 2h 5d 6d 7s 8c Jh', 'Qc Ac 2c 5h 6h 7h 10s');
      const engine = midnight();
      engine.startNewHand();
      expect(engine.handleTimeout(Date.now() + 1e9).action).toBe('fold');
      expect(engine.getState().stage).toBe('showdown');
      expect(player(engine, 'b').stack).toBe(101);
    });
  });

  test('when the high hand is all-in, the others stay in for the side pot', () => {
    // a has only the ante, so is all-in with the ace showing. b and c bet into a side pot, and
    // neither beats the ace; b's king-queen-jack takes the side pot.
    stackDeck(
      'Kc Qc Jc 7d 5d 2h 8h', // b
      'Kh Qh 10d 7s 5h 2d 6c', // c
      'As 2c 6d 7h 8d 10c Jh', // a
    );
    const engine = midnight([P('b', 1), P('c', 2), P('a', 3, 1)]);
    engine.startNewHand();
    expect(player(engine, 'a').isAllIn).toBe(true);
    expect(up(engine, 'a')).toEqual(['As']);
    expect(engine.getState().activePlayer).toBe('b');
    act(engine, 'bet');
    act(engine, 'call');
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(player(engine, 'b').isFolded).toBe(false);
    expect(player(engine, 'c').isFolded).toBe(false);
    expect(player(engine, 'a').stack).toBe(3);
    expect(player(engine, 'b').stack).toBe(101);
    expect(player(engine, 'c').stack).toBe(97);
  });

  test('random hands always finish and never create or lose chips', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let hand = 0; hand < 300; hand++) {
      const n = 2 + (hand % 5);
      const players = Array.from({ length: n }, (_, i) => P(`p${i}`, i + 1, 1 + Math.floor(rand() * 40)));
      const total = players.reduce((sum, p) => sum + p.stack, 0);
      const engine = midnight(players);
      engine.startNewHand();
      for (let steps = 0; steps < 400 && engine.getState().stage !== 'showdown'; steps++) {
        const s = engine.getState();
        if (!s.activePlayer) { engine.runStudAllInStreet(); continue; }
        const me = player(engine, s.activePlayer);
        const r = rand();
        // Raises the cap or a short stack doesn't allow fall back to a call
        const tryAct = (type: PlayerAction['type'], fallback: PlayerAction['type']) => {
          try { act(engine, type); } catch { act(engine, fallback); }
        };
        if (s.studState?.potMatch) act(engine, r < 0.3 ? 'fold' : 'match-pot');
        else if (s.currentBet > me.currentBet && r < 0.2) act(engine, 'fold');
        else if (s.currentBet > me.currentBet) tryAct(r < 0.4 ? 'raise' : 'call', 'call');
        else tryAct(r < 0.4 ? 'bet' : 'check', 'check');
      }
      const s = engine.getState();
      expect(s.stage).toBe('showdown');
      expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(total);
    }
  });

  test('records the order cards are turned, and gives the next player the time they take to show', () => {
    stackDeck('Kc 2h 5d 6d 7s 8c Jh', 'Qc Ac 2c 5h 6h 7h 10s');
    const engine = midnight();
    const t0 = Date.now();
    engine.startNewHand();
    expect(engine.getState().studState?.midnight?.flips).toEqual(['a']);
    // One card turned: 2 seconds on top of the usual time
    const first = engine.getState().turnDeadline! - t0;
    act(engine, 'check');
    const t1 = Date.now();
    act(engine, 'check');
    expect(engine.getState().studState?.midnight?.flips).toEqual(['a', 'b', 'b']);
    const second = engine.getState().turnDeadline! - t1;
    expect(second - first).toBeGreaterThanOrEqual(2000 - 50);
    expect(second - first).toBeLessThanOrEqual(2000 + 50);
  });

  test('a betting pause survives saving and restoring the game', () => {
    stackDeck('Kc 2h 5d 6d 7s 8c Jh', 'Qc Ac 2c 5h 6h 7h 10s');
    const engine = midnight();
    engine.startNewHand();
    act(engine, 'check');
    const restored = PokerEngine.fromSerialized(engine.serialize() as any);
    act(restored, 'check', 'b');
    expect(up(restored, 'b')).toEqual(['Qc', 'Ac']);
    expect(restored.getState().activePlayer).toBe('b');
  });
});
