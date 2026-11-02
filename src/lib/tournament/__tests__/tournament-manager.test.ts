import { TournamentManager } from '../../tournament/tournament-manager';
import { MemoryTournamentStore } from '../../tournament/tournament-store';
import { createDefaultFreezeoutConfig, createRebuyAddOnConfig } from '../../tournament/tournament-utils';

const newManager = () => new TournamentManager(new MemoryTournamentStore());

async function startedWith(mgr: TournamentManager, players: string[], config = createDefaultFreezeoutConfig()) {
  const t = await mgr.create({ name: 'T', config });
  for (const userId of players) await mgr.register({ tournamentId: t.id, userId });
  await mgr.start(t.id);
  return t.id;
}

describe('TournamentManager (US-058)', () => {
  test('basic flow: create -> register -> start -> advance/break -> eliminate -> payouts', async () => {
    const mgr = newManager();
    const cfg = createDefaultFreezeoutConfig();
    const t = await mgr.create({ name: 'Weekly Freezeout', config: cfg, createdBy: 'td-1' });
    expect(t.status).toBe('setup');
    expect(t.createdBy).toBe('td-1');

    await mgr.register({ tournamentId: t.id, userId: 'u1' });
    await mgr.register({ tournamentId: t.id, userId: 'u2' });
    let got = (await mgr.get(t.id))!;
    expect(got.registeredPlayers.sort()).toEqual(['u1', 'u2']);

    await mgr.start(t.id);
    got = (await mgr.get(t.id))!;
    expect(got.status).toBe('running');
    expect(got.tables[0].players.length).toBe(2);
    expect(got.currentLevelIndex).toBe(0);

    // Advance to next level; default config has a break after level 2
    await mgr.advanceLevel(t.id); // to L2
    got = (await mgr.get(t.id))!;
    expect(got.currentLevelIndex).toBe(1);
    expect(got.status).toBe('running');

    await mgr.advanceLevel(t.id); // to L3 triggers break (afterLevel 2)
    got = (await mgr.get(t.id))!;
    expect(got.onBreak).toBe(true);
    expect(got.status).toBe('on-break');

    await mgr.endBreak(t.id);
    got = (await mgr.get(t.id))!;
    expect(got.onBreak).toBe(false);
    expect(got.status).toBe('running');

    // Pause/resume
    await mgr.pause(t.id);
    expect((await mgr.get(t.id))!.status).toBe('paused');
    await mgr.resume(t.id);
    expect((await mgr.get(t.id))!.status).toBe('running');

    // Eliminate down to winner; completes when only one remains
    await mgr.eliminate({ tournamentId: t.id, userId: 'u2' });
    got = (await mgr.get(t.id))!;
    expect(got.eliminatedPlayers).toContain('u2');
    expect(got.status).toBe('completed');

    const payouts = await mgr.payouts(t.id, 1000);
    expect(payouts[0].amount).toBeGreaterThan(0);
  });

  test('a rule that fails leaves the stored tournament unchanged', async () => {
    const mgr = newManager();
    const t = await mgr.create({ name: 'T', config: createDefaultFreezeoutConfig() });
    await expect(mgr.pause(t.id)).rejects.toThrow('Only running tournaments can be paused');
    expect((await mgr.get(t.id))!.status).toBe('setup');
    await expect(mgr.start('missing')).rejects.toThrow('Tournament not found');
  });

  describe('eliminations', () => {
    test('record the finishing place of the player going out', async () => {
      const mgr = newManager();
      const id = await startedWith(mgr, ['a', 'b', 'c', 'd']);
      await mgr.eliminate({ tournamentId: id, userId: 'd' });
      await mgr.eliminate({ tournamentId: id, userId: 'c' });
      await mgr.eliminate({ tournamentId: id, userId: 'b' });
      const t = (await mgr.get(id))!;
      expect(t.eliminationRecords!.map(r => [r.userId, r.place])).toEqual([['d', 4], ['c', 3], ['b', 2]]);
      expect(t.status).toBe('completed');
    });

    test('eliminating a player twice records them once', async () => {
      const mgr = newManager();
      const id = await startedWith(mgr, ['a', 'b', 'c']);
      await mgr.eliminate({ tournamentId: id, userId: 'c' });
      await mgr.eliminate({ tournamentId: id, userId: 'c' });
      expect((await mgr.get(id))!.eliminationRecords).toHaveLength(1);
    });

    test('are refused before the start and after the end', async () => {
      const mgr = newManager();
      const t = await mgr.create({ name: 'T', config: createDefaultFreezeoutConfig() });
      await mgr.register({ tournamentId: t.id, userId: 'a' });
      await mgr.register({ tournamentId: t.id, userId: 'b' });
      await expect(mgr.eliminate({ tournamentId: t.id, userId: 'b' })).rejects.toThrow(/in progress/);

      await mgr.start(t.id);
      await mgr.eliminate({ tournamentId: t.id, userId: 'b' });
      await expect(mgr.eliminate({ tournamentId: t.id, userId: 'a' })).rejects.toThrow(/in progress/);
    });

    test('cannot remove the last remaining player', async () => {
      const mgr = newManager();
      const id = await startedWith(mgr, ['a']);
      await expect(mgr.eliminate({ tournamentId: id, userId: 'a' })).rejects.toThrow('Cannot eliminate the last remaining player');
    });

    test('complete the tournament during a pause or a break', async () => {
      const mgr = newManager();
      const paused = await startedWith(mgr, ['a', 'b']);
      await mgr.pause(paused);
      expect((await mgr.eliminate({ tournamentId: paused, userId: 'b' })).status).toBe('completed');

      const onBreak = await startedWith(mgr, ['a', 'b']);
      await mgr.advanceLevel(onBreak);
      await mgr.advanceLevel(onBreak); // break after level 2
      const t = await mgr.eliminate({ tournamentId: onBreak, userId: 'b' });
      expect(t.status).toBe('completed');
      expect(t.onBreak).toBe(false);
      expect(t.breakEndsAt).toBeNull();
    });
  });

  describe('rebuy limit', () => {
    const withLimit = (maxPerPlayer: number | undefined) => {
      const config = createRebuyAddOnConfig();
      config.rebuys = { ...config.rebuys!, maxPerPlayer };
      return config;
    };

    test('stops a player at maxPerPlayer', async () => {
      const mgr = newManager();
      const id = await startedWith(mgr, ['a', 'b'], withLimit(2));
      await mgr.rebuy({ tournamentId: id, userId: 'a' });
      await mgr.rebuy({ tournamentId: id, userId: 'a' });
      await expect(mgr.rebuy({ tournamentId: id, userId: 'a' })).rejects.toThrow('Rebuy limit reached');
      await mgr.rebuy({ tournamentId: id, userId: 'b' });
    });

    test.each([0, undefined])('is unlimited when maxPerPlayer is %s', async maxPerPlayer => {
      const mgr = newManager();
      const id = await startedWith(mgr, ['a', 'b'], withLimit(maxPerPlayer));
      for (let i = 0; i < 5; i++) await mgr.rebuy({ tournamentId: id, userId: 'a' });
      const t = (await mgr.get(id))!;
      expect(t.registrationTimeline!.filter(e => e.type === 'rebuy')).toHaveLength(5);
    });
  });
});
