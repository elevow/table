import { TableState, PlayerAction } from '../types/poker';
import { StateReconciliation } from '../types/state-update';

interface RecoveryOptions {
  graceTimeout: number;  // Time allowed for reconnection before auto-actions
  maxHistorySize: number; // Maximum number of actions to store per table
}

export class StateRecovery {
  private actionHistory: Map<string, PlayerAction[]> = new Map(); // tableId -> actions
  private disconnectedPlayers: Map<string, { timestamp: number; tableId: string }> = new Map(); // playerId -> info
  private readonly options: RecoveryOptions;

  constructor(options: RecoveryOptions = { graceTimeout: 30000, maxHistorySize: 100 }) {
    this.options = options;
  }

  /**
   * Record a player disconnection
   */
  public handleDisconnect(playerId: string, tableId: string): void {
    this.disconnectedPlayers.set(playerId, {
      timestamp: Date.now(),
      tableId
    });
  }

  /**
   * Handle player reconnection and return reconciliation data
   */
  public handleReconnect(playerId: string, currentState: TableState): StateReconciliation | null {
    const disconnectInfo = this.disconnectedPlayers.get(playerId);
    if (!disconnectInfo) {
      return null;
    }

    const { tableId, timestamp } = disconnectInfo;
    const gracePeriodExpired = Date.now() - timestamp > this.options.graceTimeout;
    const missedActions = this.actionHistory.get(tableId)?.filter(
      action => action.timestamp > timestamp
    ) || [];

    this.disconnectedPlayers.delete(playerId);

    return {
      tableId,
      clientSequence: 0, // Will be updated by client state manager
      serverSequence: missedActions.length,
      fullState: currentState
    };
  }

  /**
   * Record an action in history
   */
  public recordAction(tableId: string, action: PlayerAction): void {
    const actions = this.actionHistory.get(tableId) || [];
    const newAction = { ...action, tableId }; // Ensure tableId is set
    actions.push(newAction);

    // Maintain maximum history size
    if (actions.length > this.options.maxHistorySize) {
      actions.shift(); // Remove oldest action
    }

    this.actionHistory.set(tableId, actions);
  }

  /**
   * Check for players who need auto-actions due to disconnect timeout
   */
  public checkTimeouts(): { playerId: string; tableId: string }[] {
    const timeouts: { playerId: string; tableId: string }[] = [];
    const now = Date.now();

    this.disconnectedPlayers.forEach((info, playerId) => {
      if (now - info.timestamp > this.options.graceTimeout) {
        timeouts.push({ playerId, tableId: info.tableId });
        this.disconnectedPlayers.delete(playerId);
      }
    });

    return timeouts;
  }

  /**
   * Get missed actions for a player since their disconnect
   */
  public getMissedActions(playerId: string): PlayerAction[] {
    // If the player is currently disconnected
    const disconnectInfo = this.disconnectedPlayers.get(playerId);
    if (disconnectInfo) {
      const { tableId, timestamp } = disconnectInfo;
      return (this.actionHistory.get(tableId) || [])
        .filter(action => action.timestamp > timestamp);
    }

    // Player is not currently disconnected, look through history
    let actionsForPlayer: PlayerAction[] = [];
    
    // Find their table and actions
    for (const [tableId, actions] of this.actionHistory.entries()) {
      // If this table has any actions from or targeting this player
      if (actions.some(a => a.playerId === playerId)) {
        actionsForPlayer = actions;
        break;
      }
    }

    return actionsForPlayer;
  }

  /**
   * Clear history for a table (e.g., when hand completes)
   */
  public clearTableHistory(tableId: string): void {
    this.actionHistory.delete(tableId);
  }

  /**
   * Check if a player is in grace period
   */
  public isInGracePeriod(playerId: string): boolean {
    const disconnectInfo = this.disconnectedPlayers.get(playerId);
    if (!disconnectInfo) {
      return false;
    }

    return Date.now() - disconnectInfo.timestamp <= this.options.graceTimeout;
  }
}
