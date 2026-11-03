import { TournamentManager } from '../tournament-manager';
import { MemoryTournamentStore } from '../tournament-store';
import { buildTournamentView } from '../tournament-view';
import { createDefaultFreezeoutConfig } from '../tournament-utils';
import { formatClock, formatMoney } from '../format';

const MIN = 60_000;
const names = { a: 'Alice', b: 'Bob', c: 'Cara', d: 'Dev' };

async function setup(config = { ...createDefaultFreezeoutConfig(), buyIn: 10, bounty: { amount: 2, type: 'progressive' as const } }) {
  let now = 1_000_000;
  const mgr = new TournamentManager(new MemoryTournamentStore(), Math.random, () => now);
  const { id } = await mgr.create({ name: 'Friday KO', config });
  for (const userId of ['a', 'b', 'c', 'd']) await mgr.register({ tournamentId: id, userId });
  return {
    mgr, id,
    advance: (ms: number) => (now += ms),
    view: async (viewer: string | null = null) => buildTournamentView((await mgr.get(id))!, now, viewer, names),
  };
}

describe('buildTournamentView', () => {
  test('before the start it shows the first level and registrations', async () => {
    const { view } = await setup();
    const v = await view('a');
    expect(v.status).toBe('setup');
    expect(v.level).toBeNull();
    expect(v.nextLevel).toEqual({ number: 1, smallBlind: 100, bigBlind: 200, ante: null, minutes: 12 });
    expect(v.players).toEqual({ entrants: 4, entries: 4, remaining: 4, paidPlaces: 3 });
    expect(v.you).toMatchObject({ eliminated: false, table: null, bounty: 2 });
  });

  test('during play it shows the clock, money, average stack and the viewer\'s seat', async () => {
    const { mgr, id, advance, view } = await setup();
    await mgr.start(id);
    advance(5 * MIN);
    const v = await view('b');
    expect(v.level).toMatchObject({ number: 1, smallBlind: 100, bigBlind: 200 });
    expect(v.nextLevel).toMatchObject({ number: 2 });
    expect(v.levelRemainingMs).toBe(7 * MIN);
    expect(v.prizePool).toBe(40);
    expect(v.payouts).toEqual([
      { place: 1, percentage: 50, amount: 20 },
      { place: 2, percentage: 30, amount: 12 },
      { place: 3, percentage: 20, amount: 8 },
    ]);
    expect(v.chipsInPlay).toBe(80000);
    expect(v.averageStack).toBe(20000);
    expect(v.you!.table).toBe(1);
    expect(v.you!.seat).toBeGreaterThanOrEqual(1);
  });

  test('knockouts show on the bounty board and in the results with prizes', async () => {
    const { mgr, id, view } = await setup();
    await mgr.start(id);
    await mgr.eliminate({ tournamentId: id, userId: 'd', eliminatedBy: 'a' }); // a: $1 cash, bounty $3
    await mgr.eliminate({ tournamentId: id, userId: 'c', eliminatedBy: 'b' }); // 3rd: $8
    const v = await view('c');
    expect(v.bounty!.board).toEqual([
      { userId: 'a', name: 'Alice', won: 1, bounty: 3 },
      { userId: 'b', name: 'Bob', won: 1, bounty: 3 },
    ]);
    expect(v.finishers).toEqual([
      { place: 3, userId: 'c', name: 'Cara', prize: 8, eliminatedBy: 'b', removed: false },
      { place: 4, userId: 'd', name: 'Dev', prize: 0, eliminatedBy: 'a', removed: false },
    ]);
    expect(v.you).toMatchObject({ eliminated: true, place: 3, table: null, bounty: null, bountyWon: 0 });
    expect(v.averageStack).toBe(40000);
  });

  test('at the end the winner is listed first and the clock is off', async () => {
    const { mgr, id, view } = await setup();
    await mgr.start(id);
    for (const [out, by] of [['d', 'a'], ['c', 'a'], ['b', 'a']]) await mgr.eliminate({ tournamentId: id, userId: out, eliminatedBy: by });
    const v = await view('a');
    expect(v.status).toBe('completed');
    expect(v.finishers[0]).toEqual({ place: 1, userId: 'a', name: 'Alice', prize: 20, eliminatedBy: null, removed: false });
    expect(v.you).toMatchObject({ place: 1, bountyWon: 8 });
    expect(v.levelRemainingMs).toBeNull();
  });

  test('down to one player with rebuys still open, it says the tournament waits on them', async () => {
    const cfg = { ...createDefaultFreezeoutConfig(), type: 'rebuy' as const, rebuys: { enabled: true, cost: 10, stack: 20000 } };
    const { mgr, id, view } = await setup(cfg);
    expect((await view()).rebuysOpen).toBe(false);
    await mgr.start(id);
    expect(await view()).toMatchObject({ rebuysOpen: true, waitingOnRebuys: false });
    for (const out of ['d', 'c', 'b']) await mgr.eliminate({ tournamentId: id, userId: out });
    expect(await view()).toMatchObject({ status: 'running', rebuysOpen: true, waitingOnRebuys: true });
    await mgr.closeRebuys(id);
    expect(await view()).toMatchObject({ status: 'completed', rebuysOpen: false, waitingOnRebuys: false });
  });

  test('players without a known name get a placeholder, and guests have no "you"', async () => {
    const { mgr, id } = await setup();
    const t = (await mgr.get(id))!;
    const v = buildTournamentView(t, Date.now(), null, {});
    expect(v.you).toBeNull();
    expect(v.bounty!.board.map(b => b.name)).toContain('Player a');
  });
});

describe('formatting', () => {
  test.each([[2, '$2'], [2.5, '$2.50'], [1234.5, '$1,234.50']])('formatMoney(%p) is %p', (n, s) => {
    expect(formatMoney(n)).toBe(s);
  });

  test.each([[0, '0:00'], [65_000, '1:05'], [59_001, '1:00'], [3_725_000, '1:02:05']])('formatClock(%p) is %p', (ms, s) => {
    expect(formatClock(ms)).toBe(s);
  });
});

describe('chip counts', () => {
  test('rank the players still in by stack, counting chips not yet at a table, and show the viewer theirs', async () => {
    const { mgr, id, view } = await setup();
    await mgr.start(id);
    // The tables took their starting stacks
    await mgr.ackChips({ tournamentId: id, delivered: { a: 20000, b: 20000, c: 20000, d: 20000 } });
    await mgr.reportHand({ tournamentId: id, stacks: { a: 50000, b: 12000, c: 18000, d: 0 }, busted: [{ userId: 'd', eliminatedBy: 'a' }] });
    const v = await view('c');
    expect(v.chipCounts.map(c => [c.name, c.chips])).toEqual([['Alice', 50000], ['Cara', 18000], ['Bob', 12000]]);
    expect(v.you).toMatchObject({ chips: 18000, roomId: null });
    expect(v.tables[0].roomId).toBeNull();
  });
});
