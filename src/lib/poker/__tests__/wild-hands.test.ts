import { DeckManager } from '../deck-manager';
import { PokerEngine } from '../poker-engine';
import { maxPlayersForGame, parseWildRule, supportsWildRule } from '../variant-rules';
import {
  evaluateWildHigh, evaluateWildLow, evaluateWildOmaha, evaluateWildOmahaLow, evaluateWildRazz, wildMatcher,
} from '../wild-hands';
import { resolveVariantAndMode } from '../../game/variant-mapping';
import { formatHandResult } from '../../utils/hand-result-formatter';
import { HandRank } from '../../../types/poker';
import type { Card, GameVariant, Player, WildRule } from '../../../types/poker';

const c = (s: string): Card => {
  const suit = ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[s.slice(-1) as 'h' | 'd' | 'c' | 's'];
  return { rank: s.slice(0, -1) as Card['rank'], suit };
};
const cards = (s: string) => s.split(' ').map(c);
const deuces = wildMatcher('deuces')!;
const jacks = wildMatcher('one-eyed-jacks')!;
const high = (s: string) => evaluateWildHigh(cards(s), deuces);

afterEach(() => jest.restoreAllMocks());

describe('which cards are wild', () => {
  test('deuces: every two', () => {
    expect(cards('2c 2d 2h 2s').every(deuces)).toBe(true);
    expect(deuces(c('3c'))).toBe(false);
  });

  test('one-eyed jacks: only the spade and heart jacks', () => {
    expect(jacks(c('Js'))).toBe(true);
    expect(jacks(c('Jh'))).toBe(true);
    expect(jacks(c('Jd'))).toBe(false);
    expect(jacks(c('Jc'))).toBe(false);
  });

  test('no rule means no matcher', () => {
    expect(wildMatcher(undefined)).toBeNull();
  });
});

describe('high hands', () => {
  test('five of a kind is possible and beats a natural royal flush', () => {
    expect(high('2c 2d 2h 2s Ah').name).toBe('Five of a Kind, Aces');
    const five = high('2c 2d 2h Ks Kd');
    expect(five.rank).toBe(HandRank.FiveOfAKind);
    expect(five.name).toBe('Five of a Kind, Kings');
    expect(five.score).toBeGreaterThan(high('Ah Kh Qh Jh 10h').score);
  });

  test('a wild card counts as an ace on its own', () => {
    expect(evaluateWildHigh(cards('2c'), deuces).name).toBe('Ace High');
    expect(evaluateWildHigh(cards('2c 2d'), deuces).name).toBe('Pair of Aces');
  });

  test('a wild card becomes something else when that makes a better hand', () => {
    expect(evaluateWildHigh(cards('2c Kh'), deuces).name).toBe('Pair of Kings');
    expect(high('2c Kh 9d 7s 4c').name).toBe('Pair of Kings');
    expect(high('2c 9h 8h 7h 6h').name).toBe('Straight Flush, Ten High');
    expect(high('Ah Kh Qh Jh 2c').name).toBe('Royal Flush');
    expect(high('2c Ah 3d 4s 5c').name).toBe('Straight, Five High');
    expect(high('Kh Kd 9c 9s 2c').name).toBe('Full House, Kings over Nines');
  });

  test('a wild card plays as an ace in a flush', () => {
    const flush = high('2c Kh 9h 7h 4h');
    expect(flush.name).toBe('Flush, Ace High');
    expect(flush.score).toBeGreaterThan(high('Qh Jh 9h 7h 4h').score);
  });

  test('picks the best five of seven and returns the real cards', () => {
    const hand = high('2c 2d Ah Ad 9c 5s 3h');
    expect(hand.name).toBe('Four of a Kind, Aces');
    expect(hand.cards).toHaveLength(5);
    expect(hand.cards.map(x => `${x.rank}${x.suit[0]}`)).toEqual(expect.arrayContaining(['2c', '2d', 'Ah', 'Ad', '9c']));
    expect(hand.kickers).toHaveLength(2);
  });

  test('kickers break ties and identical hands tie, wild or natural', () => {
    expect(high('2c Ah Ad Ks 9c').score).toBeGreaterThan(high('2d Ac As Qs 9d').score);
    expect(high('2c Ah Ad Ks 9c').score).toBe(high('As Ac Ad Kh 9h').score);
  });

  test('one-eyed jacks are wild but the other jacks are ordinary', () => {
    expect(evaluateWildHigh(cards('Js Jh Ad Ac 5s'), jacks).name).toBe('Four of a Kind, Aces');
    expect(evaluateWildHigh(cards('Jd Jc Ad Ac 5s'), jacks).name).toBe('Two Pair, Aces and Jacks');
  });
});

describe('Omaha', () => {
  test('wild cards still follow two from the hand and three from the board', () => {
    expect(evaluateWildOmaha(cards('As Ad Ac 3d'), cards('2c 2d 2h 7s 9s'), deuces).name).toBe('Five of a Kind, Aces');
    expect(evaluateWildOmaha(cards('Ah Kh 2c 3d'), cards('7h 8h 9h Qs Ks'), deuces).name).toBe('Flush, Ace High');
  });

  test('a royal flush on the board can not be played from three hole cards short', () => {
    const hand = evaluateWildOmaha(cards('3c 4d 8s Kd'), cards('Ah Kh Qh Jh 10h'), deuces);
    expect(hand.name).toBe('Pair of Kings');
  });

  test('before the flop it just reads the hole cards', () => {
    expect(evaluateWildOmaha(cards('2c Ks 9d 4h'), [], deuces).name).toBe('Pair of Kings');
  });
});

describe('low hands', () => {
  const ranks = (s: string) => evaluateWildLow(cards(s), deuces)?.ranks;

  test('a wild card takes the lowest rank not already held', () => {
    expect(ranks('2c 3d 4s 5h 7c Kd Qs')).toEqual([1, 3, 4, 5, 7]);
    expect(ranks('2c 2d 3s 4h 5c')).toEqual([1, 2, 3, 4, 5]);
  });

  test('still has to qualify at eight or better', () => {
    expect(ranks('2c 3d 4s 5h 9c Kd Qs')).toBeUndefined();
  });

  test('Omaha low uses two from the hand', () => {
    expect(evaluateWildOmahaLow(cards('Ah 2c Kd Qs'), cards('3d 4s 5h Jc 9c'), deuces)?.ranks).toEqual([1, 2, 3, 4, 5]);
  });

  test('razz', () => {
    const hand = evaluateWildRazz(cards('2c Kd 3s 4h 5c 7d 9s'), deuces);
    expect(hand.description).toBe('7-5-4-3-A low');
    expect(hand.strength).toBeGreaterThan(evaluateWildRazz(cards('3c Kd 8s 4h 5c 7d 9s'), deuces).strength);
  });
});

describe('table rules', () => {
  test('only known wild rules are accepted', () => {
    expect(parseWildRule('deuces')).toBe('deuces');
    expect(parseWildRule('one-eyed-jacks')).toBe('one-eyed-jacks');
    expect(parseWildRule('none')).toBeUndefined();
    expect(parseWildRule(undefined)).toBeUndefined();
  });

  test('wild cards force fixed limit', () => {
    expect(resolveVariantAndMode({ variant: 'texas-holdem', bettingMode: 'no-limit', wildRule: 'deuces' }).bettingMode).toBe('fixed-limit');
    expect(resolveVariantAndMode({ variant: 'omaha', wildRule: 'one-eyed-jacks' }).bettingMode).toBe('fixed-limit');
    expect(resolveVariantAndMode({ variant: 'texas-holdem', bettingMode: 'no-limit' }).bettingMode).toBe('no-limit');
  });

  test('seven-card games with wild cards seat seven; other games keep nine', () => {
    for (const variant of ['seven-card-stud', 'seven-card-stud-hi-lo', 'razz']) {
      expect(maxPlayersForGame(variant, 'deuces')).toBe(7);
      expect(maxPlayersForGame(variant)).toBe(9);
    }
    expect(maxPlayersForGame('five-card-stud', 'deuces')).toBe(9);
    expect(maxPlayersForGame('texas-holdem', 'deuces')).toBe(9);
  });

  test('wild cards are not offered on games that change each hand', () => {
    expect(supportsWildRule('dealers-choice')).toBe(false);
    expect(supportsWildRule('mixed')).toBe(false);
    expect(supportsWildRule('razz')).toBe(true);
  });
});

describe('showdowns through the engine', () => {
  const P = (id: string, pos: number): Player => ({
    id, name: id, position: pos, stack: 100, currentBet: 0,
    hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
  });

  // The next shuffle deals these cards in this order (the deck deals from its end)
  const stackDeck = (order: string) => {
    const deck = cards(order).reverse();
    jest.spyOn(DeckManager.prototype, 'resetDeck').mockImplementation(function (this: any) {
      this.deck = [...deck];
    });
  };

  const engineFor = (variant: GameVariant, wildRule?: WildRule) =>
    new PokerEngine('t', [P('a', 1), P('b', 2)], 1, 2, { variant, bettingMode: 'fixed-limit', wildRule });

  const playToShowdown = (engine: PokerEngine) => {
    engine.startNewHand();
    for (let i = 0; i < 40 && engine.getState().stage !== 'showdown'; i++) {
      const s = engine.getState();
      const me = s.players.find(p => p.id === s.activePlayer)!;
      const type = s.studState?.bringIn?.pending ? 'bring-in' : s.currentBet > me.currentBet ? 'call' : 'check';
      engine.handleAction({ type, playerId: s.activePlayer, tableId: s.tableId, timestamp: Date.now() });
    }
    expect(engine.getState().stage).toBe('showdown');
    return engine.getState();
  };
  const stack = (engine: PokerEngine, id: string) => engine.getState().players.find(p => p.id === id)!.stack;

  // a: 2c 2d Ah Ad 3s, b: Ks Kd Kc 5h 5d. Four aces with deuces wild; otherwise b's full house wins.
  const FIVE_STUD = '2c Ks 2d Kd Ah Kc Ad 5h 3s 5d';

  test('stud: the wild hand wins the pot', () => {
    stackDeck(FIVE_STUD);
    const engine = engineFor('five-card-stud', 'deuces');
    playToShowdown(engine);
    expect(stack(engine, 'a')).toBeGreaterThan(100);
    expect(stack(engine, 'a') + stack(engine, 'b')).toBe(200);
  });

  test('stud: the same cards go the other way without wild cards', () => {
    stackDeck(FIVE_STUD);
    const engine = engineFor('five-card-stud');
    playToShowdown(engine);
    expect(stack(engine, 'b')).toBeGreaterThan(100);
  });

  test("hold'em: wild cards count, and the chat line names the wild hand", () => {
    stackDeck('2c Ks 2d Kd Ah Ad 9s 7c 3d');
    const engine = engineFor('texas-holdem', 'deuces');
    const state = playToShowdown(engine);
    const withDeuces = state.players.find(p => p.holeCards?.some(x => x.rank === '2'))!;
    expect(withDeuces.stack).toBeGreaterThan(100);
    expect(formatHandResult(state)?.message).toContain('Four of a Kind, Aces');
  });

  test('razz: a wild card plays low', () => {
    // a: 2c 3d 4s 5h 7c Kd Qs (7-5-4-3-A). b: 3c 4d 5s 6h 8c Jd 10s (8-6-5-4-3).
    stackDeck('2c 3c 3d 4d 4s 5s 5h 6h 7c 8c Kd Jd Qs 10s');
    const engine = engineFor('razz', 'deuces');
    playToShowdown(engine);
    expect(stack(engine, 'a')).toBeGreaterThan(100);
  });

  test('stud hi-lo: a wild card can win both halves', () => {
    // a: 2c Ah 3d 4s 5h 9c Kd makes a straight and a wheel. b: Ks Qd Jh 9s 8c 7d 6s has neither.
    stackDeck('2c Ks Ah Qd 3d Jh 4s 9s 5h 8c 9c 7d Kd 6s');
    const engine = engineFor('seven-card-stud-hi-lo', 'deuces');
    const state = playToShowdown(engine);
    expect(state.lastHiLoResult?.high.map(w => w.playerId)).toEqual(['a']);
    expect(state.lastHiLoResult?.low?.map(w => w.playerId)).toEqual(['a']);
  });

  test('omaha hi-lo: wild cards count on both halves', () => {
    stackDeck('Ah Ks 2c Qd Kd Jc Qs 9s 3d 4s 5h Jd 9c');
    const engine = engineFor('omaha-hi-lo', 'deuces');
    const state = playToShowdown(engine);
    const holder = state.players.find(p => p.holeCards?.some(x => x.rank === '2'))!;
    expect(state.lastHiLoResult?.low?.map(w => w.playerId)).toEqual([holder.id]);
  });

  test('the wild rule survives saving and restoring the game', () => {
    stackDeck(FIVE_STUD);
    const engine = engineFor('five-card-stud', 'deuces');
    engine.startNewHand();
    expect(PokerEngine.fromSerialized(engine.serialize() as any).getState().wildRule).toBe('deuces');
  });

  test('run it twice stays off at a wild table', () => {
    const wild = engineFor('texas-holdem', 'deuces');
    wild.setAllowRunItTwice(true);
    expect(wild.getState().allowRunItTwice).toBe(false);
    const plain = engineFor('texas-holdem');
    plain.setAllowRunItTwice(true);
    expect(plain.getState().allowRunItTwice).toBe(true);
  });
});
