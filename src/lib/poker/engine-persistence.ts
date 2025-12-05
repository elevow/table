/**
 * Engine persistence utilities for serverless environments.
 * 
 * On Vercel (and similar serverless platforms), each API request can hit
 * a different function instance. This means in-memory storage (global.activeGames)
 * doesn't persist between requests. This module provides utilities to:
 * 
 * 1. Save engine state to database after game starts/actions
 * 2. Restore engine from database if not found in memory
 */

import { PokerEngine } from './poker-engine';
import { getPool } from '../database/pool';
import { Card, TableState } from '../../types/poker';

export interface SerializedEngineState {
  tableState: TableState;
  deck: Card[];
  removedPlayers: string[];
  rabbitPreviewed: number;
  requireRitUnanimous: boolean;
  ritConsents: string[];
}

/**
 * Save the engine state to the database for persistence.
 * This should be called after starting a game or processing an action.
 */
export async function persistEngineState(tableId: string, engine: PokerEngine): Promise<void> {
  try {
    const pool = getPool();
    const serialized = engine.serialize();
    
    // Update the active_games table with the full engine state
    await pool.query(
      `UPDATE active_games 
       SET state = $1, last_action_at = NOW() 
       WHERE room_id = $2`,
      [JSON.stringify(serialized), tableId]
    );
  } catch (error) {
    // Log but don't throw - we don't want persistence failures to break gameplay
    // when running locally without a database
    console.warn('[engine-persistence] Failed to persist engine state:', error);
  }
}

/**
 * Attempt to restore an engine from the database.
 * Returns null if no state is found or if restoration fails.
 */
export async function restoreEngineFromDb(tableId: string): Promise<PokerEngine | null> {
  try {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT state FROM active_games WHERE room_id = $1 LIMIT 1`,
      [tableId]
    );
    
    if (!result.rows[0]?.state) {
      return null;
    }
    
    const raw = result.rows[0].state;
    
    // Runtime validation of the serialized state structure
    if (!isValidSerializedState(raw)) {
      console.warn('[engine-persistence] Invalid serialized state - validation failed');
      return null;
    }
    
    return PokerEngine.fromSerialized(raw);
  } catch (error) {
    console.warn('[engine-persistence] Failed to restore engine from DB:', error);
    return null;
  }
}

/**
 * Type guard to validate the serialized state structure at runtime
 */
function isValidSerializedState(data: unknown): data is SerializedEngineState {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  
  // Check required fields
  if (!obj.tableState || typeof obj.tableState !== 'object') return false;
  if (!Array.isArray(obj.deck)) return false;
  
  // Validate tableState has minimum required structure
  const ts = obj.tableState as Record<string, unknown>;
  if (typeof ts.tableId !== 'string') return false;
  if (!Array.isArray(ts.players)) return false;
  if (typeof ts.smallBlind !== 'number') return false;
  if (typeof ts.bigBlind !== 'number') return false;
  
  return true;
}

/**
 * Get or restore engine from memory or database.
 * This is the main entry point for action handlers that need the engine.
 * 
 * Flow:
 * 1. Check global.activeGames (in-memory cache)
 * 2. If not found, attempt to restore from database
 * 3. If restored, update the in-memory cache for subsequent requests
 */
export async function getOrRestoreEngine(tableId: string): Promise<PokerEngine | null> {
  const g: any = global as any;
  
  // First check in-memory cache
  const cachedEngine = g?.activeGames?.get(tableId);
  if (cachedEngine && typeof cachedEngine.getState === 'function') {
    return cachedEngine;
  }
  
  // Try to restore from database
  const restoredEngine = await restoreEngineFromDb(tableId);
  if (restoredEngine) {
    // Update in-memory cache for this instance
    if (!g.activeGames) {
      g.activeGames = new Map<string, PokerEngine>();
    }
    g.activeGames.set(tableId, restoredEngine);
    console.log(`[engine-persistence] Restored engine for table ${tableId} from database`);
    return restoredEngine;
  }
  
  return null;
}
