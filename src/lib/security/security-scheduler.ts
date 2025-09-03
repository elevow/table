import { getSecurityConfig } from './security-config';
import { MultiAccountAnalyzer } from './multi-account-analyzer';
import { adminAlertStore } from './admin-alert-store';
import type { LoginEvent } from '../../types';

export type FetchLoginsFn = (sinceMs: number) => Promise<LoginEvent[]>;

class SecuritySchedulerImpl {
  private timer: NodeJS.Timeout | null = null;
  private lastRun = 0;

  constructor(private fetchLogins: FetchLoginsFn) {}

  start(): void {
    const cfg = getSecurityConfig().scheduler;
    if (!cfg.enabled) return;
    this.stop();
    this.timer = setInterval(() => void this.runOnce(), cfg.intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async runOnce(): Promise<void> {
    const sys = getSecurityConfig();
    const since = Date.now() - sys.scheduler.lookbackMs;
    const logins = await this.fetchLogins(since);
    if (!logins || logins.length === 0) return;
    const analyzer = new MultiAccountAnalyzer();
    const linkage = analyzer.analyze({ logins, config: sys.multiAccount });
    adminAlertStore.addFromMultiAccount(linkage);
    this.lastRun = Date.now();
  }

  getLastRun(): number { return this.lastRun; }
}

// Default fetcher placeholder: in real app, pull from DB
const defaultFetcher: FetchLoginsFn = async (_since) => [];

export const SecurityScheduler = new SecuritySchedulerImpl(defaultFetcher);

export function configureSecurityScheduler(fetcher: FetchLoginsFn) {
  (SecurityScheduler as any).fetchLogins = fetcher;
}
