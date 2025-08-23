// US-010: Game History Recording - Data Access Layer Implementation

import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  GameHistoryRecord,
  GameAction,
  GameResults,
  PlayerResult,
  PotDistribution,
  CreateGameHistoryRequest,
  GameHistoryQueryOptions,
  GameHistoryFilters,
  PaginatedGameHistoryResponse,
  GameAnalytics,
  PlayerGameStats,
  GameHistoryRow
} from '../../types/game-history';

// Custom error class for game history operations
class GameHistoryError extends Error {
  code: string;
  details?: Record<string, any>;

  constructor(message: string, code = 'UNKNOWN_ERROR', details?: Record<string, any>) {
    super(message);
    this.name = 'GameHistoryError';
    this.code = code;
    this.details = details;
  }
}

export class GameHistoryManager {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Record a new game history entry
   */
  async recordGameHistory(request: CreateGameHistoryRequest): Promise<GameHistoryRecord> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Validate the request
      this.validateGameHistoryRequest(request);

      const gameId = uuidv4();
      const query = `
        INSERT INTO game_history (
          id, table_id, hand_id, action_sequence, community_cards, 
          results, started_at, ended_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;

      const values = [
        gameId,
        request.tableId,
        request.handId,
        JSON.stringify(request.actionSequence),
        request.communityCards,
        JSON.stringify(request.results),
        request.startedAt,
        request.endedAt
      ];

      const result = await client.query(query, values);
      
      if (result.rows.length === 0) {
        throw new GameHistoryError('Failed to create game history record', 'CREATION_FAILED');
      }

      const row = result.rows[0];

      // Also record individual player actions for analytics
      await this.recordPlayerActions(client, gameId, request.actionSequence);

      await client.query('COMMIT');

      return this.mapRowToGameHistory(row);
      
    } catch (error) {
      await client.query('ROLLBACK');
      
      if (error instanceof GameHistoryError) {
        throw error;
      }
      
      throw this.handleDatabaseError(error, 'recordGameHistory');
    } finally {
      client.release();
    }
  }

  /**
   * Get game history by ID
   */
  async getGameHistoryById(id: string): Promise<GameHistoryRecord | null> {
    const client = await this.pool.connect();
    
    try {
      const query = 'SELECT * FROM game_history WHERE id = $1';
      const result = await client.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return this.mapRowToGameHistory(result.rows[0]);
      
    } catch (error) {
      throw this.handleDatabaseError(error, 'getGameHistoryById');
    } finally {
      client.release();
    }
  }

  /**
   * Query game history with filters and pagination
   */
  async queryGameHistory(
    options: GameHistoryQueryOptions = {},
    filters: GameHistoryFilters = {}
  ): Promise<PaginatedGameHistoryResponse> {
    const client = await this.pool.connect();
    
    try {
      const { query, countQuery, values } = this.buildGameHistoryQuery(options, filters);
      
      // Get total count
      const countResult = await client.query(countQuery, values.slice(0, -2)); // Remove limit and offset
      const total = parseInt(countResult.rows[0].count, 10);
      
      // Get records
      const result = await client.query(query, values);
      const records = result.rows.map(row => this.mapRowToGameHistory(row));
      
      const limit = options.limit || 50;
      const offset = options.offset || 0;
      const hasMore = offset + records.length < total;
      const nextOffset = hasMore ? offset + limit : undefined;
      
      return {
        records,
        total,
        hasMore,
        nextOffset
      };
      
    } catch (error) {
      throw this.handleDatabaseError(error, 'queryGameHistory');
    } finally {
      client.release();
    }
  }

  /**
   * Get game history for a specific player
   */
  async getPlayerGameHistory(
    playerId: string,
    options: GameHistoryQueryOptions = {}
  ): Promise<PaginatedGameHistoryResponse> {
    const client = await this.pool.connect();
    
    try {
      const query = `
        SELECT gh.* FROM game_history gh
        WHERE gh.action_sequence::text LIKE $1
        OR gh.results::text LIKE $1
        ORDER BY gh.started_at DESC
        LIMIT $2 OFFSET $3
      `;
      
      const countQuery = `
        SELECT COUNT(*) FROM game_history gh
        WHERE gh.action_sequence::text LIKE $1
        OR gh.results::text LIKE $1
      `;
      
      const playerPattern = `%"playerId":"${playerId}"%`;
      const limit = options.limit || 50;
      const offset = options.offset || 0;
      
      const [countResult, result] = await Promise.all([
        client.query(countQuery, [playerPattern]),
        client.query(query, [playerPattern, limit, offset])
      ]);
      
      const total = parseInt(countResult.rows[0].count, 10);
      const records = result.rows.map(row => this.mapRowToGameHistory(row));
      
      const hasMore = offset + records.length < total;
      const nextOffset = hasMore ? offset + limit : undefined;
      
      return {
        records,
        total,
        hasMore,
        nextOffset
      };
      
    } catch (error) {
      throw this.handleDatabaseError(error, 'getPlayerGameHistory');
    } finally {
      client.release();
    }
  }

  /**
   * Get game analytics for a date range
   */
  async getGameAnalytics(
    dateFrom: Date,
    dateTo: Date,
    tableId?: string
  ): Promise<GameAnalytics> {
    const client = await this.pool.connect();
    
    try {
      const whereClause = tableId 
        ? 'WHERE started_at >= $1 AND started_at <= $2 AND table_id = $3'
        : 'WHERE started_at >= $1 AND started_at <= $2';
      
      const values = tableId ? [dateFrom, dateTo, tableId] : [dateFrom, dateTo];
      
      const query = `
        SELECT 
          COUNT(*) as total_hands,
          AVG((results->>'totalPot')::numeric) as average_pot,
          SUM((results->>'totalPot')::numeric) as total_pot,
          AVG(EXTRACT(EPOCH FROM (ended_at - started_at))) as average_duration
        FROM game_history
        ${whereClause}
      `;
      
      const result = await client.query(query, values);
      const stats = result.rows[0];
      
      // Get most frequent action
      const actionQuery = `
        SELECT action_type, COUNT(*) as frequency
        FROM (
          SELECT jsonb_array_elements(action_sequence)->>'action' as action_type
          FROM game_history
          ${whereClause}
        ) actions
        GROUP BY action_type
        ORDER BY frequency DESC
        LIMIT 1
      `;
      
      const actionResult = await client.query(actionQuery, values);
      const mostFrequentAction = actionResult.rows[0]?.action_type || 'fold';
      
      return {
        totalHands: parseInt(stats.total_hands, 10),
        totalPot: parseFloat(stats.total_pot) || 0,
        averagePot: parseFloat(stats.average_pot) || 0,
        averageHandDuration: parseFloat(stats.average_duration) || 0,
        mostFrequentAction,
        playerStats: new Map() // TODO: Implement detailed player stats
      };
      
    } catch (error) {
      throw this.handleDatabaseError(error, 'getGameAnalytics');
    } finally {
      client.release();
    }
  }

  /**
   * Delete old game history records for cleanup
   */
  async cleanupOldRecords(olderThanDays: number): Promise<number> {
    const client = await this.pool.connect();
    
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      const query = `
        DELETE FROM game_history 
        WHERE started_at < $1
      `;
      
      const result = await client.query(query, [cutoffDate]);
      return result.rowCount || 0;
      
    } catch (error) {
      throw this.handleDatabaseError(error, 'cleanupOldRecords');
    } finally {
      client.release();
    }
  }

  /**
   * Record individual player actions for analytics
   */
  private async recordPlayerActions(
    client: PoolClient,
    gameId: string,
    actions: GameAction[]
  ): Promise<void> {
    if (actions.length === 0) return;
    
    const query = `
      INSERT INTO player_actions (
        id, game_id, player_id, action, amount, timestamp, position
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    
    for (const action of actions) {
      const actionId = uuidv4();
      await client.query(query, [
        actionId,
        gameId,
        action.playerId,
        action.action,
        action.amount || 0,
        action.timestamp,
        action.position
      ]);
    }
  }

  /**
   * Build dynamic query for game history with filters
   */
  private buildGameHistoryQuery(
    options: GameHistoryQueryOptions,
    filters: GameHistoryFilters
  ): { query: string; countQuery: string; values: any[] } {
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    // Add basic filters
    if (options.tableId) {
      conditions.push(`table_id = $${paramIndex++}`);
      values.push(options.tableId);
    }
    
    if (options.handId) {
      conditions.push(`hand_id = $${paramIndex++}`);
      values.push(options.handId);
    }
    
    if (options.dateFrom) {
      conditions.push(`started_at >= $${paramIndex++}`);
      values.push(options.dateFrom);
    }
    
    if (options.dateTo) {
      conditions.push(`started_at <= $${paramIndex++}`);
      values.push(options.dateTo);
    }
    
    // Add advanced filters
    if (filters.minPot) {
      conditions.push(`(results->>'totalPot')::numeric >= $${paramIndex++}`);
      values.push(filters.minPot);
    }
    
    if (filters.maxPot) {
      conditions.push(`(results->>'totalPot')::numeric <= $${paramIndex++}`);
      values.push(filters.maxPot);
    }
    
    if (filters.playerCount) {
      conditions.push(`jsonb_array_length(results->'winners') = $${paramIndex++}`);
      values.push(filters.playerCount);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderClause = 'ORDER BY started_at DESC';
    
    const limit = options.limit || 50;
    const offset = options.offset || 0;
    
    values.push(limit, offset);
    
    const query = `
      SELECT * FROM game_history 
      ${whereClause} 
      ${orderClause}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    
    const countQuery = `
      SELECT COUNT(*) FROM game_history 
      ${whereClause}
    `;
    
    return { query, countQuery, values };
  }

  /**
   * Map database row to GameHistoryRecord
   */
  private mapRowToGameHistory(row: GameHistoryRow): GameHistoryRecord {
    return {
      id: row.id,
      tableId: row.table_id,
      handId: row.hand_id,
      actionSequence: typeof row.action_sequence === 'string' 
        ? JSON.parse(row.action_sequence) 
        : row.action_sequence,
      communityCards: row.community_cards,
      results: typeof row.results === 'string' 
        ? JSON.parse(row.results) 
        : row.results,
      startedAt: new Date(row.started_at),
      endedAt: new Date(row.ended_at)
    };
  }

  /**
   * Validate game history request
   */
  private validateGameHistoryRequest(request: CreateGameHistoryRequest): void {
    if (!request.tableId || !request.handId) {
      throw new GameHistoryError('Table ID and Hand ID are required', 'VALIDATION_ERROR');
    }
    
    if (!request.actionSequence || request.actionSequence.length === 0) {
      throw new GameHistoryError('Action sequence cannot be empty', 'VALIDATION_ERROR');
    }
    
    if (!request.results) {
      throw new GameHistoryError('Game results are required', 'VALIDATION_ERROR');
    }
    
    if (request.startedAt >= request.endedAt) {
      throw new GameHistoryError('Start time must be before end time', 'VALIDATION_ERROR');
    }
  }

  /**
   * Handle database errors with context
   */
  private handleDatabaseError(error: any, operation: string): GameHistoryError {
    const gameHistoryError = new GameHistoryError(
      error.message || 'Database operation failed',
      'DATABASE_ERROR',
      { operation, originalError: error.code }
    );
    
    return gameHistoryError;
  }
}
