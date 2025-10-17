import { Server as SocketServer } from 'socket.io';
import { PlayerAction } from '../types/poker';
import { StateManager } from './state-manager';

export interface TimerState {
  activePlayer: string;
  startTime: number;
  duration: number;
  timeBank: number;
  warning: boolean;
}

export interface TimerConfig {
  defaultDuration: number;
  warningThreshold: number;
  timeBankInitial: number;
  timeBankMax: number;
  timeBankReplenishAmount: number;
  timeBankReplenishInterval: number;
}

export class TimerManager {
  private timers: Map<string, TimerState> = new Map();
  private timeBanks: Map<string, number> = new Map();
  private lastReplenished: Map<string, number> = new Map();
  private config: TimerConfig;

  constructor(
    private io: SocketServer,
    private stateManager: StateManager,
    config: Partial<TimerConfig> = {}
  ) {
    this.config = {
      defaultDuration: 30000, // 30 seconds
      warningThreshold: 10000, // 10 seconds
      timeBankInitial: 120000, // 2 minutes
      timeBankMax: 300000, // 5 minutes
      timeBankReplenishAmount: 30000, // 30 seconds
      timeBankReplenishInterval: 3600000, // 1 hour
      ...config
    };

    this.setupTimeBankReplenishment();
  }

  private setupTimeBankReplenishment(): void {
    setInterval(() => this.checkAndReplenishTimeBanks(), 60000); // Check every minute
  }

  public checkAndReplenishTimeBanks(): void {
    const now = Date.now();
    this.timeBanks.forEach((amount, playerId) => {
      const lastReplenish = this.lastReplenished.get(playerId) || 0;
      const timeSinceLastReplenish = now - lastReplenish;
      const replenishCycles = Math.floor(timeSinceLastReplenish / this.config.timeBankReplenishInterval);
      if (replenishCycles > 0) {
        this.replenishTimeBank(playerId);
      }
    });
  }

  public startTimer(tableId: string, playerId: string): void {
    // Initialize time bank if not exists
    if (!this.timeBanks.has(playerId)) {
      this.timeBanks.set(playerId, this.config.timeBankInitial);
      this.lastReplenished.set(playerId, Date.now());
    }

    const timerState: TimerState = {
      activePlayer: playerId,
      startTime: Date.now(),
      duration: this.config.defaultDuration,
      timeBank: this.timeBanks.get(playerId) || 0,
      warning: false
    };

    this.timers.set(tableId, timerState);
    this.broadcastTimerState(tableId);
    this.scheduleWarning(tableId);
    this.scheduleTimeout(tableId);
  }

  private scheduleWarning(tableId: string): void {
    const timer = this.timers.get(tableId);
    if (!timer) return;

    const warningTime = timer.startTime + timer.duration - this.config.warningThreshold;
    const now = Date.now();

    if (now < warningTime) {
      setTimeout(() => {
        const currentTimer = this.timers.get(tableId);
        if (currentTimer && currentTimer.startTime === timer.startTime) {
          currentTimer.warning = true;
          this.broadcastTimerState(tableId);
        }
      }, warningTime - now);
    }
  }

  private scheduleTimeout(tableId: string): void {
    const timer = this.timers.get(tableId);
    if (!timer) return;

    const timeoutAt = timer.startTime + timer.duration;
    const now = Date.now();

    if (now < timeoutAt) {
      setTimeout(() => {
        const currentTimer = this.timers.get(tableId);
        if (currentTimer && currentTimer.startTime === timer.startTime) {
          this.handleTimeout(tableId, timer.activePlayer);
        }
      }, timeoutAt - now);
    }
  }

  private handleTimeout(tableId: string, playerId: string): void {
    // Auto-fold when time expires
    const autoAction: PlayerAction = {
      type: 'fold',
      playerId,
      tableId,
      timestamp: Date.now()
    };

    // Remove the timer
    this.timers.delete(tableId);

    // Broadcast in the room to align with action flow, then notify state manager
    this.io.to(tableId).emit('player_action', autoAction);
    this.stateManager.handleAction(tableId, autoAction);
  }

  public useTimeBank(tableId: string, playerId: string): boolean {
    const timer = this.timers.get(tableId);
    const timeBank = this.timeBanks.get(playerId) || 0;

    if (!timer || timer.activePlayer !== playerId || timeBank <= 0) {
      return false;
    }

    // Add remaining time bank to current timer
    const remainingRegularTime = Math.max(0, 
      timer.startTime + timer.duration - Date.now());
    
    const newTimerState: TimerState = {
      ...timer,
      duration: remainingRegularTime + timeBank,
      timeBank: 0,
      warning: false
    };

    this.timers.set(tableId, newTimerState);
    this.timeBanks.set(playerId, 0);
    // Reset last replenished time to now
    this.lastReplenished.set(playerId, Date.now());
    
    // Reschedule warning and timeout
    this.broadcastTimerState(tableId);
    this.scheduleWarning(tableId);
    this.scheduleTimeout(tableId);

    return true;
  }

  private replenishTimeBank(playerId: string): void {
    const currentAmount = this.timeBanks.get(playerId) || 0;
    const lastReplenishTime = this.lastReplenished.get(playerId) || 0;
    const now = Date.now();
    const timeSinceLastReplenish = now - lastReplenishTime;
    const replenishCycles = Math.floor(timeSinceLastReplenish / this.config.timeBankReplenishInterval);
    
    if (replenishCycles > 0) {
      const replenishAmount = replenishCycles * this.config.timeBankReplenishAmount;
      const newAmount = Math.min(
        this.config.timeBankMax,
        currentAmount + replenishAmount
      );

      this.timeBanks.set(playerId, newAmount);
      this.lastReplenished.set(playerId, now);

      // Notify the player of their new time bank amount
      this.io.to(playerId).emit('timebank_update', { amount: newAmount });
    }
  }

  private broadcastTimerState(tableId: string): void {
    const timer = this.timers.get(tableId);
    if (timer) {
      this.io.to(tableId).emit('timer_update', timer);
    }
  }

  public stopTimer(tableId: string): void {
    this.timers.delete(tableId);
    // Broadcast removal so clients can clear UI
    this.io.to(tableId).emit('timer_update', undefined as any);
  }

  public getTimerState(tableId: string): TimerState | undefined {
    return this.timers.get(tableId);
  }

  public getTimeBank(playerId: string): number {
    return this.timeBanks.get(playerId) || 0;
  }
}
