import { Server as SocketServer } from 'socket.io';
import { PlayerAction, TableState, Player } from '../types/poker';
import { ActionValidator } from './action-validator';
import { StateManager } from './state-manager';

interface ActionResponse {
  success: boolean;
  error?: string;
  state?: TableState;
}

export class ActionManager {
  private stateManager: StateManager;
  private io: SocketServer;
  private actionTimeouts: Map<string, NodeJS.Timeout>;

  constructor(stateManager: StateManager, io: SocketServer) {
    this.stateManager = stateManager;
    this.io = io;
    this.actionTimeouts = new Map();
    this.setupSocketHandlers();
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      socket.on('player_action', (action: PlayerAction, callback: (response: ActionResponse) => void) => {
        this.handlePlayerAction(action)
          .then(response => callback(response))
          .catch(error => callback({ success: false, error: error.message }));
      });
    });
  }

  public async handlePlayerAction(action: PlayerAction): Promise<ActionResponse> {
    const state = this.stateManager.getState(action.tableId);
    if (!state) {
      return { success: false, error: 'Table not found' };
    }

    const player = state.players.find(p => p.id === action.playerId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    // Validate action
    const validation = ActionValidator.validateAction(action, state, player);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Calculate effects
    const effects = ActionValidator.calculateActionEffects(action, state, player);

    // Apply action effects
    const newState = this.applyAction(state, player, action, effects);

    // Update state
    await this.stateManager.updateState(action.tableId, newState);

    // Broadcast action
    this.broadcastAction(action);

    // Clear existing timeout and set new one for next player
    this.clearActionTimeout(action.tableId);
    this.setActionTimeout(action.tableId, newState);

    return { success: true, state: newState };
  }

  private applyAction(
    state: TableState,
    player: Player,
    action: PlayerAction,
    effects: ReturnType<typeof ActionValidator.calculateActionEffects>
  ): TableState {
    const newState = { ...state };

    // Update player state
    const playerIndex = state.players.findIndex(p => p.id === player.id);
    const updatedPlayer = {
      ...player,
      stack: player.stack + effects.stackDelta,
      currentBet: player.currentBet + Math.abs(effects.stackDelta),
      hasActed: true,
      isFolded: action.type === 'fold',
      isAllIn: player.stack + effects.stackDelta === 0
    };
    newState.players = [
      ...state.players.slice(0, playerIndex),
      updatedPlayer,
      ...state.players.slice(playerIndex + 1)
    ];

    // Update table state
    newState.pot += effects.potDelta;
    newState.currentBet = effects.newCurrentBet;
    newState.minRaise = effects.newMinRaise;

    // Move to next active player
    newState.activePlayer = this.findNextActivePlayer(newState);

    // Check if betting round is complete
    if (this.isBettingRoundComplete(newState)) {
      newState.stage = this.getNextStage(newState.stage);
      this.resetBettingRound(newState);
    }

    return newState;
  }

  private findNextActivePlayer(state: TableState): string {
    const activePlayerIndex = state.players.findIndex(p => p.id === state.activePlayer);
    let nextIndex = (activePlayerIndex + 1) % state.players.length;
    
    while (nextIndex !== activePlayerIndex) {
      const player = state.players[nextIndex];
      if (!player.isFolded && !player.isAllIn && player.stack > 0) {
        return player.id;
      }
      nextIndex = (nextIndex + 1) % state.players.length;
    }
    
    return state.activePlayer; // If no other eligible player found
  }

  private isBettingRoundComplete(state: TableState): boolean {
    const activePlayers = state.players.filter(p => !p.isFolded && !p.isAllIn);
    if (activePlayers.length <= 1) return true;

    // All active players must have acted
    const allPlayersActed = activePlayers.every(p => p.hasActed);
    // All active players must have equal bets or be all-in
    const allBetsEqual = activePlayers.every(p => 
      p.currentBet === state.currentBet || p.isAllIn
    );
    // At least one player must have acted for the round to complete
    const anyPlayerActed = activePlayers.some(p => p.hasActed);

    return anyPlayerActed && allPlayersActed && allBetsEqual;
  }

  private getNextStage(currentStage: TableState['stage']): TableState['stage'] {
    const stages: TableState['stage'][] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
    const currentIndex = stages.indexOf(currentStage);
    return stages[currentIndex + 1] || 'showdown';
  }

  private resetBettingRound(state: TableState): void {
    state.players.forEach(player => {
      player.hasActed = false;
      player.currentBet = 0;
    });
    state.currentBet = 0;
    state.minRaise = state.bigBlind;
  }

  private broadcastAction(action: PlayerAction): void {
    this.io.to(action.tableId).emit('player_action', action);
  }

  private setActionTimeout(tableId: string, state: TableState): void {
    const timeout = setTimeout(() => {
      this.handleTimeout(tableId, state.activePlayer);
    }, state.players.find(p => p.id === state.activePlayer)?.timeBank || 30000);

    this.actionTimeouts.set(tableId, timeout);
  }

  private clearActionTimeout(tableId: string): void {
    const timeout = this.actionTimeouts.get(tableId);
    if (timeout) {
      clearTimeout(timeout);
      this.actionTimeouts.delete(tableId);
    }
  }

  private async handleTimeout(tableId: string, playerId: string): Promise<void> {
    // Auto-fold on timeout
    const timeoutAction: PlayerAction = {
      type: 'fold',
      playerId,
      tableId,
      timestamp: Date.now()
    };

    // Broadcast timeout fold action before processing
    this.broadcastAction(timeoutAction);
    await this.handlePlayerAction(timeoutAction);
  }
}
