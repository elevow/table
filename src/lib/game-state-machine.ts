import { GameState, StateTransition, RecoveryPoint, ActionValidator, GameStateMachine } from '../types/state';
import { GameAction, TableState } from '../types/poker';

export class PokerGameStateMachine implements GameStateMachine {
  private static instance: PokerGameStateMachine;
  public currentState: GameState;
  public allowedTransitions: Map<GameState, GameState[]>;
  public validators: Map<GameState, ActionValidator[]>;
  public history: StateTransition[];
  public recovery: RecoveryPoint[];
  private tableState: TableState | null;

  private constructor() {
    this.currentState = 'idle';
    this.allowedTransitions = this.initializeTransitions();
    this.validators = this.initializeValidators();
    this.history = [];
    this.recovery = [];
    this.tableState = null;
  }

  static getInstance(): PokerGameStateMachine {
    if (!PokerGameStateMachine.instance) {
      PokerGameStateMachine.instance = new PokerGameStateMachine();
    }
    return PokerGameStateMachine.instance;
  }

  private initializeTransitions(): Map<GameState, GameState[]> {
    const transitions = new Map<GameState, GameState[]>();
    
    transitions.set('idle', ['initializing', 'error']);
    transitions.set('initializing', ['waitingForPlayers', 'error']);
    transitions.set('waitingForPlayers', ['starting', 'error']);
    transitions.set('starting', ['dealingCards', 'error']);
    transitions.set('dealingCards', ['preFlop', 'error']);
    transitions.set('preFlop', ['flop', 'showdown', 'error']);
    transitions.set('flop', ['turn', 'showdown', 'error']);
    transitions.set('turn', ['river', 'showdown', 'error']);
    transitions.set('river', ['showdown', 'error']);
    transitions.set('showdown', ['finished', 'error']);
    transitions.set('finished', ['waitingForPlayers', 'error']);
    transitions.set('error', ['initializing']);

    return transitions;
  }

  private initializeValidators(): Map<GameState, ActionValidator[]> {
    const validators = new Map<GameState, ActionValidator[]>();
    
    // Add validators for each state...
    // This will be implemented separately in the action-validator.ts file
    
    return validators;
  }

  public canTransition(to: GameState): boolean {
    const allowedStates = this.allowedTransitions.get(this.currentState);
    return allowedStates ? allowedStates.includes(to) : false;
  }

  public transition(action: GameAction): boolean {
    const targetState = this.determineTargetState(action);
    const isErrorTransition = action.type === 'error';
    
    if (!targetState || !this.canTransition(targetState)) {
      this.handleError(new Error(`Invalid transition from ${this.currentState} to ${targetState}`), isErrorTransition);
      return false;
    }

    if (!this.validateAction(action)) {
      this.handleError(new Error(`Invalid action ${action.type} in state ${this.currentState}`), isErrorTransition);
      return false;
    }

    const transition: StateTransition = {
      from: this.currentState,
      to: targetState,
      trigger: action,
      timestamp: Date.now()
    };

    this.history.push(transition);
    this.currentState = targetState;
    this.createRecoveryPoint();

    return true;
  }

  private validateAction(action: GameAction): boolean {
    const stateValidators = this.validators.get(this.currentState);
    if (!stateValidators) return true;

    return stateValidators.every(validator => 
      validator.validate(action, this.currentState)
    );
  }

  private determineTargetState(action: GameAction): GameState | null {
    switch (action.type) {
      case 'initialize':
        return this.currentState === 'error' || this.currentState === 'idle' ? 'initializing' : null;
      case 'join':
        return this.currentState === 'initializing' ? 'waitingForPlayers' : null;
      case 'start':
        return this.currentState === 'waitingForPlayers' ? 'starting' : null;
      case 'deal':
        return this.currentState === 'starting' ? 'dealingCards' : null;
      case 'error':
        return 'error';
      default:
        return this.determineGameplayState(action);
    }
  }

  private determineGameplayState(action: GameAction): GameState | null {
    // This will contain the logic for determining state transitions during actual gameplay
    // Based on betting rounds, showdown conditions, etc.
    if (!this.tableState) return null;

    switch (this.currentState) {
      case 'preFlop':
        return this.shouldAdvanceFromPreFlop() ? 'flop' : null;
      case 'flop':
        return this.shouldAdvanceFromFlop() ? 'turn' : null;
      case 'turn':
        return this.shouldAdvanceFromTurn() ? 'river' : null;
      case 'river':
        return this.shouldAdvanceFromRiver() ? 'showdown' : null;
      default:
        return null;
    }
  }

  private shouldAdvanceFromPreFlop(): boolean {
    return this.allPlayerActionsComplete() && this.betsAreEqual();
  }

  private shouldAdvanceFromFlop(): boolean {
    return this.allPlayerActionsComplete() && this.betsAreEqual();
  }

  private shouldAdvanceFromTurn(): boolean {
    return this.allPlayerActionsComplete() && this.betsAreEqual();
  }

  private shouldAdvanceFromRiver(): boolean {
    return this.allPlayerActionsComplete() && this.betsAreEqual();
  }

  private allPlayerActionsComplete(): boolean {
    if (!this.tableState) return false;
    return this.tableState.players
      .filter(p => !p.isFolded)
      .every(p => p.hasActed || p.isAllIn);
  }

  private betsAreEqual(): boolean {
    if (!this.tableState) return false;
    const activePlayers = this.tableState.players.filter(p => !p.isFolded && !p.isAllIn);
    if (activePlayers.length === 0) return true;
    
    const targetBet = this.tableState.currentBet;
    return activePlayers.every(p => p.currentBet === targetBet);
  }

  private handleError(error: Error, isErrorTransition: boolean = false): void {
    console.error(`State Machine Error: ${error.message}`);
    if (!isErrorTransition) {
      const prevState = this.currentState;
      this.currentState = 'error';
      this.history.push({
        from: prevState,
        to: 'error',
        trigger: {
          type: 'error',
          tableId: this.tableState?.tableId || '',
          timestamp: Date.now(),
          metadata: { error: error.message }
        },
        timestamp: Date.now()
      });
    }
  }

  private createRecoveryPoint(): void {
    if (['preFlop', 'flop', 'turn', 'river', 'showdown'].includes(this.currentState)) {
      const recovery: RecoveryPoint = {
        state: this.currentState,
        timestamp: Date.now(),
        snapshot: this.tableState ? { ...this.tableState } : null,
        transitions: [...this.history]
      };
      this.recovery.push(recovery);

      // Keep only last 5 recovery points
      if (this.recovery.length > 5) {
        this.recovery.shift();
      }
    }
  }

  public getLastRecoveryPoint(): RecoveryPoint | null {
    return this.recovery.length > 0 ? this.recovery[this.recovery.length - 1] : null;
  }

  public resetToRecoveryPoint(point: RecoveryPoint): boolean {
    if (!point || !point.snapshot) return false;

    this.currentState = point.state;
    this.tableState = { ...point.snapshot };
    this.history = [...point.transitions];
    
    return true;
  }

  public setTableState(state: TableState): void {
    this.tableState = state;
  }

  public getTableState(): TableState | null {
    return this.tableState;
  }
}
