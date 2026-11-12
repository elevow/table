import { DeckManager } from '../deck-manager';
import { PokerEngine } from '../poker-engine';
import { holeCardCount, isHiLoVariant, isOmahaVariant } from '../variant-rules';
import { resolveVariantAndMode } from '../../game/variant-mapping';
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

// Heads-up the button (b) posts the small blind; a is dealt first, one card at a time, then the board
const stackDeck = (a: string, b: string, board: string) => {
  const [ha, hb] = [cards(a), cards(b)];
  const order: Card[] = [];
  for (let r = 0; r < 5; r++) order.push(ha[r], hb[r]);
  const deck = [...order, ...cards(board)].reverse();
  jest.spyOn(DeckManager.prototype, 'resetDeck').mockImplementation(function (this: any) {
    this.deck = [...deck];
  });
};

const act = (engine: PokerEngine, type: PlayerAction['type']) =>
  engine.handleAction({ type, playerId: engine.getState().activePlayer, tableId: 't', timestamp: Date.now() });

afterEach(() => jest.restoreAllMocks());

describe('Big O', () => {
  test('is five-card Omaha Hi-Lo, pot limit by default', () => {
    expect(holeCardCount('big-o')).toBe(5);
    expect(isOmahaVariant('big-o')).toBe(true);
    expect(isHiLoVariant('big-o')).toBe(true);
    expect(resolveVariantAndMode({ variant: 'big-o' }).bettingMode).toBe('pot-limit');
  });

  test('splits the pot between the best high hand and the best low, two hole cards each', () => {
    // a: kings for quads with the board. b: ace-deuce for the wheel, the best low.
    stackDeck('Ks Kc Qs Js 10c', 'Ah 2h 9c 9d 9h', '3d 4c 5s Kd Kh');
    const engine = new PokerEngine('t', [P('a', 1), P('b', 2)], 1, 2, { variant: 'big-o', bettingMode: 'pot-limit' });
    engine.startNewHand();
    expect(engine.getState().players[0].holeCards).toHaveLength(5);
    act(engine, 'call');
    act(engine, 'check');
    for (let i = 0; i < 6; i++) act(engine, 'check');
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.lastHiLoResult?.high?.map(w => w.playerId)).toEqual(['a']);
    expect(s.lastHiLoResult?.low?.map(w => w.playerId)).toEqual(['b']);
    expect(s.players.map(p => p.stack)).toEqual([100, 100]);
  });
});
