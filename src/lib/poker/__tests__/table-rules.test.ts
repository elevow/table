import { createPokerEngine } from '../engine-factory';
import { DeckManager } from '../deck-manager';
import { PokerEngine } from '../poker-engine';
import { describeMixedRotation, HORSE_GAMES, parseHandsPerGame, parseMixedGames } from '../variant-rules';
import { defaultBettingModeForVariant } from '../../game/variant-mapping';
import type { Card, GameVariant, Player, TableState } from '../../../types/poker';

const P = (id: string, pos: number, stack = 100): Player => ({
  id, name: id, position: pos, stack, currentBet: 0,
  hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

const c = (s: string): Card => {
  const suit = ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[s.slice(-1) as 'h' | 'd' | 'c' | 's'];
  return { rank: s.slice(0, -1) as Card['rank'], suit };
};
const cards = (s: string) => s.split(' ').map(c);

const act = (engine: PokerEngine, type: 'bet' | 'raise' | 'call' | 'check' | 'fold' | 'bring-in', amount?: number) => {
  const s = engine.getState();
  engine.handleAction({ type, playerId: s.activePlayer, tableId: s.tableId, amount, timestamp: Date.now() });
};

const total = (s: TableState) => s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;

// Give players known hole cards and make the next board cards known
const rig = (engine: PokerEngine, holes: Record<string, string>, board: string) => {
  const st = (engine as any).state as TableState;
  st.players.forEach(p => { if (holes[p.id]) p.holeCards = cards(holes[p.id]); });
  (engine as any).deckManager = DeckManager.fromSerialized(cards(board).reverse());
};

// Check or call to showdown, with an optional per-player choice
const playOut = (engine: PokerEngine, choose?: (s: TableState, me: Player) => 'fold' | 'bet' | 'raise' | undefined) => {
  let guard = 60;
  while (engine.getState().stage !== 'showdown' && guard-- > 0) {
    const s = engine.getState();
    const me = s.players.find(p => p.id === s.activePlayer)!;
    const pick = choose?.(s, me);
    if (pick === 'bet' && s.currentBet === 0) act(engine, 'bet', 10);
    else if (pick === 'raise' && s.currentBet > 0 && me.stack > s.currentBet - me.currentBet) act(engine, 'raise', s.currentBet + 10);
    else if (pick === 'fold' && s.currentBet > me.currentBet) act(engine, 'fold');
    else act(engine, s.currentBet > me.currentBet ? 'call' : 'check');
  }
};

describe('antes', () => {
  const holdem = (players: Player[], ante: number, variant?: GameVariant) => {
    const engine = createPokerEngine({ tableId: 'ante', players, smallBlind: 1, bigBlind: 2, state: variant ? { variant } : undefined });
    engine.setAnte(ante);
    return engine;
  };

  test('every dealt-in player antes before the blinds; antes are dead money, not part of a bet', () => {
    const engine = holdem([P('a', 0), P('b', 1), P('c', 2)], 1);
    engine.startNewHand();
    const s = engine.getState();
    expect(s.pot).toBe(6);
    expect(s.currentBet).toBe(2);
    expect(s.players.map(p => p.currentBet).sort()).toEqual([0, 1, 2]);
    const antes = s.handActions!.filter(a => a.action === 'ante');
    expect(antes).toHaveLength(3);
    antes.forEach(a => expect(a.put).toBe(1));
    expect(s.handActions!.findIndex(a => a.action === 'ante')).toBeLessThan(s.handActions!.findIndex(a => a.action === 'small-blind'));
    expect(total(s)).toBe(300);
  });

  test('sitting-out players do not ante', () => {
    const players = [P('a', 0), P('b', 1), P('c', 2)];
    players[2].isSittingOut = true;
    const engine = holdem(players, 1);
    engine.startNewHand();
    expect(engine.getState().handActions!.filter(a => a.action === 'ante').map(a => a.playerId).sort()).toEqual(['a', 'b']);
  });

  test('a short stack all-in wins only the main pot, which includes the antes', () => {
    const engine = holdem([P('a', 0), P('b', 1), P('c', 2, 3)], 1);
    engine.startNewHand();
    rig(engine, { a: 'Ks Kd', b: '7c 2h', c: 'As Ad' }, 'Ac 9d 5s 3h Jc');
    playOut(engine, (s, me) => (me.id === 'a' ? 'bet' : undefined));
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    const stack = (id: string) => s.players.find(p => p.id === id)!.stack;
    // c put in 3 (ante 1 + blind or call 2), so the main pot is 3 from each player
    expect(stack('c')).toBe(9);
    expect(stack('a') + stack('b') + stack('c')).toBe(203);
    expect(stack('a')).toBeGreaterThan(100);
  });

  test('a player whose ante puts them all-in is still dealt in and chips are conserved', () => {
    const engine = holdem([P('a', 0), P('b', 1), P('c', 2, 1)], 1);
    engine.startNewHand();
    const s0 = engine.getState();
    expect(s0.players.find(p => p.id === 'c')!.isAllIn).toBe(true);
    playOut(engine);
    expect(total(engine.getState())).toBe(201);
  });

  test('when the antes put everyone all-in the hand runs out and settles straight away', () => {
    const engine = holdem([P('a', 0, 1), P('b', 1, 1)], 1);
    engine.startNewHand();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.communityCards).toHaveLength(5);
    expect(total(s)).toBe(2);
  });

  test('bomb pots keep their own ante and stud has no room ante', () => {
    const bomb = holdem([P('a', 0), P('b', 1), P('c', 2)], 1);
    bomb.setBombPotNext(1);
    bomb.startNewHand();
    expect(bomb.getState().pot).toBe(6);
    expect(bomb.getState().handActions!.filter(a => a.action === 'ante')).toHaveLength(3);

    const stud = holdem([P('a', 0), P('b', 1), P('c', 2)], 1, 'seven-card-stud');
    stud.startNewHand();
    expect(stud.getState().handActions!.some(a => a.action === 'ante')).toBe(false);
    act(stud, 'bring-in');
    expect(stud.getState().pot).toBe(1);
  });

  test('ante 0 turns antes off', () => {
    const engine = holdem([P('a', 0), P('b', 1)], 0);
    engine.startNewHand();
    expect(engine.getState().ante).toBeUndefined();
    expect(engine.getState().pot).toBe(3);
  });

  test('antes count towards the pot-limit maximum', () => {
    const engine = createPokerEngine({ tableId: 'plo', players: [P('a', 0), P('b', 1), P('c', 2)], smallBlind: 1, bigBlind: 2, state: { variant: 'omaha' } });
    engine.setAnte(2);
    engine.startNewHand();
    const s = engine.getState();
    expect(s.pot).toBe(9);
    expect(s.players.every(p => (p.holeCards || []).length === 4)).toBe(true);
    // Raise the maximum: the pot (9, antes included) plus the actor's call, on top of the current bet
    const call = 2 - s.players.find(p => p.id === s.activePlayer)!.currentBet;
    act(engine, 'raise', 1000);
    expect(engine.getState().currentBet).toBe(2 + 9 + call);
  });
});

describe('7-2 bounty', () => {
  const engineWith = (players = [P('a', 0), P('b', 1), P('c', 2)], variant?: GameVariant) => {
    const engine = createPokerEngine({ tableId: 'b72', players, smallBlind: 1, bigBlind: 2, state: variant ? { variant } : undefined });
    engine.setSevenDeuceBounty(5);
    engine.startNewHand();
    return engine;
  };
  const stack = (engine: PokerEngine, id: string) => engine.getState().players.find(p => p.id === id)!.stack;

  test('offsuit only', () => {
    expect(PokerEngine.isSevenDeuceOffsuit(cards('7c 2d'))).toBe(true);
    expect(PokerEngine.isSevenDeuceOffsuit(cards('2h 7s'))).toBe(true);
    expect(PokerEngine.isSevenDeuceOffsuit(cards('7c 2c'))).toBe(false);
    expect(PokerEngine.isSevenDeuceOffsuit(cards('7c 3d'))).toBe(false);
    expect(PokerEngine.isSevenDeuceOffsuit(undefined)).toBe(false);
  });

  test('winning a contested showdown with 7-2 collects from every other player dealt in', () => {
    const engine = engineWith();
    rig(engine, { a: '7c 2d', b: 'As Ks', c: 'Qh Jh' }, '7h 7s 2c Kd 9s');
    playOut(engine);
    const s = engine.getState();
    expect(s.handWinners).toEqual(['a']);
    expect(s.sevenDeuceResult).toEqual({ playerId: 'a', total: 10, payments: { b: 5, c: 5 } });
    expect(stack(engine, 'a')).toBe(100 - 2 + 6 + 10);
    expect(stack(engine, 'b')).toBe(100 - 2 - 5);
    const bounties = s.handActions!.filter(x => x.action === 'bounty');
    expect(bounties.map(x => [x.playerId, x.put, x.toPlayerId])).toEqual([['b', 5, 'a'], ['c', 5, 'a']]);
    // Paid once: showing again changes nothing
    engine.showCards('a');
    expect(stack(engine, 'a')).toBe(114);
    expect(total(engine.getState())).toBe(300);
  });

  test('players who folded still pay', () => {
    const engine = engineWith();
    rig(engine, { a: '7c 2d', b: 'As Ks', c: 'Qh Jh' }, '7h 7s 2c Kd 9s');
    playOut(engine, (_s, me) => (me.id === 'c' ? 'fold' : undefined));
    const s = engine.getState();
    expect(s.sevenDeuceResult?.payments).toEqual({ b: 5, c: 5 });
  });

  test('winning uncontested pays only once the cards are shown', () => {
    const engine = engineWith();
    rig(engine, { a: '7c 2d', b: 'As Ks', c: 'Qh Jh' }, '');
    playOut(engine, (_s, me) => (me.id === 'a' ? 'raise' : 'fold'));
    expect(engine.getState().handWinners).toEqual(['a']);
    expect(engine.getState().sevenDeuceResult).toBeUndefined();
    const before = stack(engine, 'a');
    engine.showCards('a');
    expect(engine.getState().sevenDeuceResult?.total).toBe(10);
    expect(stack(engine, 'a')).toBe(before + 10);
    expect(total(engine.getState())).toBe(300);
  });

  test('a short-stacked payer pays only what they have left', () => {
    const engine = engineWith([P('a', 0), P('b', 1), P('c', 2, 4)]);
    rig(engine, { a: '7c 2d', b: 'As Ks', c: 'Qh Jh' }, '');
    playOut(engine, (_s, me) => (me.id === 'a' ? 'raise' : 'fold'));
    const cLeft = stack(engine, 'c');
    expect(cLeft).toBeLessThan(5);
    engine.showCards('a');
    expect(engine.getState().sevenDeuceResult?.payments.c).toBe(cLeft);
    expect(stack(engine, 'c')).toBe(0);
  });

  test('no bounty for suited 7-2, for a loser who shows 7-2, or outside Hold\'em', () => {
    const suited = engineWith();
    rig(suited, { a: '7c 2c', b: 'As Ks', c: 'Qh Jh' }, '');
    playOut(suited, (_s, me) => (me.id === 'a' ? 'raise' : 'fold'));
    suited.showCards('a');
    expect(suited.getState().sevenDeuceResult).toBeUndefined();

    const loser = engineWith();
    rig(loser, { a: '7c 2d', b: 'As Ks', c: 'Qh Jh' }, 'Ah Kd 9c 5s 3h');
    playOut(loser);
    loser.showCards('a');
    expect(loser.getState().handWinners).toEqual(['b']);
    expect(loser.getState().sevenDeuceResult).toBeUndefined();

    const omaha = engineWith([P('a', 0), P('b', 1)], 'omaha');
    playOut(omaha, () => 'fold');
    omaha.getState().players.forEach(p => { try { omaha.showCards(p.id); } catch { /* not dealt */ } });
    expect(omaha.getState().sevenDeuceResult).toBeUndefined();
  });

  test('the result is cleared when the next hand starts', () => {
    const engine = engineWith();
    rig(engine, { a: '7c 2d', b: 'As Ks', c: 'Qh Jh' }, '7h 7s 2c Kd 9s');
    playOut(engine);
    expect(engine.getState().sevenDeuceResult).toBeDefined();
    engine.startNewHand();
    expect(engine.getState().sevenDeuceResult).toBeUndefined();
  });
});

describe('mixed-game rotation', () => {
  const endHand = (engine: PokerEngine) => {
    let guard = 20;
    while (engine.getState().stage !== 'showdown' && guard-- > 0) {
      const s = engine.getState();
      if (s.studState?.bringIn?.pending) { act(engine, 'bring-in'); continue; }
      const me = s.players.find(p => p.id === s.activePlayer)!;
      act(engine, s.currentBet > me.currentBet ? 'fold' : 'check');
    }
  };

  test('switches game and betting mode every N hands and wraps around', () => {
    const engine = createPokerEngine({ tableId: 'mix', players: [P('a', 0, 1000), P('b', 1, 1000), P('c', 2, 1000)], smallBlind: 1, bigBlind: 2 });
    engine.setMixedGame([
      { variant: 'texas-holdem', bettingMode: 'no-limit' },
      { variant: 'razz', bettingMode: 'fixed-limit' },
      { variant: 'omaha-5', bettingMode: 'pot-limit' },
    ], 2);
    const seen: Array<[string | undefined, string | undefined]> = [];
    for (let i = 0; i < 7; i++) {
      engine.startNewHand();
      const s = engine.getState();
      seen.push([s.variant, s.bettingMode]);
      endHand(engine);
    }
    expect(seen).toEqual([
      ['texas-holdem', undefined],
      ['texas-holdem', undefined],
      ['razz', 'fixed-limit'],
      ['razz', 'fixed-limit'],
      ['omaha-5', 'pot-limit'],
      ['omaha-5', 'pot-limit'],
      ['texas-holdem', undefined],
    ]);
  });

  test('the deal follows the current game', () => {
    const engine = createPokerEngine({ tableId: 'mix2', players: [P('a', 0), P('b', 1)], smallBlind: 1, bigBlind: 2 });
    engine.setMixedGame([{ variant: 'omaha-5', bettingMode: 'pot-limit' }, { variant: 'seven-card-stud', bettingMode: 'fixed-limit' }], 1);
    engine.startNewHand();
    expect(engine.getState().players.every(p => p.holeCards!.length === 5)).toBe(true);
    endHand(engine);
    engine.startNewHand();
    const s = engine.getState();
    expect(s.studState?.playerCards.a.downCards).toHaveLength(2);
    expect(s.studState?.bringIn).toBeDefined();
  });

  test('rotation progress survives saving and restoring the engine', () => {
    const engine = createPokerEngine({ tableId: 'mix3', players: [P('a', 0), P('b', 1)], smallBlind: 1, bigBlind: 2 });
    engine.setMixedGame(HORSE_GAMES, 2);
    engine.startNewHand();
    endHand(engine);
    engine.startNewHand();
    endHand(engine);
    const restored = PokerEngine.fromSerialized(engine.serialize());
    restored.startNewHand();
    const s = restored.getState();
    expect(s.variant).toBe('omaha-hi-lo');
    expect(s.bettingMode).toBe('fixed-limit');
    expect(s.mixedGame).toMatchObject({ index: 1, handsInGame: 1 });
    expect(describeMixedRotation(s.mixedGame)).toEqual({ current: HORSE_GAMES[1], next: HORSE_GAMES[2], handsLeft: 1 });
  });

  test('an empty list turns the rotation off', () => {
    const engine = createPokerEngine({ tableId: 'mix4', players: [P('a', 0), P('b', 1)], smallBlind: 1, bigBlind: 2 });
    engine.setMixedGame([], 2);
    expect(engine.getState().mixedGame).toBeUndefined();
    expect(describeMixedRotation(undefined)).toBeNull();
  });

  test('configuration parsing', () => {
    expect(parseMixedGames(['razz', { variant: 'omaha' }, { variant: 'bogus' }, { variant: 'texas-holdem', bettingMode: 'fixed-limit' }], defaultBettingModeForVariant)).toEqual([
      { variant: 'razz', bettingMode: 'fixed-limit' },
      { variant: 'omaha', bettingMode: 'pot-limit' },
      { variant: 'texas-holdem', bettingMode: 'fixed-limit' },
    ]);
    expect(parseMixedGames([], defaultBettingModeForVariant)).toBeNull();
    expect(parseMixedGames('horse', defaultBettingModeForVariant)).toBeNull();
    expect(parseHandsPerGame(3)).toBe(3);
    expect(parseHandsPerGame('0')).toBe(8);
    expect(parseHandsPerGame(1000)).toBe(100);
  });
});
