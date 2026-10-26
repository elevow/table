import { PokerEngine } from '../poker-engine';
import { bankTimeMs, clampSetting, turnTimeMs } from '../../shared/turn-clock';

const mk = (id: string, position: number): any => ({
  id, name: id, position, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

const act = (engine: PokerEngine, type: string) => {
  const s = engine.getState();
  engine.handleAction({ type, playerId: s.activePlayer, tableId: s.tableId, timestamp: 0 } as any);
};

let now = 3_000_000;
beforeEach(() => {
  now = 3_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

/** Heads-up table with 20s turns and 2 time banks of 15s each. */
function table() {
  const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
  engine.configureClock({ turnSeconds: 20, timeBanks: 2, timeBankSeconds: 15 });
  return engine;
}

describe('table clock settings', () => {
  it('gives each decision the table turn time plus the player\'s time banks', () => {
    const engine = table();
    engine.startNewHand();
    const s = engine.getState();
    expect(s.players.every(p => p.timeBanks === 2)).toBe(true);
    expect(s.turnDeadline).toBe(now + 20_000 + 2 * 15_000);
  });

  it('uses one time bank for each started bank period beyond the turn time', () => {
    const engine = table();
    engine.startNewHand();
    const actor = engine.getState().activePlayer;
    now += 20_000 + 1_000; // one second into the first time bank
    act(engine, 'call');
    expect(engine.getState().players.find(p => p.id === actor)!.timeBanks).toBe(1);
  });

  it('keeps time banks when the player acts within the turn time', () => {
    const engine = table();
    engine.startNewHand();
    const actor = engine.getState().activePlayer;
    now += 19_000;
    act(engine, 'call');
    expect(engine.getState().players.find(p => p.id === actor)!.timeBanks).toBe(2);
  });

  it('uses up every time bank when the clock runs out', () => {
    const engine = table();
    engine.startNewHand();
    const actor = engine.getState().activePlayer;
    engine.handleTimeout(engine.getState().turnDeadline!);
    expect(engine.getState().players.find(p => p.id === actor)!.timeBanks).toBe(0);
  });

  it('applies a new turn time from the next decision', () => {
    const engine = table();
    engine.startNewHand();
    engine.setTurnTime(45);
    act(engine, 'call');
    expect(engine.getState().turnDeadline).toBe(now + 45_000 + 2 * 15_000);
  });

  it('keeps settings within their limits', () => {
    const engine = table();
    engine.setTurnTime(2);
    expect(engine.getState().turnTimeMs).toBe(10_000);
    engine.configureClock({ timeBanks: 99, timeBankSeconds: 1000 });
    expect(engine.getState().players[0].timeBanks).toBe(20);
    expect(engine.getState().timeBankSeconds).toBe(120);
  });
});

describe('host adjusting time banks', () => {
  it('adds and removes time banks, never below zero', () => {
    const engine = table();
    expect(engine.adjustTimeBanks('a', 3)).toBe(5);
    expect(engine.adjustTimeBanks('a', -10)).toBe(0);
  });

  it('moves the clock of a player who is deciding right now', () => {
    const engine = table();
    engine.startNewHand();
    const actor = engine.getState().activePlayer;
    const before = engine.getState().turnDeadline!;
    engine.adjustTimeBanks(actor, 1);
    expect(engine.getState().turnDeadline).toBe(before + 15_000);
    engine.adjustTimeBanks(actor, -2);
    expect(engine.getState().turnDeadline).toBe(before - 15_000);
  });

  it('adjusts the time held while the game is paused', () => {
    const engine = table();
    engine.startNewHand();
    const actor = engine.getState().activePlayer;
    engine.setPaused(true);
    const held = engine.getState().pausedTurnRemainingMs!;
    engine.adjustTimeBanks(actor, 1);
    expect(engine.getState().pausedTurnRemainingMs).toBe(held + 15_000);
  });

  it('starts from the seconds a player had in a game saved before time banks were counted', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
    // No configureClock: legacy players carry 30 seconds and the default bank length is 30s
    expect(engine.adjustTimeBanks('a', 1)).toBe(2);
  });
});

describe('clock helpers', () => {
  it('fall back to the defaults and to legacy seconds', () => {
    expect(turnTimeMs({})).toBe(30_000);
    expect(bankTimeMs({ timeBank: 12 }, {})).toBe(12_000);
    expect(bankTimeMs({ timeBanks: 3, timeBank: 12 }, { timeBankSeconds: 10 })).toBe(30_000);
    expect(clampSetting('abc', 1, 5, 3)).toBe(3);
    expect(clampSetting(7.6, 1, 5, 3)).toBe(5);
  });
});
