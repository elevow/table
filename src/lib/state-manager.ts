import type { Broadcaster } from './broadcaster';
import { TableState, PlayerAction } from '../types/poker';
import { StateUpdate, StateUpdateResponse, StateReconciliation } from '../types/state-update';
import { StateRecovery } from './state-recovery';
import { leaveSeat } from './shared/game-seats';

export class StateManager {
  private states: Map<string, TableState> = new Map();
  private sequences: Map<string, number> = new Map();
  private updateRates: Map<string, number[]> = new Map();
  private readonly MAX_UPDATES_PER_SECOND = 20; // Rate limit
  private readonly UPDATE_WINDOW_MS = 1000;
  private io: Broadcaster;
  private recovery: StateRecovery;
  // Optional listeners for state changes (tableId, newFullState, partialUpdate)
  private listeners: Set<(tableId: string, state: TableState, update: Partial<TableState>) => void> = new Set();

  constructor(io: Broadcaster) {
    this.io = io;
    this.recovery = new StateRecovery();
    this.setupSocketHandlers();
    this.startCleanupInterval();
    this.startTimeoutCheck();
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
    // Socket.IO handlers have been removed. Event handling is now done via HTTP/Supabase.
  }

  private startTimeoutCheck(): void {
    setInterval(() => {
      const timeouts = this.recovery.checkTimeouts();
      timeouts.forEach(({ playerId, tableId }) => {
        // Create an auto-fold action for timed out players
        const autoAction: PlayerAction = {
          type: 'fold',
          playerId,
          tableId,
          timestamp: Date.now()
        };
        this.handleAction(tableId, autoAction);
      });
    }, 1000); // Check every second
  }

  public updateState(tableId: string, update: Partial<TableState>): boolean {
    if (!this.checkRateLimit(tableId)) {
      return false;
    }

    try {
      const currentState = this.states.get(tableId);
      const sanitizedUpdate: Partial<TableState> = { ...update };
      const prevStage = currentState?.stage;
      const nextStage = sanitizedUpdate.stage ?? prevStage;
      const stageResetTargets = new Set<TableState['stage']>(['preflop', 'awaiting-dealer-choice']);
      if (
        currentState &&
        prevStage &&
        nextStage &&
        prevStage !== nextStage &&
        stageResetTargets.has(nextStage)
      ) {
        sanitizedUpdate.runItTwicePrompt = null;
        sanitizedUpdate.runItTwicePromptDisabled = false;
      }
      const sequence = (this.sequences.get(tableId) || 0) + 1;
      
      const newState = currentState ? { ...currentState, ...sanitizedUpdate } : sanitizedUpdate as TableState;
      this.states.set(tableId, newState);
      this.sequences.set(tableId, sequence);

      const stateUpdate: StateUpdate = {
        type: 'state_update',
        tableId,
        sequence,
        payload: sanitizedUpdate,
        timestamp: Date.now()
      };

      this.broadcastUpdate(tableId, stateUpdate);
      // Notify listeners with the merged latest state
      try {
        this.listeners.forEach(cb => {
          try { cb(tableId, newState, update); } catch {}
        });
      } catch {}
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
        fullState: state,
        recoveryState: {
          tableId,
          lastSequence: sequence,
          currentState: state,
          gracePeriodRemaining: 30000,
          missedActions: []
        }
      };

      this.io.to(socketId).emit('reconcile', reconciliation);
    }
  }

  public getState(tableId: string): TableState | undefined {
    return this.states.get(tableId);
  }

  // Listener API (optional)
  public addListener(cb: (tableId: string, state: TableState, update: Partial<TableState>) => void): void {
    this.listeners.add(cb);
  }

  public removeListener(cb: (tableId: string, state: TableState, update: Partial<TableState>) => void): void {
    this.listeners.delete(cb);
  }

  public getSequence(tableId: string): number {
    return this.sequences.get(tableId) || 0;
  }

  public handleAction(tableId: string, action: PlayerAction): void {
    // Get the current state first
    const state = this.states.get(tableId);
    if (!state) return;

    // Record action in recovery system
    this.recovery.recordAction(tableId, action);

    // Find and update the player
    const playerIndex = state.players.findIndex(p => p.id === action.playerId);
    if (playerIndex === -1) return;

    // Make a new copy of players with the updated player state
    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = {
      ...updatedPlayers[playerIndex],
      isFolded: action.type === 'fold'
    };

    // Update state immediately
    this.states.set(tableId, {
      ...state,
      players: updatedPlayers,
      activePlayer: action.type === 'fold' ? '' : state.activePlayer
    });

    // Then broadcast the state update
    const stateUpdate = {
      players: updatedPlayers,
      activePlayer: action.type === 'fold' ? '' : state.activePlayer
    };
    this.updateState(tableId, stateUpdate);

    // Finally broadcast the action
    this.io.to(tableId).emit('action', action);
  }
}
