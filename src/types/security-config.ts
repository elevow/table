// Config types for security analyzers and scheduler

export interface MultiAccountWeightsConfig {
  ip: number;
  device: number;
  timing: number;
  behavior: number;
}

export interface MultiAccountThresholdsConfig {
  ipAccounts: { medium: number; high: number }; // distinct accounts per IP
  deviceAccounts: { medium: number; high: number }; // distinct accounts per device
  behavior: {
    ipDiversity: { medium: number; high: number };
    deviceDiversity: { medium: number; high: number };
    loginFrequencyPerDay: { medium: number; high: number };
  };
  timing: {
    windowMs: number; // near-simultaneous window
    overlaps: { medium: number; high: number };
  };
}

export interface MultiAccountConfig {
  weights: MultiAccountWeightsConfig;
  thresholds: MultiAccountThresholdsConfig;
}

export interface CollusionBettingConfig {
  vpipLow: number; // suspicious if VPIP < vpipLow and PFR > pfrHigh
  pfrHigh: number;
  aggressionHigh: number; // (bets+raises)/calls
}

export interface CollusionGroupingConfig {
  minCoHands: number;
  minRatio: number; // cohands / maxHands
}

export interface CollusionFoldingConfig {
  minOpportunities: number;
  foldToAggPctHigh: number;
}

export interface CollusionChipDumpingConfig {
  concentrationMin: number; // contribution/pot to consider a transfer candidate
  potMin: number; // min pot to consider
  minOccurrences: number; // suspicious threshold
  minTotalAmount: number; // suspicious threshold
}

export interface CollusionConfig {
  betting: CollusionBettingConfig;
  grouping: CollusionGroupingConfig;
  folding: CollusionFoldingConfig;
  chipDumping: CollusionChipDumpingConfig;
}

export interface SecuritySchedulerConfig {
  enabled: boolean;
  intervalMs: number; // how often to run
  lookbackMs: number; // how far back to collect data each run
}

export interface SecuritySystemConfig {
  multiAccount: MultiAccountConfig;
  collusion: CollusionConfig;
  scheduler: SecuritySchedulerConfig;
}
