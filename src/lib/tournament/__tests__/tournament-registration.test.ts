import { TournamentManager, registrationOpen } from '../tournament-manager';
import { MemoryTournamentStore } from '../tournament-store';
import { scheduleElapsedMs } from '../tournament-clock';
import { createDefaultFreezeoutConfig, createRebuyAddOnConfig } from '../tournament-utils';
import type { TournamentConfig } from '../../../types/tournament';

const MIN = 60_000;

// 12-minute levels 1-4 with a 10-minute break after level 2
const config = (lateRegistration: TournamentConfig['lateRegistration']): TournamentConfig => ({
  ...createDefaultFreezeoutConfig(),
  lateRegistration,
});

async function started(cfg: TournamentConfig, players = ['a', 'b']) {
  let now = 2_000_000;
  const clock = { advance: (ms: number) => (now += ms), now: () => now };
  const mgr = new TournamentManager(new MemoryTournamentStore(), Math.random, clock.now);
  const { id } = await mgr.create({ name: 'Late', config: cfg });
  for (const userId of players) await mgr.register({ tournamentId: id, userId });
  await mgr.start(id);
  return { mgr, id, clock, read: async () => (await mgr.get(id))! };
}

describe('late registration', () => {
  test('stays open through the last late level and the break after it, then closes', async () => {
    const { mgr, id, clock, read } = await started(config({ enabled: true, endLevel: 2, endTime: 600 }));
    clock.advance(20 * MIN); // level 2
    await mgr.register({ tournamentId: id, userId: 'c' });
    clock.advance(9 * MIN); // 5 minutes into the break after level 2
    expect((await read()).status).toBe('on-break');
    await mgr.register({ tournamentId: id, userId: 'd' });
    clock.advance(5 * MIN); // level 3
    await expect(mgr.register({ tournamentId: id, userId: 'e' })).rejects.toThrow('Late registration has closed');
    const t = await read();
    expect(t.registeredPlayers).toEqual(['a', 'b', 'c', 'd']);
    expect(t.tables.flatMap(tb => tb.seats).filter(Boolean).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('closes at its time limit of tournament time, not counting pauses', async () => {
    const { mgr, id, clock } = await started(config({ enabled: true, endLevel: 4, endTime: 30 }));
    clock.advance(10 * MIN);
    await mgr.pause(id);
    clock.advance(60 * MIN); // paused time doesn't count
    await mgr.resume(id);
    await mgr.register({ tournamentId: id, userId: 'c' }); // 10 minutes in
    clock.advance(21 * MIN); // 31 minutes in: level 2 done, 7 minutes into the break
    await expect(mgr.register({ tournamentId: id, userId: 'd' })).rejects.toThrow('Late registration has closed');
  });

  test('is open while paused, if the window is', async () => {
    const { mgr, id } = await started(config({ enabled: true, endLevel: 2, endTime: 600 }));
    await mgr.pause(id);
    await mgr.register({ tournamentId: id, userId: 'c' });
  });

  test('without late registration, entries close at the start', async () => {
    const { mgr, id } = await started(config({ enabled: false, endLevel: 0, endTime: 0 }));
    await expect(mgr.register({ tournamentId: id, userId: 'c' })).rejects.toThrow('Late registration has closed');
  });

  test('a finished tournament takes no entries', async () => {
    const { mgr, id, read } = await started(config({ enabled: true, endLevel: 4, endTime: 600 }));
    await mgr.eliminate({ tournamentId: id, userId: 'b' });
    expect(registrationOpen(await read(), Date.now())).toBe(false);
    await expect(mgr.register({ tournamentId: id, userId: 'c' })).rejects.toThrow('Late registration has closed');
  });
});

describe('scheduleElapsedMs', () => {
  test('counts levels and breaks played, but not pauses', async () => {
    const { mgr, id, clock, read } = await started(config({ enabled: false, endLevel: 0, endTime: 0 }));
    clock.advance(5 * MIN);
    expect(scheduleElapsedMs(await read(), clock.now())).toBe(5 * MIN);
    await mgr.pause(id);
    clock.advance(30 * MIN);
    expect(scheduleElapsedMs(await read(), clock.now())).toBe(5 * MIN);
    await mgr.resume(id);
    clock.advance(19 * MIN + 4 * MIN); // levels 1-2 done, 4 minutes into the break
    expect(scheduleElapsedMs(await read(), clock.now())).toBe(28 * MIN);
  });
});

describe('unregistering', () => {
  test('takes the entry back before the start, bounty and all', async () => {
    let now = 1_000;
    const mgr = new TournamentManager(new MemoryTournamentStore(), Math.random, () => now);
    const cfg = { ...createDefaultFreezeoutConfig(), buyIn: 10, bounty: { amount: 2, type: 'standard' as const } };
    const { id } = await mgr.create({ name: 'U', config: cfg });
    await mgr.register({ tournamentId: id, userId: 'a' });
    await mgr.register({ tournamentId: id, userId: 'b' });
    const t = await mgr.unregister({ tournamentId: id, userId: 'b' });
    expect(t.registeredPlayers).toEqual(['a']);
    expect(t.bounties).toEqual({ a: 2 });
    expect(t.registrationTimeline!.map(e => e.userId)).toEqual(['a']);
    // Unregistering someone who isn't registered does nothing
    await mgr.unregister({ tournamentId: id, userId: 'zed' });
    now += 1;
  });

  test('is refused once the tournament has started', async () => {
    const { mgr, id } = await started(createDefaultFreezeoutConfig());
    await expect(mgr.unregister({ tournamentId: id, userId: 'a' })).rejects.toThrow('only unregister before the tournament starts');
  });
});

describe('listing', () => {
  test('lists tournaments in the given statuses, newest first', async () => {
    let now = 1_000;
    const mgr = new TournamentManager(new MemoryTournamentStore(), Math.random, () => now);
    const first = await mgr.create({ name: 'First', config: createDefaultFreezeoutConfig() });
    now += 1000;
    const second = await mgr.create({ name: 'Second', config: createDefaultFreezeoutConfig() });
    for (const userId of ['a', 'b']) await mgr.register({ tournamentId: second.id, userId });
    await mgr.start(second.id);

    expect((await mgr.list(['setup'])).map(t => t.name)).toEqual(['First']);
    expect((await mgr.list(['setup', 'running'])).map(t => t.name)).toEqual(['Second', 'First']);
    expect((await mgr.list(['setup', 'running'], 1)).map(t => t.id)).toEqual([second.id]);
    expect(first.id).toBeTruthy();
  });
});

describe('add-on', () => {
  test('is refused to a busted player', async () => {
    let now = 1_000;
    const mgr = new TournamentManager(new MemoryTournamentStore(), Math.random, () => now);
    const { id } = await mgr.create({ name: 'A', config: createRebuyAddOnConfig() }); // add-on at the break after level 3
    for (const userId of ['a', 'b', 'c']) await mgr.register({ tournamentId: id, userId });
    await mgr.start(id);
    await mgr.eliminate({ tournamentId: id, userId: 'c' });
    now += 36 * MIN; // three 12-minute levels: on the break
    await expect(mgr.addOn({ tournamentId: id, userId: 'c' })).rejects.toThrow("Busted players can't take the add-on");
    await mgr.addOn({ tournamentId: id, userId: 'a' });
  });
});
