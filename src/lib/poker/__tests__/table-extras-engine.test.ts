import { PokerEngine } from '../poker-engine';
import { BASE_TURN_MS } from '../../shared/turn-clock';

const mk = (id: string, position: number, stack = 1000): any => ({
  id, name: id, position, stack, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

const act = (engine: PokerEngine, type: string, amount?: number) => {
  const s = engine.getState();
  engine.handleAction({ type, amount, playerId: s.activePlayer, tableId: s.tableId, timestamp: 0 } as any);
};

const playOut = (engine: PokerEngine) => {
  for (let i = 0; i < 40 && engine.getState().stage !== 'showdown'; i++) {
    const s = engine.getState();
    act(engine, s.players.find(p => p.id === s.activePlayer)!.currentBet < s.currentBet ? 'call' : 'check');
  }
};

let now = 2_000_000;
beforeEach(() => {
  now = 2_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  process.env.ENABLE_DEALER_RELATIVE_BLINDS_RING = 'true';
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.ENABLE_DEALER_RELATIVE_BLINDS_RING;
});

describe('hand log', () => {
  it('gives each hand an id and number and logs every action with the chips it put in', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 5, 10);
    engine.startNewHand();
    const first = engine.getState();
    expect(first.handId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.handNumber).toBe(1);
    expect(first.handActions!.map(a => a.action)).toEqual(['small-blind', 'big-blind']);

    playOut(engine);
    const s = engine.getState();
    const puts = s.handActions!.reduce((sum, a) => sum + a.put, 0);
    expect(puts).toBe(s.handResult!.pot);
    expect(s.handResult!.pot).toBe(30);
    const winnings = Object.values(s.handResult!.winnings).reduce((x, y) => x + y, 0);
    expect(winnings).toBe(30);

    engine.startNewHand();
    expect(engine.getState().handNumber).toBe(2);
    expect(engine.getState().handId).not.toBe(first.handId);
  });

  it('marks actions taken by the clock', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 5, 10);
    engine.startNewHand();
    engine.handleTimeout(engine.getState().turnDeadline!);
    const last = engine.getState().handActions!.slice(-1)[0];
    expect(last).toMatchObject({ action: 'fold', auto: true, put: 0 });
  });
});

describe('pause', () => {
  it('stops actions and the clock, and resumes with the time that was left', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 5, 10);
    engine.startNewHand();
    const deadline = engine.getState().turnDeadline!;
    now += 10_000;
    engine.setPaused(true);
    expect(engine.getState().turnDeadline).toBeUndefined();
    expect(() => act(engine, 'call')).toThrow('paused');

    now += 60_000; // a long pause
    engine.setPaused(false);
    const resumed = engine.getState();
    expect(resumed.turnDeadline).toBe(deadline + 60_000);
    // Time spent paused is not charged to the time bank
    now += BASE_TURN_MS - 10_000 + 1_000;
    const actor = resumed.activePlayer;
    act(engine, 'call');
    expect(engine.getState().players.find(p => p.id === actor)!.timeBank).toBe(29);
  });

  it('will not start a hand while paused', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 5, 10);
    engine.setPaused(true);
    expect(() => engine.startNewHand()).toThrow('paused');
  });
});

describe('blinds change', () => {
  it('applies new blinds from the next hand', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 5, 10);
    engine.startNewHand();
    engine.setPendingBlinds(10, 20);
    expect(engine.getState().bigBlind).toBe(10);
    playOut(engine);
    engine.startNewHand();
    const s = engine.getState();
    expect(s.bigBlind).toBe(20);
    expect(s.pot).toBe(30);
    expect(s.pendingBlinds).toBeUndefined();
  });
});

describe('straddle', () => {
  it('lets the under-the-gun player post twice the big blind and act last preflop', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3), mk('d', 4)], 5, 10);
    engine.setAllowStraddle(true);
    // The button moves to index 1 on the first hand, so under the gun is index (1 + 3) % 4 = 0
    engine.setWantsStraddle('a', true);
    engine.startNewHand();
    const s = engine.getState();
    expect(s.straddle).toEqual({ playerId: 'a', amount: 20 });
    expect(s.currentBet).toBe(20);
    expect(s.pot).toBe(35);
    expect(s.activePlayer).not.toBe('a');
    expect(s.players.find(p => p.id === 'a')!.wantsStraddle).toBeUndefined();

    // Everyone calls; the straddler then has the option
    for (let i = 0; i < 3; i++) act(engine, 'call');
    expect(engine.getState().activePlayer).toBe('a');
  });

  it('is refused when the table does not allow it', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 5, 10);
    expect(() => engine.setWantsStraddle('a', true)).toThrow('not allowed');
  });
});

describe('bomb pot', () => {
  it('takes an ante from everyone and starts betting on the flop', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 5, 10);
    engine.setBombPotNext(2);
    engine.startNewHand();
    const s = engine.getState();
    expect(s.handKind).toBe('bomb-pot');
    expect(s.stage).toBe('flop');
    expect(s.communityCards).toHaveLength(3);
    expect(s.pot).toBe(60);
    expect(s.currentBet).toBe(0);
    expect(s.players.every(p => p.stack === 980)).toBe(true);
    expect(s.handActions!.filter(a => a.action === 'ante')).toHaveLength(3);
    expect(s.bombPotNext).toBeNull();

    playOut(engine);
    engine.startNewHand();
    expect(engine.getState().handKind).toBe('normal');
  });

  it('settles straight away when the antes put players all-in', () => {
    const engine = new PokerEngine('t', [mk('a', 1, 20), mk('b', 2, 20)], 5, 10);
    engine.setBombPotNext(2);
    engine.startNewHand();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.communityCards).toHaveLength(5);
    expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(40);
  });
});
