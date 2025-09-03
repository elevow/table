import type { SecuritySystemConfig } from '../../types';
import { getSecurityOverrides, deepMerge } from './security-config-runtime';

const num = (v: any, d: number) => (v == null || v === '' || isNaN(Number(v)) ? d : Number(v));

export const defaultSecurityConfig: SecuritySystemConfig = {
  multiAccount: {
    weights: { ip: 2, device: 2, timing: 1.5, behavior: 1 },
    thresholds: {
      ipAccounts: { medium: 2, high: 3 },
      deviceAccounts: { medium: 2, high: 3 },
      behavior: {
        ipDiversity: { medium: 5, high: 8 },
        deviceDiversity: { medium: 3, high: 6 },
        loginFrequencyPerDay: { medium: 20, high: 50 },
      },
      timing: {
        windowMs: 60_000,
        overlaps: { medium: 4, high: 8 },
      },
    },
  },
  collusion: {
    betting: { vpipLow: 0.05, pfrHigh: 0.3, aggressionHigh: 3.5 },
    grouping: { minCoHands: 10, minRatio: 0.6 },
    folding: { minOpportunities: 8, foldToAggPctHigh: 0.85 },
    chipDumping: { concentrationMin: 0.7, potMin: 300, minOccurrences: 3, minTotalAmount: 1000 },
  },
  scheduler: { enabled: false, intervalMs: 15 * 60_000, lookbackMs: 24 * 60 * 60_000 },
};

// Simple env-driven override support
export function getSecurityConfig(): SecuritySystemConfig {
  const d = defaultSecurityConfig;
  return {
    multiAccount: {
      weights: {
        ip: num(process.env.SEC_MULTI_W_IP, d.multiAccount.weights.ip),
        device: num(process.env.SEC_MULTI_W_DEVICE, d.multiAccount.weights.device),
        timing: num(process.env.SEC_MULTI_W_TIMING, d.multiAccount.weights.timing),
        behavior: num(process.env.SEC_MULTI_W_BEHAVIOR, d.multiAccount.weights.behavior),
      },
      thresholds: {
        ipAccounts: {
          medium: num(process.env.SEC_MULTI_IP_MED, d.multiAccount.thresholds.ipAccounts.medium),
          high: num(process.env.SEC_MULTI_IP_HIGH, d.multiAccount.thresholds.ipAccounts.high),
        },
        deviceAccounts: {
          medium: num(process.env.SEC_MULTI_DEV_MED, d.multiAccount.thresholds.deviceAccounts.medium),
          high: num(process.env.SEC_MULTI_DEV_HIGH, d.multiAccount.thresholds.deviceAccounts.high),
        },
        behavior: {
          ipDiversity: {
            medium: num(process.env.SEC_MULTI_BEH_IPD_MED, d.multiAccount.thresholds.behavior.ipDiversity.medium),
            high: num(process.env.SEC_MULTI_BEH_IPD_HIGH, d.multiAccount.thresholds.behavior.ipDiversity.high),
          },
          deviceDiversity: {
            medium: num(process.env.SEC_MULTI_BEH_DEVD_MED, d.multiAccount.thresholds.behavior.deviceDiversity.medium),
            high: num(process.env.SEC_MULTI_BEH_DEVD_HIGH, d.multiAccount.thresholds.behavior.deviceDiversity.high),
          },
          loginFrequencyPerDay: {
            medium: num(process.env.SEC_MULTI_BEH_FREQ_MED, d.multiAccount.thresholds.behavior.loginFrequencyPerDay.medium),
            high: num(process.env.SEC_MULTI_BEH_FREQ_HIGH, d.multiAccount.thresholds.behavior.loginFrequencyPerDay.high),
          },
        },
        timing: {
          windowMs: num(process.env.SEC_MULTI_TIMING_WINDOW_MS, d.multiAccount.thresholds.timing.windowMs),
          overlaps: {
            medium: num(process.env.SEC_MULTI_TIMING_OVL_MED, d.multiAccount.thresholds.timing.overlaps.medium),
            high: num(process.env.SEC_MULTI_TIMING_OVL_HIGH, d.multiAccount.thresholds.timing.overlaps.high),
          },
        },
      },
    },
    collusion: d.collusion, // keep defaults for now; can add env overrides similarly
    scheduler: {
      enabled: String(process.env.SEC_SCHED_ENABLED || '').toLowerCase() === 'true' || d.scheduler.enabled,
      intervalMs: num(process.env.SEC_SCHED_INTERVAL_MS, d.scheduler.intervalMs),
      lookbackMs: num(process.env.SEC_SCHED_LOOKBACK_MS, d.scheduler.lookbackMs),
    },
  };
}

// Live config = env/defaults merged with in-memory admin overrides
export function getLiveSecurityConfig(): SecuritySystemConfig {
  const envCfg = getSecurityConfig();
  const overrides = getSecurityOverrides();
  // Deep merge, with overrides taking precedence
  return deepMerge(envCfg, overrides) as SecuritySystemConfig;
}
