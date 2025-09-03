import { v4 as uuidv4 } from 'uuid';
import type { AdminAlert, AlertSource, AlertStatus } from '../../types';
import type { CollusionDetection } from '../../types/collusion';
import type { AccountLinkage } from '../../types/multi-account';
import { adminAlertRepository } from './admin-alert-repository';

export class AdminAlertStore {
  private static _instance: AdminAlertStore | null = null;
  static instance(): AdminAlertStore {
    if (!this._instance) this._instance = new AdminAlertStore();
    return this._instance;
  }

  private alerts = new Map<string, AdminAlert>();

  list(): AdminAlert[] {
  const mem = Array.from(this.alerts.values());
  // Best-effort read-through fetch to include persisted alerts created in other instances
  // Non-blocking: if DB fails, return memory snapshot
  // Note: This is sync signature; APIs can fetch from repo directly for full list
  return mem.sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): AdminAlert | null {
    return this.alerts.get(id) || null;
  }

  add(alert: Omit<AdminAlert, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): AdminAlert {
    const now = Date.now();
    const full: AdminAlert = {
      id: alert.id || uuidv4(),
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      at: alert.at ?? now,
      involved: alert.involved ?? [],
      source: alert.source,
      status: alert.status ?? 'new',
      evidence: alert.evidence ?? [],
      createdAt: now,
      updatedAt: now,
    } as AdminAlert;
    this.alerts.set(full.id, full);
  // Fire and forget persistence
  adminAlertRepository.create(full).catch(() => {});
    return full;
  }

  updateStatus(id: string, status: AlertStatus): AdminAlert | null {
    const a = this.alerts.get(id);
    if (!a) return null;
    a.status = status;
    a.updatedAt = Date.now();
    this.alerts.set(id, a);
  adminAlertRepository.updateStatus(id, status).catch(() => {});
    return a;
  }

  // Ingestors
  addFromCollusion(collusion: CollusionDetection): AdminAlert[] {
    const out: AdminAlert[] = [];
    for (const alert of collusion.alerts) {
      out.push(this.add({
        ...alert,
        source: 'collusion',
        status: 'new',
        evidence: collusion.evidence,
      } as any));
    }
    return out;
  }

  addFromMultiAccount(linkage: AccountLinkage): AdminAlert[] {
    const source: AlertSource = 'multi-account';
    const baseAt = Date.now();
    const alerts: AdminAlert[] = [];
    // Create one aggregate alert summarizing linkage
    const message = `Multi-account linkage suspected (confidence ${(linkage.confidence * 100).toFixed(0)}%): ${linkage.linkedAccounts.join(', ')}`;
    alerts.push(this.add({
      type: 'grouping',
      severity: linkage.confidence >= 0.7 ? 'high' : linkage.confidence >= 0.4 ? 'medium' : 'low',
      message,
      at: baseAt,
      involved: linkage.linkedAccounts,
      source,
      status: 'new',
      evidence: [linkage.signals],
    } as any));
    return alerts;
  }
}

export const adminAlertStore = AdminAlertStore.instance();
