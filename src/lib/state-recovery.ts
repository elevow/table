import { TableState, PlayerAction } from '../types/poker';
import { StateReconciliation, RecoveryState } from '../types/state-update';

interface RecoveryOptions {
  graceTimeout: number;  // Time allowed for reconnection before auto-actions
  maxHistorySize: number; // Maximum number of actions to store per table
}

export class StateRecovery {
  private actionHistory: Map<string, PlayerAction[]> = new Map(); // tableId -> actions
  private disconnectedPlayers: Map<string, { timestamp: number; tableId: string }> = new Map(); // playerId -> info
  private readonly options: RecoveryOptions;

  private reconnectTokens: Map<string, string> = new Map(); // playerId -> token

  constructor(options: RecoveryOptions = { graceTimeout: 30000, maxHistorySize: 100 }) {
    this.options = options;
  }

  /**
   * Record a player disconnection and generate a reconnect token
   */
  public handleDisconnect(playerId: string, tableId: string): string {
    const timestamp = Date.now();
    const token = this.generateReconnectToken(playerId, timestamp);
    
    this.disconnectedPlayers.set(playerId, {
      timestamp,
      tableId
    });

    this.reconnectTokens.set(playerId, token);
    return token;
  }

  /**
   * Generate a unique reconnection token
   */
  private generateReconnectToken(playerId: string, timestamp: number): string {
    // Simple token generation - in production use a proper secure token generator
    return `${playerId}-${timestamp}-${Math.random().toString(36).substring(2)}`;
  }

  /**
   * Handle player reconnection and return reconciliation data
   */
  public handleReconnect(playerId: string, currentState: TableState, reconnectToken?: string): StateReconciliation | null {
    const disconnectInfo = this.disconnectedPlayers.get(playerId);
    if (!disconnectInfo) {
      return null;
    }

    // Validate reconnect token if provided
    const storedToken = this.reconnectTokens.get(playerId);
    if (reconnectToken && storedToken !== reconnectToken) {
      return null; // Invalid token
    }

    const { tableId, timestamp } = disconnectInfo;
    const now = Date.now();
    const gracePeriodRemaining = Math.max(0, this.options.graceTimeout - (now - timestamp));
    const missedActions = this.actionHistory.get(tableId)?.filter(
      action => action.timestamp > timestamp
    ) || [];

    // Only clear disconnect info if grace period expired or valid token provided
    if (gracePeriodRemaining === 0 || reconnectToken === storedToken) {
      this.disconnectedPlayers.delete(playerId);
      this.reconnectTokens.delete(playerId);
    }

    const recoveryState: RecoveryState = {
      tableId,
      lastSequence: missedActions.length,
      missedActions,
      currentState,
      reconnectToken: storedToken,
      gracePeriodRemaining
    };

    return {
      tableId,
      clientSequence: 0, // Will be updated by client state manager
      serverSequence: missedActions.length,
      fullState: currentState,
      recoveryState
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
   * Check if a player is in grace period and get remaining time
   */
  public getGracePeriodStatus(playerId: string): { inGracePeriod: boolean; remainingTime: number } {
    const disconnectInfo = this.disconnectedPlayers.get(playerId);
    if (!disconnectInfo) {
      return { inGracePeriod: false, remainingTime: 0 };
    }

    const remainingTime = Math.max(0, 
      this.options.graceTimeout - (Date.now() - disconnectInfo.timestamp)
    );
    
    return {
      inGracePeriod: remainingTime > 0,
      remainingTime
    };
  }

  /**
   * Check if a reconnect token is valid for a player
   */
  public validateReconnectToken(playerId: string, token: string): boolean {
    return this.reconnectTokens.get(playerId) === token;
  }

  /**
   * Replay missed actions to catch up a reconnected player
   */
  public replayMissedActions(playerId: string): PlayerAction[] {
    const missedActions = this.getMissedActions(playerId);
    const sortedActions = missedActions.sort((a, b) => a.timestamp - b.timestamp);
    return sortedActions;
  }
}
