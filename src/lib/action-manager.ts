/**
 * ActionManager - deprecated
 * Socket.IO transport has been removed. Use HTTP APIs with Supabase realtime instead.
 * This module is kept for backward compatibility but provides minimal functionality.
 */

import { PlayerAction, TableState, DisconnectionState } from '../types/poker';
import { PokerEngine } from './poker/poker-engine';

interface ActionResponse {
  success: boolean;
  error?: string;
  state?: TableState;
}

// Generic event emitter interface for compatibility
interface EventEmitter {
  emit: (event: string, data: any) => void;
  to: (room: string) => { emit: (event: string, data: any) => void };
  on: (event: string, handler: (...args: any[]) => void) => void;
}

// No-op emitter for when no io is provided
const noopEmitter: EventEmitter = {
  emit: () => {},
  to: () => ({ emit: () => {} }),
  on: () => {},
};

export class ActionManager {
  private actionTimeouts: Map<string, NodeJS.Timeout>;
  private disconnects: Map<string, DisconnectionState>;
  private pokerEngines: Map<string, PokerEngine> = new Map();
  private autoRunoutTimers: Map<string, NodeJS.Timeout[]> = new Map();
  private io: EventEmitter;

  constructor(_stateManager?: any, io?: EventEmitter) {
    console.warn('⚠️ ActionManager is deprecated. Socket.IO has been removed. Use HTTP APIs with Supabase realtime instead.');
    this.io = io || noopEmitter;
    this.actionTimeouts = new Map();
    this.disconnects = new Map();
  }

  // Deprecated - use HTTP API instead
  public processAction(_action: PlayerAction): ActionResponse {
    console.warn('⚠️ ActionManager.processAction is deprecated. Use HTTP API /api/games/action instead.');
    return { success: false, error: 'Socket.IO transport has been removed. Use HTTP API instead.' };
  }

  // Deprecated - use HTTP API instead  
  public handleDisconnect(_playerId: string, _tableId: string): void {
    console.warn('⚠️ ActionManager.handleDisconnect is deprecated.');
  }

  // Deprecated - use HTTP API instead
  public handleReconnect(_playerId: string, _tableId: string): void {
    console.warn('⚠️ ActionManager.handleReconnect is deprecated.');
  }

  // Deprecated - use HTTP API instead
  public scheduleAutoFold(_playerId: string, _tableId: string, _delay: number): void {
    console.warn('⚠️ ActionManager.scheduleAutoFold is deprecated.');
  }

  // Deprecated - use HTTP API instead
  public cancelAutoFold(_playerId: string, _tableId: string): void {
    console.warn('⚠️ ActionManager.cancelAutoFold is deprecated.');
  }

  public getPokerEngine(tableId: string): PokerEngine | undefined {
    return this.pokerEngines.get(tableId);
  }

  public setPokerEngine(tableId: string, engine: PokerEngine): void {
    this.pokerEngines.set(tableId, engine);
  }

  public removePokerEngine(tableId: string): void {
    this.pokerEngines.delete(tableId);
  }
}
