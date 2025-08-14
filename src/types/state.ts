import { GameAction } from './poker';

export type GameState = 
  | 'idle'
  | 'initializing'
  | 'waitingForPlayers'
  | 'starting'
  | 'dealingCards'
  | 'preFlop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'finished'
  | 'error';

export interface StateTransition {
  from: GameState;
  to: GameState;
  trigger: GameAction;
  timestamp: number;
}

export interface RecoveryPoint {
  state: GameState;
  timestamp: number;
  snapshot: any; // Game state snapshot
  transitions: StateTransition[];
}

export interface ActionValidator {
  validate(action: GameAction, state: GameState): boolean;
  getErrors(): string[];
}

export interface GameStateMachine {
  currentState: GameState;
  allowedTransitions: Map<GameState, GameState[]>;
  validators: Map<GameState, ActionValidator[]>;
  history: StateTransition[];
  recovery: RecoveryPoint[];
}

export interface StateDelta {
  changes: any;
  from: number;
  to: number;
}

export interface StateConflict {
  clientVersion: number;
  serverVersion: number;
  conflictType: 'merge' | 'override';
  resolution: 'client' | 'server' | 'merge';
  path: string;
  clientValue: any;
  serverValue: any;
  resolvedValue: any;
}

export interface StateSynchronization {
  version: number;
  timestamp: number;
  checksum: string;
  delta: StateDelta;
  conflicts: StateConflict[];
}

export type ConflictResolution = 'client' | 'server' | 'merge';
