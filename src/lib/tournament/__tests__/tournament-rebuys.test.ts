import { TournamentManager, rebuyPeriodOpen } from '../tournament-manager';
import { MemoryTournamentStore } from '../tournament-store';
import { createRebuyAddOnConfig } from '../tournament-utils';
import type { TournamentConfig } from '../../../types/tournament';

const MIN = 60_000;

// 12-minute levels 1-5; rebuys (up to 2) through level 2 and the 10-minute break after it
const config = (rebuys: Partial<NonNullable<TournamentConfig['rebuys']>> = {}): TournamentConfig => {
  const cfg = createRebuyAddOnConfig();
  return {
    ...cfg,
    breaks: [{ afterLevel: 2, durationMinutes: 10 }],
    addOn: { ...cfg.addOn!, availableAtBreakAfterLevel: 2 },
    rebuys: { ...cfg.rebuys!, availableUntilLevel: 2, ...rebuys },
  };
};

async function started(players: string[], cfg = config()) {
  let now = 5_000_000;
  const clock = { advance: (ms: number) => (now += ms) };
  const mgr = new TournamentManager(new MemoryTournamentStore(), Math.random, () => now);
  const { id } = await mgr.create({ name: 'Rebuy', config: cfg });
  for (const userId of players) await mgr.register({ tournamentId: id, userId });
  await mgr.start(id);
  const read = async () => (await mgr.get(id))!;
  return { mgr, id, clock, read };
}

const seated = (t: { tables: { seats: (string | null)[] }[] }) => t.tables.flatMap(tb => tb.seats.filter(Boolean));

describe('rebuys', () => {
  test('the director can close rebuys, which ends a tournament down to one player', async () => {
    // Rebuys with no last level would otherwise stay open for good
    const { mgr, id, read } = await started(['a', 'b'], config({ availableUntilLevel: undefined }));
    await mgr.eliminate({ tournamentId: id, userId: 'b' });
    expect((await read()).status).toBe('running');
    expect(rebuyPeriodOpen(await read())).toBe(true);

    const t = await mgr.closeRebuys(id);
    expect(t.status).toBe('completed');
    expect(rebuyPeriodOpen(t)).toBe(false);
    await expect(mgr.rebuy({ tournamentId: id, userId: 'b' })).rejects.toThrow();
    await expect(mgr.closeRebuys(id)).rejects.toThrow('Rebuys can only be closed while the tournament is on');
  });

  test('closing rebuys with several players left just stops rebuys', async () => {
    const { mgr, id } = await started(['a', 'b', 'c']);
    await mgr.eliminate({ tournamentId: id, userId: 'c' });
    const t = await mgr.closeRebuys(id);
    expect(t.status).toBe('running');
    await expect(mgr.rebuy({ tournamentId: id, userId: 'c' })).rejects.toThrow('Rebuy period ended');
    await expect(mgr.closeRebuys(id)).rejects.toThrow('Rebuys are already closed');
  });

  test('a busted player who rebuys is back in the field with a seat', async () => {
    const { mgr, id } = await started(['a', 'b', 'c']);
    await mgr.eliminate({ tournamentId: id, userId: 'c' });
    const t = await mgr.rebuy({ tournamentId: id, userId: 'c' });
    expect(t.eliminatedPlayers).toEqual([]);
    expect(t.eliminationRecords).toEqual([]);
    expect(seated(t).sort()).toEqual(['a', 'b', 'c']);
    expect(t.registrationTimeline!.filter(e => e.type === 'rebuy')).toHaveLength(1);

    // Busting again records the place at that point
    const out = await mgr.eliminate({ tournamentId: id, userId: 'c' });
    expect(out.eliminationRecords).toEqual([expect.objectContaining({ userId: 'c', place: 3 })]);
  });

  test('rebuys stay open through the break after the last rebuy level, then close', async () => {
    const { mgr, id, clock, read } = await started(['a', 'b', 'c', 'd']);
    clock.advance(24 * MIN + 5 * MIN); // levels 1-2 done, halfway through the break
    expect((await read()).status).toBe('on-break');
    await mgr.eliminate({ tournamentId: id, userId: 'd' });
    await mgr.rebuy({ tournamentId: id, userId: 'd' });

    clock.advance(5 * MIN); // break over, level 3 under way
    const t = await read();
    expect(t.currentLevelIndex).toBe(2);
    expect(rebuyPeriodOpen(t)).toBe(false);
    await mgr.eliminate({ tournamentId: id, userId: 'c' });
    await expect(mgr.rebuy({ tournamentId: id, userId: 'c' })).rejects.toThrow('Rebuy period ended');
    expect((await read()).eliminatedPlayers).toEqual(['c']);
  });

  test('the per-player limit counts returns', async () => {
    const { mgr, id } = await started(['a', 'b', 'c'], config({ maxPerPlayer: 1 }));
    await mgr.eliminate({ tournamentId: id, userId: 'c' });
    await mgr.rebuy({ tournamentId: id, userId: 'c' });
    await mgr.eliminate({ tournamentId: id, userId: 'c' });
    await expect(mgr.rebuy({ tournamentId: id, userId: 'c' })).rejects.toThrow('Rebuy limit reached');
  });

  test('with no last rebuy level, rebuys stay open all tournament', async () => {
    const { mgr, id, clock } = await started(['a', 'b', 'c'], config({ availableUntilLevel: undefined }));
    clock.advance(10 * 60 * MIN); // well into the last level
    await mgr.eliminate({ tournamentId: id, userId: 'c' });
    const t = await mgr.rebuy({ tournamentId: id, userId: 'c' });
    expect(t.currentLevelIndex).toBe(4);
    expect(seated(t)).toContain('c');
  });

  describe('heads-up during the rebuy period', () => {
    test('the tournament waits, so the busted player can still rebuy', async () => {
      const { mgr, id } = await started(['a', 'b']);
      let t = await mgr.eliminate({ tournamentId: id, userId: 'b' });
      expect(t.status).toBe('running');
      t = await mgr.rebuy({ tournamentId: id, userId: 'b' });
      expect(seated(t).sort()).toEqual(['a', 'b']);
    });

    test('it ends when the rebuy period closes with one player left', async () => {
      const { mgr, id, clock, read } = await started(['a', 'b']);
      await mgr.eliminate({ tournamentId: id, userId: 'b' });
      clock.advance(24 * MIN + 10 * MIN); // levels 1-2 and the break are over
      expect((await read()).status).toBe('completed');
      // The next change saves it: the last player can't be eliminated and the busted one can't rebuy
      await expect(mgr.eliminate({ tournamentId: id, userId: 'a' })).rejects.toThrow(/in progress/);
      await expect(mgr.rebuy({ tournamentId: id, userId: 'b' })).rejects.toThrow(/only allowed during running or break/);
    });

    test('a freezeout still ends as soon as one player is left', async () => {
      const cfg = config();
      cfg.rebuys = { ...cfg.rebuys!, enabled: false };
      cfg.addOn = { ...cfg.addOn!, enabled: false };
      const { mgr, id } = await started(['a', 'b'], cfg);
      expect((await mgr.eliminate({ tournamentId: id, userId: 'b' })).status).toBe('completed');
    });
  });
});
