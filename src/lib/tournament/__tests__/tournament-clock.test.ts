import { TournamentManager } from '../tournament-manager';
import { MemoryTournamentStore } from '../tournament-store';
import { breakTimeRemainingMs, levelTimeRemainingMs } from '../tournament-clock';
import type { TournamentConfig } from '../../../types/tournament';

const MIN = 60_000;

// Levels of 10, 10, 15 and 20 minutes, with a 5-minute break after level 2
const config = (): TournamentConfig => ({
  type: 'freezeout',
  blindLevels: [
    { level: 1, durationMinutes: 10, smallBlind: 25, bigBlind: 50 },
    { level: 2, durationMinutes: 10, smallBlind: 50, bigBlind: 100 },
    { level: 3, durationMinutes: 15, smallBlind: 75, bigBlind: 150, ante: 25 },
    { level: 4, durationMinutes: 20, smallBlind: 100, bigBlind: 200, ante: 25 },
  ],
  startingStack: 10000,
  payoutStructure: [{ place: 1, percentage: 100 }],
  breaks: [{ afterLevel: 2, durationMinutes: 5 }],
  lateRegistration: { enabled: false, endLevel: 0, endTime: 0 },
});

async function setup(changes: Partial<TournamentConfig> = {}) {
  let now = 1_000_000;
  const clock = { advance: (ms: number) => (now += ms), now: () => now };
  const mgr = new TournamentManager(new MemoryTournamentStore(), Math.random, clock.now);
  const t = await mgr.create({ name: 'Clocked', config: { ...config(), ...changes } });
  await mgr.register({ tournamentId: t.id, userId: 'a' });
  await mgr.register({ tournamentId: t.id, userId: 'b' });
  await mgr.start(t.id);
  const read = async () => (await mgr.get(t.id))!;
  return { mgr, id: t.id, clock, read };
}

describe('tournament clock', () => {
  test('levels advance on their own when their time runs out', async () => {
    const { clock, read } = await setup();
    clock.advance(9 * MIN);
    let t = await read();
    expect(t.currentLevelIndex).toBe(0);
    expect(levelTimeRemainingMs(t, clock.now())).toBe(1 * MIN);

    clock.advance(1 * MIN);
    t = await read();
    expect(t.currentLevelIndex).toBe(1);
    expect(levelTimeRemainingMs(t, clock.now())).toBe(10 * MIN);
  });

  test('a scheduled break starts and ends on its own, then the next level gets its full time', async () => {
    const { clock, read } = await setup();
    clock.advance(20 * MIN + 2 * MIN); // levels 1 and 2 done, 2 minutes into the break
    let t = await read();
    expect(t.status).toBe('on-break');
    expect(t.currentBreakAfterLevel).toBe(2);
    expect(breakTimeRemainingMs(t, clock.now())).toBe(3 * MIN);
    expect(levelTimeRemainingMs(t, clock.now())).toBeNull();

    clock.advance(3 * MIN);
    t = await read();
    expect(t.status).toBe('running');
    expect(t.currentLevelIndex).toBe(2);
    expect(levelTimeRemainingMs(t, clock.now())).toBe(15 * MIN);
  });

  test('catching up after a long quiet spell lands where watching would have', async () => {
    const { clock, read } = await setup();
    // 10 + 10 + 5 (break) + 15 = 40 minutes reaches level 4; 7 more minutes into it
    clock.advance(47 * MIN);
    const t = await read();
    expect(t.status).toBe('running');
    expect(t.currentLevelIndex).toBe(3);
    expect(levelTimeRemainingMs(t, clock.now())).toBe(13 * MIN);
  });

  test('the last level plays on until there is a winner', async () => {
    const { mgr, id, clock, read } = await setup();
    clock.advance(10 * 60 * MIN);
    const t = await read();
    expect(t.status).toBe('running');
    expect(t.currentLevelIndex).toBe(3);
    expect(levelTimeRemainingMs(t, clock.now())).toBe(0);
    await expect(mgr.advanceLevel(id)).rejects.toThrow('Already at the last blind level');
  });

  test('time spent paused does not count', async () => {
    const { mgr, id, clock, read } = await setup();
    clock.advance(4 * MIN);
    await mgr.pause(id);
    clock.advance(30 * MIN);
    let t = await read();
    expect(t.status).toBe('paused');
    expect(t.currentLevelIndex).toBe(0);
    expect(levelTimeRemainingMs(t, clock.now())).toBe(6 * MIN);

    await mgr.resume(id);
    clock.advance(6 * MIN);
    t = await read();
    expect(t.currentLevelIndex).toBe(1);
  });

  test('pausing during a break keeps the break time left', async () => {
    const { mgr, id, clock, read } = await setup();
    clock.advance(21 * MIN); // 1 minute into the break
    await mgr.pause(id);
    clock.advance(60 * MIN);
    let t = await read();
    expect(t.status).toBe('paused');
    expect(breakTimeRemainingMs(t, clock.now())).toBe(4 * MIN);

    t = await mgr.resume(id);
    expect(t.status).toBe('on-break');
    clock.advance(4 * MIN);
    t = await read();
    expect(t.status).toBe('running');
    expect(t.currentLevelIndex).toBe(2);
  });

  test('ending a paused break leaves the tournament paused with the next level unplayed', async () => {
    const { mgr, id, clock } = await setup();
    clock.advance(21 * MIN);
    await mgr.pause(id);
    let t = await mgr.endBreak(id);
    expect(t.status).toBe('paused');
    expect(t.onBreak).toBe(false);
    t = await mgr.resume(id);
    expect(t.status).toBe('running');
    expect(levelTimeRemainingMs(t, clock.now())).toBe(15 * MIN);
  });

  test('a director can move on early; the next level starts its full time then', async () => {
    const { mgr, id, clock } = await setup();
    clock.advance(3 * MIN);
    let t = await mgr.advanceLevel(id);
    expect(t.currentLevelIndex).toBe(1);
    expect(levelTimeRemainingMs(t, clock.now())).toBe(10 * MIN);

    t = await mgr.advanceLevel(id); // into the break after level 2
    expect(t.status).toBe('on-break');
    t = await mgr.endBreak(id);
    expect(t.status).toBe('running');
    expect(levelTimeRemainingMs(t, clock.now())).toBe(15 * MIN);
  });

  test('the clock stops when the tournament ends', async () => {
    const { mgr, id, clock, read } = await setup();
    await mgr.eliminate({ tournamentId: id, userId: 'b' });
    clock.advance(60 * MIN);
    const t = await read();
    expect(t.status).toBe('completed');
    expect(t.currentLevelIndex).toBe(0);
    expect(levelTimeRemainingMs(t, clock.now())).toBeNull();
  });

  test('a paused tournament has to be resumed, not started again', async () => {
    const { mgr, id } = await setup();
    await mgr.pause(id);
    await expect(mgr.start(id)).rejects.toThrow('resume it instead');
  });
});

describe('levels moved on by the director', () => {
  const directed = () => setup({ levelControl: 'director' });

  test('the level clock counts down to zero and waits there', async () => {
    const { clock, read } = await directed();
    clock.advance(25 * MIN);
    const t = await read();
    expect(t.currentLevelIndex).toBe(0);
    expect(t.status).toBe('running');
    expect(levelTimeRemainingMs(t, clock.now())).toBe(0);
  });

  test('the director starts the break, which waits for them to end it', async () => {
    const { mgr, id, clock, read } = await directed();
    clock.advance(12 * MIN);
    await mgr.advanceLevel(id);
    clock.advance(11 * MIN);
    await mgr.advanceLevel(id);
    let t = await read();
    expect(t.status).toBe('on-break');
    expect(t.currentLevelIndex).toBe(2);

    clock.advance(30 * MIN);
    t = await read();
    expect(t.status).toBe('on-break');
    expect(breakTimeRemainingMs(t, clock.now())).toBe(0);

    await mgr.endBreak(id);
    t = await read();
    expect(t.status).toBe('running');
    // Level 3 gets its full time from when the director ended the break
    expect(levelTimeRemainingMs(t, clock.now())).toBe(15 * MIN);
  });

  test('pausing and resuming still work', async () => {
    const { mgr, id, clock, read } = await directed();
    clock.advance(4 * MIN);
    await mgr.pause(id);
    clock.advance(60 * MIN);
    await mgr.resume(id);
    const t = await read();
    expect(t.currentLevelIndex).toBe(0);
    expect(levelTimeRemainingMs(t, clock.now())).toBe(6 * MIN);
  });
});
