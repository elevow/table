export type RiskLevel = 'low' | 'medium' | 'high';

export interface LoginEvent {
  accountId: string;
  ip: string;
  timestamp: number; // ms since epoch
  fingerprint?: string | null;
  userAgent?: string | null;
}

export interface IPAddressSignal {
  ip: string;
  accounts: string[];
  count: number; // total login events on this IP
  recentAt?: number;
  risk: RiskLevel;
}

export interface DeviceFingerprintSignal {
  fingerprint: string;
  accounts: string[];
  userAgents?: string[];
  count: number; // total events under this fingerprint
  risk: RiskLevel;
}

export interface LoginPatternMetric {
  pair: [string, string]; // account pair
  overlaps: number; // count of near-simultaneous logins
  medianDeltaMs: number | null;
  risk: RiskLevel;
}

export interface BehaviorMetric {
  accountId: string;
  metric: 'login_frequency' | 'ip_diversity' | 'device_diversity';
  value: number;
  risk: RiskLevel;
}

export interface AccountLinkageSignals {
  ip: IPAddressSignal[];
  device: DeviceFingerprintSignal[];
  behavior: BehaviorMetric[];
  timing: LoginPatternMetric[];
}

export interface AccountLinkage {
  signals: AccountLinkageSignals;
  confidence: number; // 0..1
  linkedAccounts: string[]; // union of accounts in suspicious components
}
