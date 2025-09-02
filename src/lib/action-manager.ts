import { Server as SocketServer } from 'socket.io';
import { PlayerAction, TableState, Player, DisconnectionState } from '../types/poker';
import { ActionValidator } from './action-validator';
import { StateManager } from './state-manager';
import { TimerManager } from './timer-manager';

interface ActionResponse {
  success: boolean;
  error?: string;
  state?: TableState;
}

export class ActionManager {
  private stateManager: StateManager;
  private io: SocketServer;
  private actionTimeouts: Map<string, NodeJS.Timeout>;
  // US-032: Track player disconnections with grace period and scheduled auto-actions
  private disconnects: Map<string, DisconnectionState>;
  // US-034: Time Bank and turn timers
  private timerManager: TimerManager;

  constructor(stateManager: StateManager, io: SocketServer) {
    this.stateManager = stateManager;
    this.io = io;
    this.actionTimeouts = new Map();
  this.disconnects = new Map();
  // Initialize time bank/timer manager (US-034)
  this.timerManager = new TimerManager(this.io, this.stateManager);
    this.setupSocketHandlers();
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      // On join, clear any pending disconnection state for this player if known
      socket.on('join_table', ({ tableId, playerId }: { tableId: string; playerId: string }) => {
        const key = `${tableId}:${playerId}`;
        const disc = this.disconnects.get(key);
        if (disc) {
          // Player reconnected within grace period; cancel auto-action
          this.clearAutoActionTimeout(key);
          this.disconnects.delete(key);
        }
  (socket as any).playerId = playerId;
  socket.join(tableId);
  // Also join a personal room for per-player events (e.g., timebank updates)
  socket.join(playerId);
      });
      socket.on('player_action', (action: PlayerAction, callback: (response: ActionResponse) => void) => {
        // Remember identity and ensure socket is in the room for broadcasts
        (socket as any).playerId = action.playerId;
        socket.join(action.tableId);
        this.handlePlayerAction(action)
          .then(response => callback(response))
          .catch(error => callback({ success: false, error: error.message }));
      });

      // US-034: Allow clients to consume their time bank for the active turn
      socket.on('use_timebank', (
        { tableId, playerId }: { tableId: string; playerId: string },
        callback?: (resp: { success: boolean }) => void
      ) => {
        const success = this.timerManager.useTimeBank(tableId, playerId);
        if (callback) callback({ success });
      });

      // Track disconnects and schedule auto-actions
      socket.on('disconnect', (reason) => {
        // Expect client to have identified with last join_table; if not, skip
        const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
        const tableId = rooms[0];
        const playerId = (socket as any).playerId as string | undefined;
        if (!tableId || !playerId) return;

        this.scheduleAutoAction(tableId, playerId);
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

  // US-032: Disconnection handling
  private scheduleAutoAction(tableId: string, playerId: string): void {
    const state = this.stateManager.getState(tableId);
    if (!state) return;
    const player = state.players.find(p => p.id === playerId);
    if (!player) return;

    const graceMs = Math.max(5000, player.timeBank ?? 30000); // use timeBank as baseline
    const executeAt = new Date(Date.now() + graceMs);
    const key = `${tableId}:${playerId}`;

    const autoType: DisconnectionState['autoAction']['type'] = state.currentBet > player.currentBet ? 'fold' : 'check-fold';
    const disc: DisconnectionState = {
      playerId,
      graceTime: graceMs,
      autoAction: { type: autoType, executeAt },
      preservedStack: player.stack,
      position: player.position,
      reconnectBy: executeAt
    };
    this.disconnects.set(key, disc);

    const timer = setTimeout(async () => {
      const current = this.disconnects.get(key);
      if (!current) return; // cancelled due to reconnect
      // Re-evaluate latest state for check-fold behavior
      const s = this.stateManager.getState(tableId);
      const pl = s?.players.find(p => p.id === playerId);
      const execType: PlayerAction['type'] = (!s || !pl) ? 'fold' : (s.currentBet > pl.currentBet ? 'fold' : 'check');
      const action: PlayerAction = { type: execType, playerId, tableId, timestamp: Date.now() } as PlayerAction;
      this.broadcastAction(action);
      try {
        await this.handlePlayerAction(action);
      } catch {
        // ignore if invalid now
      }
      this.disconnects.delete(key);
    }, graceMs);

    // Store timer using existing map for reuse
    this.actionTimeouts.set(`disc:${key}`, timer);
  }

  private clearAutoActionTimeout(key: string): void {
    const timer = this.actionTimeouts.get(`disc:${key}`);
    if (timer) {
      clearTimeout(timer);
      this.actionTimeouts.delete(`disc:${key}`);
    }
  }

  private setActionTimeout(tableId: string, state: TableState): void {
  // Delegate to TimerManager (US-034)
  this.timerManager.startTimer(tableId, state.activePlayer);
  }

  private clearActionTimeout(tableId: string): void {
  // Stop the TimerManager timer for this table (US-034)
  this.timerManager.stopTimer(tableId);
  }

  private async handleTimeout(tableId: string, playerId: string): Promise<void> {
  // For active turn timeouts, default to fold to preserve legacy behavior
  const timeoutAction: PlayerAction = { type: 'fold', playerId, tableId, timestamp: Date.now() } as PlayerAction;
    this.broadcastAction(timeoutAction);
    try {
      await this.handlePlayerAction(timeoutAction);
    } catch {
      // ignore
    }
  }
}
