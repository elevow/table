import { PokerEngine } from '../poker-engine';
import { sanitizeStateForBroadcast, sanitizeStateForPlayer } from '../state-sanitizer';
import { BASE_TURN_MS } from '../../shared/turn-clock';

const mk = (id: string, position: number, stack = 1000): any => ({
  id, name: id, position, stack, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

const act = (engine: PokerEngine, type: string, amount?: number) => {
  const s = engine.getState();
  engine.handleAction({ type, amount, playerId: s.activePlayer, tableId: s.tableId, timestamp: 0 } as any);
};

/** Check or call for whoever is to act until the stage changes. */
const passStreet = (engine: PokerEngine) => {
  const stage = engine.getState().stage;
  for (let i = 0; i < 10 && engine.getState().stage === stage; i++) {
    const s = engine.getState();
    const me = s.players.find(p => p.id === s.activePlayer)!;
    act(engine, me.currentBet < s.currentBet ? 'call' : 'check');
  }
};

let now = 1_000_000;
beforeEach(() => {
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  process.env.ENABLE_DEALER_RELATIVE_BLINDS_RING = 'true';
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.ENABLE_DEALER_RELATIVE_BLINDS_RING;
});

describe('turn clock', () => {
  it('gives each decision the base time plus the player time bank, and clears at showdown', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    let s = engine.getState();
    expect(s.turnStartedAt).toBe(now);
    expect(s.turnDeadline).toBe(now + BASE_TURN_MS + 30_000);

    now += 5_000;
    act(engine, 'fold');
    s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.turnDeadline).toBeUndefined();
  });

  it('charges time taken beyond the base time to the time bank', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    const actor = engine.getState().activePlayer;
    now += BASE_TURN_MS + 12_500;
    act(engine, 'call');
    expect(engine.getState().players.find(p => p.id === actor)!.timeBank).toBe(30 - 13);
    // The next player's clock starts fresh from now
    expect(engine.getState().turnStartedAt).toBe(now);
  });

  it('refuses to act for a player before the deadline', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    expect(() => engine.handleTimeout(now + 1_000)).toThrow('The turn has not timed out');
  });

  it('folds a player facing a bet and checks for one who is not, using up the time bank', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 1, 2);
    engine.startNewHand();
    // Preflop, the first player faces the big blind
    const first = engine.getState().activePlayer;
    const out = engine.handleTimeout(engine.getState().turnDeadline!);
    expect(out).toEqual({ playerId: first, action: 'fold', satOut: false });
    const p = engine.getState().players.find(x => x.id === first)!;
    expect(p.isFolded).toBe(true);
    expect(p.timeBank).toBe(0);

    passStreet(engine);
    expect(engine.getState().stage).toBe('flop');
    const flopActor = engine.getState().activePlayer;
    const flopOut = engine.handleTimeout(engine.getState().turnDeadline!);
    expect(flopOut.action).toBe('check');
    expect(engine.getState().players.find(x => x.id === flopActor)!.isFolded).toBe(false);
  });

  const finishHand = (engine: PokerEngine, timeOut?: string) => {
    for (let i = 0; i < 30 && engine.getState().stage !== 'showdown'; i++) {
      const s = engine.getState();
      if (s.activePlayer === timeOut) { engine.handleTimeout(s.turnDeadline!); continue; }
      act(engine, s.players.find(p => p.id === s.activePlayer)!.currentBet < s.currentBet ? 'call' : 'check');
    }
  };

  it('sits a player out from the next hand after two timeouts in a row', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 1, 2);
    engine.startNewHand();
    const victim = engine.getState().activePlayer;
    const first = engine.handleTimeout(engine.getState().turnDeadline!);
    expect(first.satOut).toBe(false);
    finishHand(engine);
    engine.startNewHand();
    finishHand(engine, victim);
    const p = engine.getState().players.find(x => x.id === victim)!;
    // Each street the player is to act on runs out again, and every one counts
    expect(p.consecutiveTimeouts).toBeGreaterThanOrEqual(2);
    expect(p.isSittingOut).toBe(true);
    engine.startNewHand();
    expect(engine.getState().players.find(x => x.id === victim)!.holeCards ?? []).toHaveLength(0);
  });

  it('resets the timeout count when the player acts', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 1, 2);
    engine.startNewHand();
    const victim = engine.getState().activePlayer;
    engine.handleTimeout(engine.getState().turnDeadline!);
    finishHand(engine);
    expect(engine.getState().players.find(x => x.id === victim)!.consecutiveTimeouts).toBe(1);
    engine.startNewHand();
    // Play until it is the victim's turn, then they act themselves
    for (let i = 0; i < 10 && engine.getState().activePlayer !== victim; i++) {
      const s = engine.getState();
      act(engine, s.players.find(x => x.id === s.activePlayer)!.currentBet < s.currentBet ? 'call' : 'check');
    }
    expect(engine.getState().activePlayer).toBe(victim);
    const s = engine.getState();
    act(engine, s.players.find(x => x.id === victim)!.currentBet < s.currentBet ? 'call' : 'check');
    const p = engine.getState().players.find(x => x.id === victim)!;
    expect(p.consecutiveTimeouts).toBe(0);
    expect(p.isSittingOut).toBeFalsy();
  });
});

describe('sitting out', () => {
  it('deals a sitting-out player no cards, charges no blinds and skips them for the button', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3), mk('d', 4)], 5, 10);
    engine.startNewHand();
    passStreet(engine);
    engine.setSittingOut('c', true);
    // The current hand is unaffected
    expect(engine.getState().players.find(p => p.id === 'c')!.isFolded).toBe(false);
    for (let i = 0; i < 20 && engine.getState().stage !== 'showdown'; i++) act(engine, 'check');

    for (let hand = 0; hand < 4; hand++) {
      engine.startNewHand();
      const s = engine.getState();
      const c = s.players.find(p => p.id === 'c')!;
      expect(c.holeCards ?? []).toHaveLength(0);
      expect(c.currentBet).toBe(0);
      expect(c.isFolded).toBe(true);
      expect(s.players[s.dealerPosition].id).not.toBe('c');
      expect(s.activePlayer).not.toBe('c');
      expect(s.pot).toBe(15);
      for (let i = 0; i < 20 && engine.getState().stage !== 'showdown'; i++) {
        const st = engine.getState();
        act(engine, st.players.find(p => p.id === st.activePlayer)!.currentBet < st.currentBet ? 'call' : 'check');
      }
    }

    engine.setSittingOut('c', false);
    engine.startNewHand();
    expect(engine.getState().players.find(p => p.id === 'c')!.holeCards).toHaveLength(2);
  });

  it('plays heads-up rules when only two of three players are sitting in', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 5, 10);
    engine.setSittingOut('b', true);
    engine.startNewHand();
    const s = engine.getState();
    const dealer = s.players[s.dealerPosition];
    // Heads-up: the button posts the small blind and acts first preflop
    expect(dealer.currentBet).toBe(5);
    expect(s.activePlayer).toBe(dealer.id);
  });

  it('will not start a hand with fewer than two players sitting in', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 5, 10);
    engine.setSittingOut('a', true);
    engine.setSittingOut('b', true);
    expect(engine.canStartNewHand()).toBe(false);
    expect(() => engine.startNewHand()).toThrow('Need at least two players sitting in');
  });
});

describe('first to act after the flop', () => {
  it('skips a small blind who folded preflop', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 1, 2);
    engine.startNewHand();
    const s0 = engine.getState();
    const smallBlind = s0.players[(s0.dealerPosition + 1) % 3].id;
    for (let i = 0; i < 6 && engine.getState().stage === 'preflop'; i++) {
      const s = engine.getState();
      const me = s.players.find(p => p.id === s.activePlayer)!;
      if (me.id === smallBlind) act(engine, 'fold');
      else act(engine, me.currentBet < s.currentBet ? 'call' : 'check');
    }
    const flop = engine.getState();
    expect(flop.stage).toBe('flop');
    expect(flop.activePlayer).not.toBe(smallBlind);
    expect(flop.players.find(p => p.id === flop.activePlayer)!.isFolded).toBe(false);
  });
});

describe('show or muck', () => {
  const playToShowdown = () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 1, 2);
    engine.startNewHand();
    for (let i = 0; i < 30 && engine.getState().stage !== 'showdown'; i++) {
      const s = engine.getState();
      act(engine, s.players.find(p => p.id === s.activePlayer)!.currentBet < s.currentBet ? 'call' : 'check');
    }
    return engine;
  };

  it('shows the winners at a contested showdown and mucks the rest', () => {
    const engine = playToShowdown();
    const s = engine.getState();
    expect(s.handWinners!.length).toBeGreaterThan(0);
    const view = sanitizeStateForBroadcast(s);
    view.players.forEach(p => {
      if (s.handWinners!.includes(p.id)) expect(p.holeCards).toHaveLength(2);
      else expect(p.holeCards).toBeUndefined();
    });
  });

  it('lets a mucked player show their cards after the hand', () => {
    const engine = playToShowdown();
    const s = engine.getState();
    const loser = s.players.find(p => !s.handWinners!.includes(p.id));
    if (!loser) return; // three-way split, nobody mucked
    engine.showCards(loser.id);
    const view = sanitizeStateForBroadcast(engine.getState());
    expect(view.players.find(p => p.id === loser.id)!.holeCards).toHaveLength(2);
  });

  it('keeps an uncontested winner hidden unless they choose to show', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    act(engine, 'fold');
    const s = engine.getState();
    const winner = s.handWinners![0];
    expect(sanitizeStateForBroadcast(s).players.find(p => p.id === winner)!.holeCards).toBeUndefined();
    engine.showCards(winner);
    expect(sanitizeStateForBroadcast(engine.getState()).players.find(p => p.id === winner)!.holeCards).toHaveLength(2);
  });

  it('only allows showing after the hand ends, and clears shown cards for the next hand', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    expect(() => engine.showCards('a')).toThrow('after the hand ends');
    act(engine, 'fold');
    engine.showCards('a');
    engine.startNewHand();
    expect(engine.getState().shownCards).toBeUndefined();
    expect(engine.getState().handWinners).toBeUndefined();
  });

  it('shows everyone still in when the hand ended all-in', () => {
    const engine = new PokerEngine('t', [mk('a', 1, 50), mk('b', 2, 50)], 1, 2);
    engine.startNewHand();
    act(engine, 'raise', 50);
    act(engine, 'call');
    // The routes deal the rest of the board; settle on the current one here
    engine.finalizeToShowdown();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    sanitizeStateForBroadcast(s).players.forEach(p => expect(p.holeCards).toHaveLength(2));
  });
});

describe('clock in client views', () => {
  it('reports the time left when the state is sent', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    engine.startNewHand();
    now += 4_000;
    const view = sanitizeStateForPlayer(engine.getState(), 'a');
    expect(view.turnTimeRemainingMs).toBe(BASE_TURN_MS + 30_000 - 4_000);
  });
});
