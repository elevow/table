import { TournamentManager } from '../../tournament/tournament-manager';
import { createDefaultFreezeoutConfig } from '../../tournament/tournament-utils';

describe('TournamentManager (US-058)', () => {
  test('basic flow: create -> register -> start -> advance/break -> eliminate -> payouts', () => {
    const mgr = new TournamentManager();
    const cfg = createDefaultFreezeoutConfig();
    const t = mgr.create({ name: 'Weekly Freezeout', config: cfg });
    expect(t.status).toBe('setup');

    mgr.register({ tournamentId: t.id, userId: 'u1' });
    mgr.register({ tournamentId: t.id, userId: 'u2' });
    let got = mgr.get(t.id)!;
    expect(got.registeredPlayers.sort()).toEqual(['u1', 'u2']);

    mgr.start(t.id);
    got = mgr.get(t.id)!;
    expect(got.status).toBe('running');
    expect(got.tables[0].players.length).toBe(2);
    expect(got.currentLevelIndex).toBe(0);

    // Advance to next level; default config has a break after level 2
    mgr.advanceLevel(t.id); // to L2
    got = mgr.get(t.id)!;
    expect(got.currentLevelIndex).toBe(1);
    expect(got.status).toBe('running');

    mgr.advanceLevel(t.id); // to L3 triggers break (afterLevel 2)
    got = mgr.get(t.id)!;
    expect(got.onBreak).toBe(true);
    expect(got.status).toBe('on-break');

    mgr.endBreak(t.id);
    got = mgr.get(t.id)!;
    expect(got.onBreak).toBe(false);
    expect(got.status).toBe('running');

    // Pause/resume
    mgr.pause(t.id);
    expect(mgr.get(t.id)!.status).toBe('paused');
    mgr.resume(t.id);
    expect(mgr.get(t.id)!.status).toBe('running');

    // Eliminate down to winner
    mgr.eliminate({ tournamentId: t.id, userId: 'u2' });
    got = mgr.get(t.id)!;
    expect(got.eliminatedPlayers).toContain('u2');
    // Auto-complete when only one remains
    expect(['running', 'completed']).toContain(got.status);

    const payouts = mgr.payouts(t.id, 1000);
    expect(payouts[0].amount).toBeGreaterThan(0);
  });
});
