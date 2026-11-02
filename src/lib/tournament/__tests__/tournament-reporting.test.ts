import { buildTournamentReport } from '../../tournament/tournament-reporting';
import { TournamentManager } from '../tournament-manager';
import { MemoryTournamentStore } from '../tournament-store';
import { createDefaultFreezeoutConfig, createRebuyAddOnConfig } from '../tournament-utils';

describe('Tournament Reporting (US-059)', () => {
  test('build report for simple freezeout', async () => {
    const mgr = new TournamentManager(new MemoryTournamentStore());
    const t = await mgr.create({ name: 'Freezeout', config: createDefaultFreezeoutConfig() });
    await mgr.register({ tournamentId: t.id, userId: 'p1' });
    await mgr.register({ tournamentId: t.id, userId: 'p2' });
    await mgr.start(t.id);
    await mgr.eliminate({ tournamentId: t.id, userId: 'p2' });
    const report = buildTournamentReport((await mgr.get(t.id))!);
    expect(report.registration.total).toBe(2);
    expect(report.eliminations.length).toBe(1);
    expect(report.eliminations[0]).toMatchObject({ userId: 'p2', place: 2 });
    expect(report.statistics.remainingPlayers).toBe(1);
    expect(report.prizePool.distributions.length).toBeGreaterThan(0);
  });

  test('report includes timeline and rebuys count when configured', async () => {
    const mgr = new TournamentManager(new MemoryTournamentStore());
    const t = await mgr.create({ name: 'Rebuy', config: createRebuyAddOnConfig() });
    await mgr.register({ tournamentId: t.id, userId: 'p1' });
    await mgr.register({ tournamentId: t.id, userId: 'p2' });
    await mgr.start(t.id);
    // Rebuy available during early levels
    await mgr.rebuy({ tournamentId: t.id, userId: 'p1' });
    const report = buildTournamentReport((await mgr.get(t.id))!);
    expect(report.registration.rebuys).toBe(1);
    // Two $50 entries and a $50 rebuy with a 10% house fee
    expect(report.prizePool.total).toBe(145);
    expect(report.registration.timeline.length).toBeGreaterThanOrEqual(3);
  });

  test('add-on only during specified break', async () => {
    const mgr = new TournamentManager(new MemoryTournamentStore());
    const t = await mgr.create({ name: 'Rebuy/AddOn', config: createRebuyAddOnConfig() });
    await mgr.register({ tournamentId: t.id, userId: 'p1' });
    await mgr.register({ tournamentId: t.id, userId: 'p2' });
    await mgr.start(t.id);
    // Advance to break after target level (level 3 in preset)
    await mgr.advanceLevel(t.id); // to L2
    await mgr.advanceLevel(t.id); // to L3
    await mgr.advanceLevel(t.id); // triggers break after L3
    const stateOnBreak = (await mgr.get(t.id))!;
    expect(stateOnBreak.status).toBe('on-break');
    await mgr.addOn({ tournamentId: t.id, userId: 'p1' });
    const stateAfterAddOn = (await mgr.get(t.id))!;
    const addOnCount = stateAfterAddOn.registrationTimeline!.filter(e => e.type === 'addOn').length;
    expect(addOnCount).toBe(1);
  });
});
