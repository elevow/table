import { SecurityScheduler, configureSecurityScheduler } from '../../security/security-scheduler';
import { adminAlertStore } from '../../security/admin-alert-store';

describe('SecurityScheduler', () => {
  it('runOnce analyzes logins and records an admin alert', async () => {
    const before = adminAlertStore.list().length;
    const prevLast = SecurityScheduler.getLastRun();

    const now = Date.now();
    const fakeFetcher = async (_sinceMs: number) => [
      { accountId: 'u1', ip: '9.9.9.9', fingerprint: 'fpZ', userAgent: 'UA', timestamp: now - 1000 },
      { accountId: 'u2', ip: '9.9.9.9', fingerprint: 'fpZ', userAgent: 'UA', timestamp: now - 900 },
    ] as any;

    configureSecurityScheduler(fakeFetcher);
    await SecurityScheduler.runOnce();

    const after = adminAlertStore.list().length;
    expect(after).toBeGreaterThanOrEqual(before + 1);
    expect(SecurityScheduler.getLastRun()).toBeGreaterThanOrEqual(prevLast);
  });
});
