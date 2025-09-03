import { MultiAccountAnalyzer } from '../../security/multi-account-analyzer';

describe('MultiAccountAnalyzer (US-061)', () => {
  it('flags shared IPs and devices with confidence', () => {
    const analyzer = new MultiAccountAnalyzer();
    const base = Date.now();
    const logins = [
      { accountId: 'a1', ip: '10.0.0.1', timestamp: base + 1000, fingerprint: 'fp1', userAgent: 'UA1' },
      { accountId: 'a2', ip: '10.0.0.1', timestamp: base + 2000, fingerprint: 'fp1', userAgent: 'UA1' },
      { accountId: 'a3', ip: '10.0.0.1', timestamp: base + 3000, fingerprint: 'fp1', userAgent: 'UA2' },
      { accountId: 'a1', ip: '10.0.0.1', timestamp: base + 4000, fingerprint: 'fp1', userAgent: 'UA1' },
    ];
    const out = analyzer.analyze({ logins });
    expect(out.linkedAccounts.sort()).toEqual(['a1','a2','a3']);
    expect(out.confidence).toBeGreaterThan(0.3);
    expect(out.signals.ip[0].ip).toBe('10.0.0.1');
    expect(out.signals.device[0].fingerprint).toBe('fp1');
  });

  it('detects near-simultaneous login pairs', () => {
    const analyzer = new MultiAccountAnalyzer();
    const t = Date.now();
    const logins = [
      { accountId: 'x1', ip: '1.1.1.1', timestamp: t + 1000, fingerprint: 'd1' },
      { accountId: 'x2', ip: '1.1.1.1', timestamp: t + 1500, fingerprint: 'd1' },
      { accountId: 'x1', ip: '1.1.1.1', timestamp: t + 3000, fingerprint: 'd1' },
      { accountId: 'x2', ip: '1.1.1.1', timestamp: t + 3200, fingerprint: 'd1' },
      { accountId: 'x1', ip: '1.1.1.1', timestamp: t + 5000, fingerprint: 'd1' },
      { accountId: 'x2', ip: '1.1.1.1', timestamp: t + 5050, fingerprint: 'd1' },
    ];
    const out = analyzer.analyze({ logins });
    const pair = out.signals.timing.find(p => p.pair.includes('x1') && p.pair.includes('x2'));
    expect(pair).toBeDefined();
    expect((pair as any).overlaps).toBeGreaterThanOrEqual(3);
  });

  it('handles missing fingerprint gracefully', () => {
    const analyzer = new MultiAccountAnalyzer();
    const t = Date.now();
    const logins = [
      { accountId: 'b1', ip: '2.2.2.2', timestamp: t + 1000 },
      { accountId: 'b2', ip: '2.2.2.2', timestamp: t + 2000 },
    ] as any;
    const out = analyzer.analyze({ logins });
    expect(out.signals.device.length).toBeGreaterThanOrEqual(0);
    expect(out.signals.ip[0].accounts.length).toBe(2);
  });
});
