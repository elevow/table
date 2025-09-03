import { AccountLinkage, AccountLinkageSignals, DeviceFingerprintSignal, IPAddressSignal, LoginEvent, LoginPatternMetric, RiskLevel, MultiAccountConfig } from '../../types';
import { getSecurityConfig } from './security-config';

export interface MultiAccountAnalyzeInput {
  logins: LoginEvent[];
  config?: MultiAccountConfig;
}

export class MultiAccountAnalyzer {
  analyze(input: MultiAccountAnalyzeInput): AccountLinkage {
    const { logins } = input;
    if (!Array.isArray(logins)) throw new Error('logins array required');
    const cfg = input.config ?? getSecurityConfig().multiAccount;

    // Normalize
    const events = logins
      .filter(e => e && e.accountId && e.ip && typeof e.timestamp === 'number')
      .sort((a, b) => a.timestamp - b.timestamp);

  const ipSignals = this.byIP(events, cfg);
  const deviceSignals = this.byDevice(events, cfg);
  const behaviorSignals = this.behavior(events, cfg);
  const timingSignals = this.timing(events, cfg);

    const signals: AccountLinkageSignals = {
      ip: ipSignals,
      device: deviceSignals,
      behavior: behaviorSignals,
      timing: timingSignals
    };

    const accountsSuspicious = new Set<string>();
    signals.ip.filter(s => s.risk !== 'low').forEach(s => s.accounts.forEach(a => accountsSuspicious.add(a)));
    signals.device.filter(s => s.risk !== 'low').forEach(s => s.accounts.forEach(a => accountsSuspicious.add(a)));
    signals.timing.filter(s => s.risk !== 'low').forEach(s => s.pair.forEach(a => accountsSuspicious.add(a)));
    signals.behavior.filter(s => s.risk !== 'low').forEach(s => accountsSuspicious.add(s.accountId));

    // Confidence: weighted across signals
    // Compute confidence only from non-low risk signals to avoid dilution
    const parts: Array<{ arr: any[]; w: number }> = [
      { arr: ipSignals, w: cfg.weights.ip },
      { arr: deviceSignals, w: cfg.weights.device },
      { arr: timingSignals, w: cfg.weights.timing },
      { arr: behaviorSignals, w: cfg.weights.behavior }
    ];
    let num = 0;
    let den = 0;
    for (const p of parts) {
      for (const s of p.arr as Array<{ risk: RiskLevel }>) {
        if (s.risk === 'low') continue;
        num += this.weight(s.risk, p.w);
        den += p.w; // maximum contribution if this signal were 'high'
      }
    }
    const confidence = den > 0 ? Math.max(0, Math.min(1, num / den)) : 0;

    return {
      signals,
      confidence,
      linkedAccounts: Array.from(accountsSuspicious)
    };
  }

  private weight(risk: RiskLevel, w: number): number {
    switch (risk) {
      case 'high':
        return 1 * w;
      case 'medium':
        return 0.5 * w;
      default:
        return 0;
    }
  }

  private byIP(events: LoginEvent[], cfg: MultiAccountConfig): IPAddressSignal[] {
    const map = new Map<string, { accounts: Set<string>; count: number; recentAt: number }>();
    for (const e of events) {
      const m = map.get(e.ip) || { accounts: new Set<string>(), count: 0, recentAt: 0 };
      m.accounts.add(e.accountId);
      m.count++;
      m.recentAt = Math.max(m.recentAt, e.timestamp);
      map.set(e.ip, m);
    }
    const out: IPAddressSignal[] = [];
    for (const [ip, v] of map) {
      const accs = Array.from(v.accounts);
      const risk: RiskLevel = accs.length >= cfg.thresholds.ipAccounts.high
        ? 'high'
        : accs.length >= cfg.thresholds.ipAccounts.medium
          ? 'medium'
          : 'low';
      out.push({ ip, accounts: accs, count: v.count, recentAt: v.recentAt, risk });
    }
    return out.sort((a, b) => (b.count - a.count) || b.accounts.length - a.accounts.length);
  }

  private byDevice(events: LoginEvent[], cfg: MultiAccountConfig): DeviceFingerprintSignal[] {
    const map = new Map<string, { accounts: Set<string>; count: number; ua: Set<string> }>();
    for (const e of events) {
      const key = e.fingerprint || '';
      if (!key) continue;
      const m = map.get(key) || { accounts: new Set<string>(), count: 0, ua: new Set<string>() };
      m.accounts.add(e.accountId);
      m.count++;
      if (e.userAgent) m.ua.add(e.userAgent);
      map.set(key, m);
    }
    const out: DeviceFingerprintSignal[] = [];
    for (const [fingerprint, v] of map) {
      const accs = Array.from(v.accounts);
      const risk: RiskLevel = accs.length >= cfg.thresholds.deviceAccounts.high
        ? 'high'
        : accs.length >= cfg.thresholds.deviceAccounts.medium
          ? 'medium'
          : 'low';
      out.push({ fingerprint, accounts: accs, userAgents: Array.from(v.ua), count: v.count, risk });
    }
    return out.sort((a, b) => (b.count - a.count) || b.accounts.length - a.accounts.length);
  }

  private behavior(events: LoginEvent[], cfg: MultiAccountConfig): import('../../types').BehaviorMetric[] {
    const byAcc = new Map<string, LoginEvent[]>();
    for (const e of events) {
      if (!byAcc.has(e.accountId)) byAcc.set(e.accountId, []);
      byAcc.get(e.accountId)!.push(e);
    }
  const out: import('../../types').BehaviorMetric[] = [];
    for (const [accountId, evts] of byAcc) {
      evts.sort((a, b) => a.timestamp - b.timestamp);
      const freq = evts.length / Math.max(1, (evts[evts.length - 1].timestamp - evts[0].timestamp) / (24 * 3600 * 1000));
      const ipSet = new Set(evts.map(e => e.ip));
      const fpSet = new Set(evts.map(e => e.fingerprint).filter(Boolean) as string[]);
      const ipRisk: RiskLevel = ipSet.size >= cfg.thresholds.behavior.ipDiversity.high
        ? 'high'
        : ipSet.size >= cfg.thresholds.behavior.ipDiversity.medium
          ? 'medium'
          : 'low';
      const fpRisk: RiskLevel = fpSet.size >= cfg.thresholds.behavior.deviceDiversity.high
        ? 'high'
        : fpSet.size >= cfg.thresholds.behavior.deviceDiversity.medium
          ? 'medium'
          : 'low';
      const freqRisk: RiskLevel = freq >= cfg.thresholds.behavior.loginFrequencyPerDay.high
        ? 'high'
        : freq >= cfg.thresholds.behavior.loginFrequencyPerDay.medium
          ? 'medium'
          : 'low';

      out.push({ accountId, metric: 'ip_diversity', value: ipSet.size, risk: ipRisk });
      out.push({ accountId, metric: 'device_diversity', value: fpSet.size, risk: fpRisk });
      out.push({ accountId, metric: 'login_frequency', value: Number(freq.toFixed(2)), risk: freqRisk });
    }
    return out;
  }

  private timing(events: LoginEvent[], cfg: MultiAccountConfig): LoginPatternMetric[] {
    // Identify pairs of accounts with many near-simultaneous logins (e.g., within 60s)
    const windowMs = cfg.thresholds.timing.windowMs;
    const byIpOrDevice = new Map<string, LoginEvent[]>();
    for (const e of events) {
      const key = `${e.ip}|${e.fingerprint || ''}`;
      if (!byIpOrDevice.has(key)) byIpOrDevice.set(key, []);
      byIpOrDevice.get(key)!.push(e);
    }
    const pairMap = new Map<string, number[]>();
    for (const [_k, evts] of byIpOrDevice) {
      evts.sort((a, b) => a.timestamp - b.timestamp);
      for (let i = 0; i < evts.length; i++) {
        for (let j = i + 1; j < evts.length; j++) {
          const a = evts[i], b = evts[j];
          const dt = Math.abs(b.timestamp - a.timestamp);
          if (dt > windowMs) break;
          if (a.accountId === b.accountId) continue;
          const pair = a.accountId < b.accountId ? `${a.accountId}|${b.accountId}` : `${b.accountId}|${a.accountId}`;
          const arr = pairMap.get(pair) || [];
          arr.push(dt);
          pairMap.set(pair, arr);
        }
      }
    }
    const out: LoginPatternMetric[] = [];
    for (const [pairKey, deltas] of pairMap) {
      const [x, y] = pairKey.split('|');
      const overlaps = deltas.length;
      const medianDeltaMs = overlaps ? this.median(deltas) : null;
      const risk: RiskLevel = overlaps >= cfg.thresholds.timing.overlaps.high
        ? 'high'
        : overlaps >= cfg.thresholds.timing.overlaps.medium
          ? 'medium'
          : 'low';
      out.push({ pair: [x, y], overlaps, medianDeltaMs, risk });
    }
    return out.sort((a, b) => (b.overlaps - a.overlaps) || ((a.medianDeltaMs ?? 0) - (b.medianDeltaMs ?? 0)));
  }

  private median(arr: number[]): number {
    const a = [...arr].sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }
}
