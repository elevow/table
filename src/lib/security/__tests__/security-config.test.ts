import { getSecurityConfig, defaultSecurityConfig } from '../../security/security-config';

describe('security-config env overrides', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('uses defaults when no envs set', () => {
    delete process.env.SEC_MULTI_W_IP;
    const cfg = getSecurityConfig();
    expect(cfg.multiAccount.weights.ip).toBe(defaultSecurityConfig.multiAccount.weights.ip);
  });

  it('applies weight and threshold overrides from env', () => {
    process.env.SEC_MULTI_W_IP = '5';
    process.env.SEC_MULTI_IP_MED = '10';
    process.env.SEC_MULTI_TIMING_WINDOW_MS = '120000';
    process.env.SEC_SCHED_ENABLED = 'true';
    process.env.SEC_SCHED_INTERVAL_MS = '60000';
    const cfg = getSecurityConfig();
    expect(cfg.multiAccount.weights.ip).toBe(5);
    expect(cfg.multiAccount.thresholds.ipAccounts.medium).toBe(10);
    expect(cfg.multiAccount.thresholds.timing.windowMs).toBe(120000);
    expect(cfg.scheduler.enabled).toBe(true);
    expect(cfg.scheduler.intervalMs).toBe(60000);
  });
});
