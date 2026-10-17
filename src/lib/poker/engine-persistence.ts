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
  // Save counter added by persistEngineState; absent on states saved before versioning
  version?: number;
  deck: Card[];
  removedPlayers: string[];
  rabbitPreviewed: number;
  requireRitUnanimous: boolean;
  ritConsents: string[];
}

/**
 * Saved row and version each restored engine was loaded from. Saves check the version so a
 * request working from an older copy cannot overwrite a change another request already saved.
 */
const loadedFrom = new WeakMap<PokerEngine, { rowId: string; version: number }>();

/**
 * saved: written. conflict: another request saved a newer state since this engine was loaded,
 * so nothing was written. failed: the database was unavailable (e.g. local runs without one).
 */
export type PersistResult = 'saved' | 'conflict' | 'failed';

/** Thrown to stop a multi-step flow (such as an auto-runout) whose state was superseded. */
export class StaleGameStateError extends Error {
  constructor(tableId: string) {
    super(`Game state for table ${tableId} changed while this request was running`);
    this.name = 'StaleGameStateError';
  }
}

/** Response body for a request whose game state was superseded before it could be saved. */
export const STALE_STATE_RESPONSE = {
  error: 'The game changed while this request was running; refresh and try again',
  code: 'STALE_GAME_STATE',
} as const;

// The version lives in the saved JSON, so no schema change is needed; rows saved before
// versioning count as version 0.
const SAVED_VERSION = `COALESCE((state->>'version')::bigint, 0)`;

/**
 * Save the engine state to the database for persistence.
 * This should be called after starting a game or processing an action.
 */
export async function persistEngineState(tableId: string, engine: PokerEngine): Promise<PersistResult> {
  try {
    const pool = getPool();
    const serialized = engine.serialize();
    const stateJson = JSON.stringify(serialized);
    const loaded = loadedFrom.get(engine);

    if (loaded) {
      // Write only if nobody has saved since this engine was loaded
      const result = await pool.query(
        `UPDATE active_games
         SET state = jsonb_set($1::jsonb, '{version}', to_jsonb($3::bigint + 1)), last_action_at = NOW()
         WHERE id = $2 AND ${SAVED_VERSION} = $3`,
        [stateJson, loaded.rowId, loaded.version]
      );
      if ((result.rowCount ?? 0) === 0) {
        console.warn(`[engine-persistence] Stale state for table ${tableId}; another request saved first`);
        return 'conflict';
      }
      loaded.version += 1;
      return 'saved';
    }

    // A new engine (e.g. a game just started) replaces the most recent row for the room
    const result = await pool.query(
      `UPDATE active_games
       SET state = jsonb_set($1::jsonb, '{version}', to_jsonb(${SAVED_VERSION} + 1)), last_action_at = NOW()
       WHERE id = (
         SELECT id FROM active_games WHERE room_id = $2 ORDER BY last_action_at DESC LIMIT 1
       )
       RETURNING id, ${SAVED_VERSION} AS version`,
      [stateJson, tableId]
    );

    // If no existing row was updated (e.g. service.startGame() never ran or failed),
    // insert a new one so the engine can be restored in serverless environments.
    if ((result.rowCount ?? 0) === 0) {
      const ts = serialized.tableState;
      const activePlr = ts.players.find(p => p.id === ts.activePlayer);
      const currentPlayerPosition = activePlr?.position ?? 0;

      const inserted = await pool.query(
        `INSERT INTO active_games (room_id, dealer_position, current_player_position, pot, state)
         VALUES ($1, $2, $3, $4, jsonb_set($5::jsonb, '{version}', '1'))
         RETURNING id`,
        [
          tableId,
          Number(ts.dealerPosition) || 0,
          Number(currentPlayerPosition) || 0,
          Number(ts.pot) || 0,
          stateJson,
        ]
      );
      trackSavedRow(engine, inserted.rows?.[0]?.id, 1);
    } else {
      trackSavedRow(engine, result.rows?.[0]?.id, Number(result.rows?.[0]?.version));
    }
    return 'saved';
  } catch (error) {
    // Log but don't throw - we don't want persistence failures to break gameplay
    // when running locally without a database
    console.warn('[engine-persistence] Failed to persist engine state:', error);
    return 'failed';
  }
}

function trackSavedRow(engine: PokerEngine, rowId: unknown, version: number): void {
  if (typeof rowId === 'string' && Number.isFinite(version)) {
    loadedFrom.set(engine, { rowId, version });
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
      `SELECT id, state FROM active_games WHERE room_id = $1 ORDER BY last_action_at DESC LIMIT 1`,
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
    
    const engine = PokerEngine.fromSerialized(raw);
    const version = Number((raw as { version?: unknown }).version);
    trackSavedRow(engine, result.rows[0].id, Number.isFinite(version) ? version : 0);
    return engine;
  } catch (error) {
    console.warn('[engine-persistence] Failed to restore engine from DB:', error);
    return null;
  }
}

/**
 * Returns when the table's saved game last changed, or null if there is no saved
 * game or the database is unavailable.
 */
export async function getLastActionAt(tableId: string): Promise<Date | null> {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT last_action_at FROM active_games WHERE room_id = $1 ORDER BY last_action_at DESC LIMIT 1`,
      [tableId]
    );
    const value = result.rows[0]?.last_action_at;
    return value ? new Date(value) : null;
  } catch (error) {
    console.warn('[engine-persistence] Failed to read last action time:', error);
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
  
  // Keep the cached engine as a fallback when persistence is unavailable.
  const cachedEngine = g?.activeGames?.get(tableId);
  const validCachedEngine = cachedEngine && typeof cachedEngine.getState === 'function'
    ? cachedEngine
    : null;
  
  // Serverless instances can retain stale engines after another instance updates the table.
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
  
  return validCachedEngine;
}
