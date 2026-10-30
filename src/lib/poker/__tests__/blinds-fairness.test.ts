import { PokerEngine } from '../poker-engine';
import type { Player } from '../../../types/poker';

const mk = (id: string, position: number, stack = 100): any => ({
  id, name: id, position, stack, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

const seat = (id: string, seatNumber: number, chips = 100) => ({ id, name: id, seatNumber, chips });

const finishHand = (engine: PokerEngine) => {
  let guard = 10;
  while (engine.getState().stage !== 'showdown' && guard-- > 0) engine.forceFold(engine.getState().activePlayer);
  expect(engine.getState().stage).toBe('showdown');
};

const player = (engine: PokerEngine, id: string): Player => engine.getState().players.find(p => p.id === id)!;
const bigBlindId = (engine: PokerEngine) => engine.getState().handActions!.find(a => a.action === 'big-blind')!.playerId;
const dealtIn = (engine: PokerEngine, id: string) => (player(engine, id).holeCards || []).length > 0;

describe('the blinds follow the button', () => {
  it('moves the big blind round a ring game, one seat per hand', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3), mk('d', 4)], 1, 2);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      engine.startNewHand();
      seen.push(bigBlindId(engine));
      finishHand(engine);
    }
    expect(new Set(seen).size).toBe(4);
  });
});

describe('waiting for the big blind', () => {
  // Four players at seats 1-4, with a newcomer at seat 5 waiting
  const tableWithNewcomer = () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3), mk('d', 4)], 1, 2);
    engine.startNewHand();
    finishHand(engine);
    engine.syncSeatedPlayers([seat('a', 1), seat('b', 2), seat('c', 3), seat('d', 4), seat('n', 5)]);
    expect(player(engine, 'n').waitingForBigBlind).toBe(true);
    return engine;
  };

  it('deals a newcomer in on the hand the big blind reaches them, and not before', () => {
    const engine = tableWithNewcomer();
    let hands = 0;
    while (!dealtIn(engine, 'n') && hands < 6) {
      engine.startNewHand();
      hands += 1;
      if (!dealtIn(engine, 'n')) {
        // Skipped: no cards, no blinds, never the button
        expect(player(engine, 'n').currentBet).toBe(0);
        expect(engine.getState().players[engine.getState().dealerPosition].id).not.toBe('n');
        finishHand(engine);
      }
    }
    expect(dealtIn(engine, 'n')).toBe(true);
    expect(bigBlindId(engine)).toBe('n');
    expect(player(engine, 'n').waitingForBigBlind).toBeUndefined();
  });

  it('can post a big blind to be dealt in at once', () => {
    const engine = tableWithNewcomer();
    engine.setSeatOption('n', 'post-big-blind-now', true);
    engine.startNewHand();
    const n = player(engine, 'n');
    expect(dealtIn(engine, 'n')).toBe(true);
    expect(n.currentBet).toBe(2);
    expect(engine.getState().handActions!.some(a => a.playerId === 'n' && a.action === 'big-blind')).toBe(true);
    // The posted blind is live: n still gets to act this round
    expect(n.hasActed).toBe(false);
    expect(n.postBigBlindNow).toBeUndefined();
  });

  it('only a waiting player can choose to post now', () => {
    const engine = tableWithNewcomer();
    expect(() => engine.setSeatOption('a', 'post-big-blind-now', true)).toThrow('You are not waiting for the big blind');
  });

  it('deals a newcomer straight in when the table needs them to play', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    engine.removePlayer('b');
    finishHand(engine);
    engine.syncSeatedPlayers([seat('a', 1), seat('n', 4)]);
    engine.startNewHand();
    expect(dealtIn(engine, 'n')).toBe(true);
  });

  it('deals a newcomer straight in at stud, which has no blinds', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 1, 2, { variant: 'seven-card-stud' });
    engine.startNewHand();
    finishHand(engine);
    engine.syncSeatedPlayers([seat('a', 1), seat('b', 2), seat('c', 3), seat('n', 4)]);
    engine.startNewHand();
    expect(engine.getState().studState!.playerCards.n.upCards).toHaveLength(1);
  });
});

describe('missed big blinds', () => {
  it('a player who sits out while the big blind passes owes it when they come back', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3), mk('d', 4)], 1, 2);
    engine.setSittingOut('b', true);
    let hands = 0;
    while (!player(engine, 'b').missedBigBlind && hands < 6) {
      engine.startNewHand();
      finishHand(engine);
      hands += 1;
    }
    expect(player(engine, 'b').missedBigBlind).toBe(true);

    engine.setSittingOut('b', false);
    expect(player(engine, 'b').waitingForBigBlind).toBe(true);
    // Not dealt in until the big blind reaches them
    let waited = 0;
    while (waited < 6) {
      engine.startNewHand();
      if (dealtIn(engine, 'b')) break;
      finishHand(engine);
      waited += 1;
    }
    expect(dealtIn(engine, 'b')).toBe(true);
    expect(bigBlindId(engine)).toBe('b');
    expect(player(engine, 'b').missedBigBlind).toBeUndefined();
  });

  it('a player who sits out and back in before the big blind reaches them owes nothing', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3), mk('d', 4)], 1, 2);
    engine.startNewHand();
    finishHand(engine);
    engine.setSittingOut('b', true);
    engine.setSittingOut('b', false);
    expect(player(engine, 'b').waitingForBigBlind).toBeUndefined();
    engine.startNewHand();
    expect(dealtIn(engine, 'b')).toBe(true);
  });
});

describe('leaving after the hand', () => {
  it('is a choice the player can set and take back', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    engine.setSeatOption('a', 'leave-after-hand', true);
    expect(player(engine, 'a').leaveAfterHand).toBe(true);
    // Playing on is unaffected
    expect(player(engine, 'a').isFolded).toBe(false);
    engine.setSeatOption('a', 'leave-after-hand', false);
    expect(player(engine, 'a').leaveAfterHand).toBeUndefined();
  });
});
