import { DatabaseAlertingService, AlertConfig, MetricsProvider } from '../../database/database-alerts.service';

class MapMetrics implements MetricsProvider {
  constructor(private m: Map<string, number>) {}
  get(name: string): number | undefined {
    return this.m.get(name);
  }
}

const baseConfig: AlertConfig = {
  metrics: [
    { name: 'slow_queries', threshold: 5, duration: 1000, severity: 'medium' },
    { name: 'conn_util', threshold: 0.8, duration: 0, severity: 'high' }
  ],
  notifications: {
    channels: ['console'],
    templates: new Map([
      ['slow_queries', 'Slow queries: {value} > {threshold}']
    ]),
    escalation: [
      { afterMs: 5_000, severity: 'high', channels: ['console','email'] },
      { afterMs: 30_000, severity: 'critical', channels: ['console','pager'] }
    ]
  }
};

describe('DatabaseAlertingService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fires alerts when threshold duration is met and tracks active alerts', () => {
    const svc = new DatabaseAlertingService(baseConfig);
    const now = 1_000_000;
    const provider1 = new MapMetrics(new Map([
      ['slow_queries', 6],
      ['conn_util', 0.5]
    ]));

    // First evaluate: pending starts, no alert yet (needs 1s)
    let fired = svc.evaluate(provider1, now);
    expect(fired).toHaveLength(0);

    // After 1s, should fire
    fired = svc.evaluate(provider1, now + 1000);
    expect(fired).toHaveLength(1);
    const [alert] = fired;
    expect(alert.name).toBe('slow_queries');
    expect(alert.severity).toBe('medium');
    expect(alert.notifications).toContain('console');
    expect(svc.getActiveAlerts().map(a => a.name)).toContain('slow_queries');
  });

  it('acknowledges alerts and removes when metric recovers', () => {
    const svc = new DatabaseAlertingService(baseConfig);
    const now = 5_000_000;
    const breaching = new MapMetrics(new Map([ ['slow_queries', 10] ]));
    const ok = new MapMetrics(new Map([ ['slow_queries', 0] ]));

    svc.evaluate(breaching, now);
    const [fired] = svc.evaluate(breaching, now + 1000);
    expect(fired).toBeDefined();

    // Acknowledge
    const acked = svc.acknowledge(fired.id);
    expect(acked?.acknowledged).toBe(true);
    expect(svc.getActiveAlerts().length).toBe(0); // acknowledged alerts are hidden from active list

    // Recover
    svc.evaluate(ok, now + 1500);
    expect(svc.getActiveAlerts().length).toBe(0);
  });

  it('escalates severity based on elapsed time', () => {
    const svc = new DatabaseAlertingService(baseConfig);
    const t0 = 10_000_000;
    const provider = new MapMetrics(new Map([ ['slow_queries', 100] ]));

    // Fire initial (medium) at t0+1s
    svc.evaluate(provider, t0);
    svc.evaluate(provider, t0 + 1000);
    let active = svc.getActiveAlerts();
    expect(active[0].severity).toBe('medium');

    // After +6s total -> high escalation
    svc.evaluate(provider, t0 + 6000);
    active = svc.getActiveAlerts();
    expect(active[0].severity).toBe('high');
    expect(active[0].escalations.length).toBeGreaterThan(0);

    // After +35s total -> critical escalation
    svc.evaluate(provider, t0 + 35000);
    active = svc.getActiveAlerts();
    expect(active[0].severity).toBe('critical');
  });
});
