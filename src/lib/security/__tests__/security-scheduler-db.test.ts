jest.mock('../../database/database-connection', () => {
  const rows = [
    { user_id: 'a1', ip_address: '10.0.0.1', user_agent: 'UA', created_at: new Date(Date.now() - 500).toISOString() },
    { user_id: 'a2', ip_address: '10.0.0.1', user_agent: 'UA', created_at: new Date(Date.now() - 400).toISOString() },
  ];
  return {
    createDatabasePool: () => ({
      connect: async () => ({
        query: async () => ({ rows, rowCount: rows.length }),
        release: () => {}
      }),
      end: async () => {}
    }),
  };
});

import { fetchLoginsSince, initSecuritySchedulerDb } from '../../security/security-scheduler-db';
import { SecurityScheduler } from '../../security/security-scheduler';
import { adminAlertStore } from '../../security/admin-alert-store';

describe('security-scheduler-db', () => {
  it('fetchLoginsSince maps DB rows to LoginEvent', async () => {
    const since = Date.now() - 1000;
    const events = await fetchLoginsSince(since);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toHaveProperty('accountId');
    expect(events[0]).toHaveProperty('ip');
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  it('initSecuritySchedulerDb wires scheduler to DB-backed fetcher', async () => {
    const before = adminAlertStore.list().length;
    initSecuritySchedulerDb();
    await SecurityScheduler.runOnce();
    const after = adminAlertStore.list().length;
    expect(after).toBeGreaterThanOrEqual(before + 1);
  });
});
