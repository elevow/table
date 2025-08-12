import { Server as SocketServer } from 'socket.io';
import { TableState } from '../types/poker';
import { StateUpdate, StateUpdateResponse, StateReconciliation } from '../types/state-update';

export class StateManager {
  private states: Map<string, TableState> = new Map();
  private sequences: Map<string, number> = new Map();
  private updateRates: Map<string, number[]> = new Map();
  private readonly MAX_UPDATES_PER_SECOND = 20; // Rate limit
  private readonly UPDATE_WINDOW_MS = 1000;
  private io: SocketServer;

  constructor(io: SocketServer) {
    this.io = io;
    this.setupSocketHandlers();
    this.startCleanupInterval();
  }

  private startCleanupInterval(): void {
    setInterval(() => {
      const now = Date.now();
      this.updateRates.forEach((timestamps, tableId) => {
        const recent = timestamps.filter(t => now - t < this.UPDATE_WINDOW_MS);
        if (recent.length === 0) {
          this.updateRates.delete(tableId);
        } else {
          this.updateRates.set(tableId, recent);
        }
      });
    }, this.UPDATE_WINDOW_MS);
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      socket.on('join_table', (tableId: string) => {
        socket.join(tableId);
        const state = this.states.get(tableId);
        if (state) {
          this.sendReconciliation(socket.id, tableId);
        }
      });

      socket.on('leave_table', (tableId: string) => {
        socket.leave(tableId);
      });
    });
  }

  public updateState(tableId: string, update: Partial<TableState>): boolean {
    if (!this.checkRateLimit(tableId)) {
      return false;
    }

    try {
      const currentState = this.states.get(tableId);
      const sequence = (this.sequences.get(tableId) || 0) + 1;
      
      const newState = currentState ? { ...currentState, ...update } : update as TableState;
      this.states.set(tableId, newState);
      this.sequences.set(tableId, sequence);

      const stateUpdate: StateUpdate = {
        type: 'state_update',
        tableId,
        sequence,
        payload: update,
        timestamp: Date.now()
      };

      this.broadcastUpdate(tableId, stateUpdate);
      return true;
    } catch (error) {
      console.error(`Error updating state for table ${tableId}:`, error);
      return false;
    }
  }

  private checkRateLimit(tableId: string): boolean {
    const now = Date.now();
    const timestamps = this.updateRates.get(tableId) || [];
    const recentUpdates = timestamps.filter(t => now - t < this.UPDATE_WINDOW_MS);

    if (recentUpdates.length >= this.MAX_UPDATES_PER_SECOND) {
      return false;
    }

    recentUpdates.push(now);
    this.updateRates.set(tableId, recentUpdates);
    return true;
  }

  private broadcastUpdate(tableId: string, update: StateUpdate): void {
    this.io.to(tableId).emit('state_update', update);
  }

  private sendReconciliation(socketId: string, tableId: string): void {
    const state = this.states.get(tableId);
    const sequence = this.sequences.get(tableId) || 0;

    if (state) {
      const reconciliation: StateReconciliation = {
        tableId,
        clientSequence: 0, // Client will send their sequence
        serverSequence: sequence,
        fullState: state
      };

      this.io.to(socketId).emit('reconcile', reconciliation);
    }
  }

  public getState(tableId: string): TableState | undefined {
    return this.states.get(tableId);
  }

  public getSequence(tableId: string): number {
    return this.sequences.get(tableId) || 0;
  }
}
