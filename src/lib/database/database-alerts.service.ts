// US-050: Performance Alerts

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface EscalationRule {
  afterMs: number;
  severity: Severity;
  channels?: string[];
}

export interface AlertConfig {
  metrics: Array<{
    name: string;
    threshold: number;
    duration: number; // ms
    severity: Severity;
  }>;
  notifications: {
    channels: string[];
    templates: Map<string, string>;
    escalation: EscalationRule[];
  };
}

export interface AlertRecord {
  id: string;
  name: string;
  message: string;
  severity: Severity;
  threshold: number;
  currentValue: number;
  firstSeenAt: number;
  lastSeenAt: number;
  acknowledged: boolean;
  notifications: string[]; // channels used
  escalations: Array<{ at: number; severity: Severity; channels?: string[] }>
}

export interface MetricsProvider {
  get(name: string): number | undefined;
}

function defaultNow(): number {
  return Date.now();
}

export class DatabaseAlertingService {
  private pending: Map<string, number> = new Map(); // metric -> first breach timestamp
  private active: Map<string, AlertRecord> = new Map(); // metric -> alert
  private history: AlertRecord[] = [];

  constructor(private config: AlertConfig) {}

  evaluate(provider: MetricsProvider, now: number = defaultNow()): AlertRecord[] {
    const firedNow: AlertRecord[] = [];

    for (const rule of this.config.metrics) {
      const value = provider.get(rule.name);
      if (value === undefined) {
        // reset pending if metric missing
        this.pending.delete(rule.name);
        continue;
      }

      const breaching = value > rule.threshold;
      const firstSeen = this.pending.get(rule.name);

      if (breaching) {
        const start = firstSeen ?? now;
        if (!firstSeen) this.pending.set(rule.name, start);

        const elapsed = now - start;
        if (elapsed >= rule.duration) {
          // either create or update alert
          const existing = this.active.get(rule.name);
          if (!existing) {
            const alert = this.createAlert(rule.name, rule.severity, rule.threshold, value, start, now);
            this.active.set(rule.name, alert);
            this.history.push(alert);
            this.notify(alert);
            firedNow.push(alert);
          } else {
            existing.lastSeenAt = now;
            existing.currentValue = value;
            // check escalation
            const esk = this.getEscalationFor(now - existing.firstSeenAt, existing.severity);
            if (esk && esk.severity !== existing.severity) {
              existing.severity = esk.severity;
              existing.escalations.push({ at: now, severity: esk.severity, channels: esk.channels });
              this.notify(existing, esk.channels);
            }
          }
        }
      } else {
        // reset pending window
        this.pending.delete(rule.name);
        // if there is an active alert and value returns below threshold, resolve (keep in history, but remove from active)
        if (this.active.has(rule.name)) {
          const a = this.active.get(rule.name)!;
          a.lastSeenAt = now;
          this.active.delete(rule.name);
        }
      }
    }

    return firedNow;
  }

  getActiveAlerts(): AlertRecord[] {
    return Array.from(this.active.values()).filter(a => !a.acknowledged);
  }

  getHistory(limit = 100): AlertRecord[] {
    return this.history.slice(-limit);
  }

  acknowledge(id: string): AlertRecord | undefined {
    const inActive = Array.from(this.active.values()).find(a => a.id === id);
    if (inActive) {
      inActive.acknowledged = true;
      return inActive;
    }
    const inHistory = this.history.find(a => a.id === id);
    if (inHistory) {
      inHistory.acknowledged = true;
      return inHistory;
    }
    return undefined;
  }

  private createAlert(name: string, severity: Severity, threshold: number, value: number, firstSeenAt: number, now: number): AlertRecord {
    const template = this.config.notifications.templates.get(name) || `${name} breached: {value} > {threshold}`;
    const message = template
      .replace('{value}', String(value))
      .replace('{threshold}', String(threshold));
    const id = `${name}-${firstSeenAt}`;
    return {
      id,
      name,
      message,
      severity,
      threshold,
      currentValue: value,
      firstSeenAt,
      lastSeenAt: now,
      acknowledged: false,
      notifications: [],
      escalations: []
    };
  }

  private notify(alert: AlertRecord, channels?: string[]): void {
    const chans = channels ?? this.config.notifications.channels;
    alert.notifications.push(...chans);
    // For this implementation we log; in production, integrate with actual notifiers
    if (!process.env.CI) {
      console.warn(`ALERT [${alert.severity}] ${alert.name}: ${alert.message} (channels: ${chans.join(',')})`);
    }
  }

  private getEscalationFor(elapsedMs: number, currentSeverity: Severity): EscalationRule | undefined {
    // Find next higher severity rule that matches elapsed time
    const order: Severity[] = ['low', 'medium', 'high', 'critical'];
    const currentIdx = order.indexOf(currentSeverity);
    const candidates = this.config.notifications.escalation
      .filter(e => elapsedMs >= e.afterMs && order.indexOf(e.severity) > currentIdx)
      .sort((a, b) => a.afterMs - b.afterMs);
    return candidates[candidates.length - 1];
  }
}
