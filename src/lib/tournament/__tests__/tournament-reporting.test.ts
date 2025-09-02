import { buildTournamentReport } from '../../tournament/tournament-reporting';
import { TournamentManager } from '../tournament-manager';
import { createDefaultFreezeoutConfig, createRebuyAddOnConfig } from '../tournament-utils';

describe('Tournament Reporting (US-059)', () => {
  test('build report for simple freezeout', () => {
    const mgr = new TournamentManager();
    const t = mgr.create({ name: 'Freezeout', config: createDefaultFreezeoutConfig() });
    mgr.register({ tournamentId: t.id, userId: 'p1' });
    mgr.register({ tournamentId: t.id, userId: 'p2' });
    mgr.start(t.id);
    mgr.eliminate({ tournamentId: t.id, userId: 'p2' });
    const report = buildTournamentReport(mgr.get(t.id)!, 1000);
    expect(report.registration.total).toBe(2);
    expect(report.eliminations.length).toBe(1);
    expect(report.statistics.remainingPlayers).toBe(1);
    expect(report.prizePool.distributions.length).toBeGreaterThan(0);
  });

  test('report includes timeline and rebuys count when configured', () => {
    const mgr = new TournamentManager();
    const t = mgr.create({ name: 'Rebuy', config: createRebuyAddOnConfig() });
    mgr.register({ tournamentId: t.id, userId: 'p1' });
    mgr.register({ tournamentId: t.id, userId: 'p2' });
    mgr.start(t.id);
    // Rebuy available during early levels
    mgr.rebuy({ tournamentId: t.id, userId: 'p1' });
    const report = buildTournamentReport(mgr.get(t.id)!, 2500);
    expect(report.registration.rebuys).toBe(1);
    expect(report.registration.timeline.length).toBeGreaterThanOrEqual(3);
  });

  test('add-on only during specified break', () => {
    const mgr = new TournamentManager();
    const t = mgr.create({ name: 'Rebuy/AddOn', config: createRebuyAddOnConfig() });
    mgr.register({ tournamentId: t.id, userId: 'p1' });
    mgr.register({ tournamentId: t.id, userId: 'p2' });
    mgr.start(t.id);
    // Advance to break after target level (level 3 in preset)
    mgr.advanceLevel(t.id); // to L2
    mgr.advanceLevel(t.id); // to L3
    mgr.advanceLevel(t.id); // triggers break after L3
    const stateOnBreak = mgr.get(t.id)!;
    expect(stateOnBreak.status).toBe('on-break');
    mgr.addOn({ tournamentId: t.id, userId: 'p1' });
    const stateAfterAddOn = mgr.get(t.id)!;
    const addOnCount = stateAfterAddOn.registrationTimeline!.filter(e => e.type === 'addOn').length;
    expect(addOnCount).toBe(1);
  });
});
