import type { SecurityAlert } from './collusion';

export type AlertSource = 'collusion' | 'multi-account' | 'system' | 'database' | 'metrics';

export type AlertStatus = 'new' | 'acknowledged' | 'resolved';

export interface AdminAlert extends SecurityAlert {
  source: AlertSource;
  status: AlertStatus;
  evidence?: any[];
  createdAt: number;
  updatedAt: number;
}

export interface ListAlertsResponse {
  alerts: AdminAlert[];
}

export interface GetAlertResponse {
  alert: AdminAlert | null;
}
