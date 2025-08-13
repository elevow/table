import { TableState, PlayerAction } from './poker';

export interface StateUpdate {
  type: 'state_update';
  tableId: string;
  sequence: number;
  payload: Partial<TableState>;
  timestamp: number;
}

export interface StateUpdateResponse {
  success: boolean;
  sequence: number;
  error?: string;
}

export interface RecoveryState {
  tableId: string;
  lastSequence: number;
  missedActions: PlayerAction[];
  currentState: TableState;
  reconnectToken?: string;
  gracePeriodRemaining: number;
}

export interface StateReconciliation {
  tableId: string;
  clientSequence: number;
  serverSequence: number;
  fullState: TableState;
  recoveryState: RecoveryState;
}

export type StateUpdateEvent = 
  | { type: 'connect' }
  | { type: 'disconnect' }
  | { type: 'reconcile'; payload: StateReconciliation }
  | StateUpdate;
