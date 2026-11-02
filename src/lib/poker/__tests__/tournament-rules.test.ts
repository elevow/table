import { PokerEngine } from '../poker-engine';
import type { Player } from '../../../types/poker';

const mk = (id: string, position: number, stack = 100): any => ({
  id, name: id, position, stack, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

const seat = (id: string, seatNumber: number, chips = 100) => ({ id, name: id, seatNumber, chips });

const player = (engine: PokerEngine, id: string): Player => engine.getState().players.find(p => p.id === id)!;
const dealtIn = (engine: PokerEngine, id: string) => (player(engine, id).holeCards || []).length > 0;
const blindsPostedBy = (engine: PokerEngine) =>
  engine.getState().handActions!.filter(a => a.action === 'small-blind' || a.action === 'big-blind').map(a => a.playerId);

const finishHand = (engine: PokerEngine) => {
  let guard = 20;
  while (engine.getState().stage !== 'showdown' && guard-- > 0) engine.forceFold(engine.getState().activePlayer);
  expect(engine.getState().stage).toBe('showdown');
};

const tournamentTable = (players = [mk('a', 1), mk('b', 2), mk('c', 3)]) => {
  const engine = new PokerEngine('t', players, 5, 10);
  engine.useTournamentRules();
  return engine;
};

describe('tournament rules: a player sitting out is blinded off', () => {
  test('is still dealt in, posts blinds and antes in turn and has their hands folded for them', () => {
    const engine = tournamentTable();
    engine.setAnte(1);
    engine.setSittingOut('c', true);
    const posted = new Set<string>();
    for (let hand = 0; hand < 3; hand++) {
      engine.startNewHand();
      expect(dealtIn(engine, 'c')).toBe(true);
      expect(engine.getState().handActions!.some(a => a.playerId === 'c' && a.action === 'ante')).toBe(true);
      blindsPostedBy(engine).forEach(id => posted.add(id));
      // Never asked to act: the table acts for them at once
      expect(engine.getState().activePlayer).not.toBe('c');
      finishHand(engine);
    }
    // Over a full orbit they paid both blinds like everyone else
    expect(posted.has('c')).toBe(true);
  });

  test('checks rather than folds when checking is free', () => {
    // Heads-up, the away player in the big blind: the small blind limps and the big blind checks
    const engine = tournamentTable([mk('a', 1), mk('b', 2)]);
    engine.startNewHand();
    const sb = engine.getState().activePlayer;
    const bb = sb === 'a' ? 'b' : 'a';
    engine.setSittingOut(bb, true);
    engine.handleAction({ type: 'call', playerId: sb, tableId: 't', timestamp: Date.now() } as any);
    const bbActions = engine.getState().handActions!.filter(a => a.playerId === bb && a.stage === 'preflop');
    expect(bbActions.map(a => a.action)).toContain('check');
    expect(engine.getState().stage).toBe('flop');
  });

  test('a player who goes away on their turn is acted for straight away', () => {
    const engine = tournamentTable();
    engine.startNewHand();
    const first = engine.getState().activePlayer;
    engine.setSittingOut(first, true);
    expect(engine.getState().activePlayer).not.toBe(first);
    expect(player(engine, first).isFolded).toBe(true);
  });

  test('hands are dealt even when everyone is away, so stacks keep shrinking', () => {
    const engine = tournamentTable([mk('a', 1), mk('b', 2)]);
    engine.setSittingOut('a', true);
    engine.setSittingOut('b', true);
    expect(engine.canStartNewHand()).toBe(true);
    engine.startNewHand();
    // The small blind folds to the big blind and the hand is over
    expect(engine.getState().stage).toBe('showdown');
  });

  test('coming back means playing again; nothing is owed', () => {
    const engine = tournamentTable();
    engine.setSittingOut('a', true);
    engine.startNewHand();
    finishHand(engine);
    engine.setSittingOut('a', false);
    expect(player(engine, 'a').missedBigBlind).toBeUndefined();
    expect(player(engine, 'a').waitingForBigBlind).toBeUndefined();
    engine.startNewHand();
    expect(dealtIn(engine, 'a')).toBe(true);
  });

  test('running out of time twice marks the player away', () => {
    const engine = tournamentTable();
    engine.startNewHand();
    const slow = engine.getState().activePlayer;
    for (let i = 0; i < 2; i++) {
      if (engine.getState().stage === 'showdown') { engine.startNewHand(); }
      while (engine.getState().activePlayer !== slow && engine.getState().stage !== 'showdown') {
        engine.handleAction({ type: 'fold', playerId: engine.getState().activePlayer, tableId: 't', timestamp: Date.now() } as any);
      }
      if (engine.getState().stage === 'showdown') { finishHand(engine); engine.startNewHand(); }
      while (engine.getState().activePlayer !== slow) {
        engine.handleAction({ type: 'fold', playerId: engine.getState().activePlayer, tableId: 't', timestamp: Date.now() } as any);
      }
      engine.handleTimeout(engine.getState().turnDeadline! + 1);
      if (engine.getState().stage !== 'showdown') finishHand(engine);
    }
    expect(player(engine, slow).isSittingOut).toBe(true);
    engine.startNewHand();
    expect(dealtIn(engine, slow)).toBe(true);
  });
});

describe('tournament rules: joining a table', () => {
  test('a player who sits down is dealt in from the next hand, without waiting for the big blind', () => {
    const engine = tournamentTable();
    engine.startNewHand();
    finishHand(engine);
    engine.syncSeatedPlayers([seat('a', 1), seat('b', 2), seat('c', 3), seat('n', 4)]);
    expect(player(engine, 'n').waitingForBigBlind).toBeUndefined();
    engine.startNewHand();
    expect(dealtIn(engine, 'n')).toBe(true);
  });

  test('a player seated by the tournament is away until they open the table, then plays', () => {
    const engine = tournamentTable();
    engine.startNewHand();
    finishHand(engine);
    engine.syncSeatedPlayers([seat('a', 1), seat('b', 2), seat('c', 3), seat('n', 4)]);
    expect(player(engine, 'n')).toMatchObject({ isSittingOut: true, notArrived: true });
    // Not there: blinded off, never waited on
    engine.startNewHand();
    expect(dealtIn(engine, 'n')).toBe(true);
    expect(engine.getState().activePlayer).not.toBe('n');
    finishHand(engine);
    // Their screen opens the table and sits them in
    engine.setSittingOut('n', false);
    expect(player(engine, 'n').isSittingOut).toBe(false);
    expect(player(engine, 'n').notArrived).toBeUndefined();
  });

  test('choosing to sit out after arriving is not mistaken for not having arrived', () => {
    const engine = tournamentTable();
    engine.startNewHand();
    finishHand(engine);
    engine.syncSeatedPlayers([seat('a', 1), seat('b', 2), seat('c', 3), seat('n', 4)]);
    engine.setSittingOut('n', false);
    engine.setSittingOut('n', true);
    expect(player(engine, 'n')).toMatchObject({ isSittingOut: true });
    expect(player(engine, 'n').notArrived).toBeUndefined();
  });

  test('switching a table to tournament rules deals in anyone left waiting', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 5, 10);
    engine.startNewHand();
    finishHand(engine);
    engine.syncSeatedPlayers([seat('a', 1), seat('b', 2), seat('c', 3), seat('n', 4)]);
    expect(player(engine, 'n').waitingForBigBlind).toBe(true);
    engine.useTournamentRules();
    engine.startNewHand();
    expect(dealtIn(engine, 'n')).toBe(true);
  });

  test('cash tables keep the old rules', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 5, 10);
    engine.setSittingOut('c', true);
    engine.startNewHand();
    expect(dealtIn(engine, 'c')).toBe(false);
  });
});
