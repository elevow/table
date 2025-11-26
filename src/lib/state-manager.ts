/**
 * StateManager - deprecated
 * Socket.IO transport has been removed. Use HTTP APIs with Supabase realtime instead.
 * This module is kept for backward compatibility but provides minimal functionality.
 */

import { TableState } from '../types/poker';

export class StateManager {
  private states: Map<string, TableState> = new Map();

  constructor(_io?: any) {
    console.warn('⚠️ StateManager is deprecated. Socket.IO has been removed. Use HTTP APIs with Supabase realtime instead.');
  }

  public getState(tableId: string): TableState | undefined {
    return this.states.get(tableId);
  }

  public setState(tableId: string, state: TableState): void {
    this.states.set(tableId, state);
  }

  public updateState(tableId: string, update: Partial<TableState>): TableState | undefined {
    const current = this.states.get(tableId);
    if (current) {
      const updated = { ...current, ...update };
      this.states.set(tableId, updated);
      return updated;
    }
    return undefined;
  }

  public deleteState(tableId: string): void {
    this.states.delete(tableId);
  }

  public broadcastState(_tableId: string): void {
    console.warn('⚠️ StateManager.broadcastState is deprecated. Use Supabase realtime publisher instead.');
  }
}
