// US-009: Player Profile Storage - Data Access Layer Implementation

import { Pool, PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import {
  Player,
  PlayerStats,
  BankrollTransaction,
  PlayerGameStats,
  PlayerAchievement,
  PlayerPreferences,
  PlayerSummary,
  CreatePlayerRequest,
  UpdatePlayerRequest,
  BankrollUpdateRequest,
  BankrollUpdateResponse,
  PlayerQueryOptions,
  PlayerFilters,
  PaginationOptions,
  PaginatedPlayersResponse,
  TransactionType,
  PreferenceCategory,
  PlayerValidationRules
} from '../../types/player-profile';

// Concrete implementation of PlayerProfileError interface
class PlayerProfileError extends Error {
  code: string;
  details?: Record<string, any>;

  constructor(message: string, code = 'UNKNOWN_ERROR', details?: Record<string, any>) {
    super(message);
    this.name = 'PlayerProfileError';
    this.code = code;
    this.details = details;
  }
}

export class PlayerProfileManager {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // Player CRUD Operations
  async createPlayer(request: CreatePlayerRequest): Promise<Player> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Validate input
      this.validatePlayerCreation(request);
      
      // Check for existing username
      const usernameCheck = await client.query(
        'SELECT id FROM players WHERE username = $1',
        [request.username]
      );
      
      if (usernameCheck.rows.length > 0) {
        throw new PlayerProfileError('Username already exists', 'USERNAME_EXISTS');
      }
      
      // Check for existing email
      const emailCheck = await client.query(
        'SELECT id FROM players WHERE email = $1',
        [request.email]
      );
      
      if (emailCheck.rows.length > 0) {
        throw new PlayerProfileError('Email already exists', 'EMAIL_EXISTS');
      }
      
      // Hash password
      const passwordHash = await bcrypt.hash(request.password, 12);
      
      // Create player
      const playerId = uuidv4();
      const verificationToken = uuidv4();
      
      const playerQuery = `
        INSERT INTO players (
          id, username, email, password_hash, avatar_url, 
          verification_token, bankroll
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      
      const playerResult = await client.query(playerQuery, [
        playerId,
        request.username,
        request.email,
        passwordHash,
        request.avatarUrl || null,
        verificationToken,
        request.initialDeposit || 0
      ]);
      
      // Create initial bankroll transaction if deposit provided
      if (request.initialDeposit && request.initialDeposit > 0) {
        await client.query(`
          INSERT INTO bankroll_history (
            player_id, amount, balance_before, balance_after,
            transaction_type, description
          ) VALUES ($1, $2, 0, $3, $4, $5)
        `, [
          playerId,
          request.initialDeposit,
          request.initialDeposit,
          TransactionType.DEPOSIT,
          'Initial deposit'
        ]);
      }
      
      // Initialize default preferences
      await this.initializeDefaultPreferences(client, playerId);
      
      await client.query('COMMIT');
      
      return this.mapDatabasePlayerToPlayer(playerResult.rows[0]);
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw this.handlePlayerError(error, 'PLAYER_CREATION_FAILED');
    } finally {
      client.release();
    }
  }

  async getPlayerById(playerId: string, options: PlayerQueryOptions = {}): Promise<Player | null> {
    const client = await this.pool.connect();
    
    try {
      const playerQuery = 'SELECT * FROM players WHERE id = $1 AND is_active = true';
      const result = await client.query(playerQuery, [playerId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const player = this.mapDatabasePlayerToPlayer(result.rows[0]);
      
      // Enrich with additional data if requested
      if (options.includeStats || options.includeRecentActivity) {
        const summaryResult = await client.query(
          'SELECT get_player_summary($1) as summary',
          [playerId]
        );
        
        if (summaryResult.rows[0]?.summary) {
          const summary = summaryResult.rows[0].summary;
          player.stats = {
            ...player.stats,
            totalHands: summary.total_hands_played || 0,
            totalProfit: summary.total_profit || 0
          };
        }
      }
      
      return player;
      
    } finally {
      client.release();
    }
  }

  async getPlayerByUsername(username: string): Promise<Player | null> {
    const client = await this.pool.connect();
    
    try {
      const query = 'SELECT * FROM players WHERE username = $1 AND is_active = true';
      const result = await client.query(query, [username]);
      
      return result.rows.length > 0 ? this.mapDatabasePlayerToPlayer(result.rows[0]) : null;
      
    } finally {
      client.release();
    }
  }

  async getPlayerByEmail(email: string): Promise<Player | null> {
    const client = await this.pool.connect();
    
    try {
      const query = 'SELECT * FROM players WHERE email = $1 AND is_active = true';
      const result = await client.query(query, [email]);
      
      return result.rows.length > 0 ? this.mapDatabasePlayerToPlayer(result.rows[0]) : null;
      
    } finally {
      client.release();
    }
  }

  async updatePlayer(playerId: string, updates: UpdatePlayerRequest): Promise<Player> {
    const client = await this.pool.connect();
    
    try {
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;
      
      if (updates.username !== undefined) {
        updateFields.push(`username = $${paramIndex++}`);
        values.push(updates.username);
      }
      
      if (updates.email !== undefined) {
        updateFields.push(`email = $${paramIndex++}`);
        values.push(updates.email);
      }
      
      if (updates.avatarUrl !== undefined) {
        updateFields.push(`avatar_url = $${paramIndex++}`);
        values.push(updates.avatarUrl);
      }
      
      if (updates.stats !== undefined) {
        updateFields.push(`stats = stats || $${paramIndex++}::jsonb`);
        values.push(JSON.stringify(updates.stats));
      }
      
      updateFields.push(`updated_at = NOW()`);
      values.push(playerId);
      
      const query = `
        UPDATE players 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex} AND is_active = true
        RETURNING *
      `;
      
      const result = await client.query(query, values);
      
      if (result.rows.length === 0) {
        throw new PlayerProfileError('Player not found', 'PLAYER_NOT_FOUND');
      }
      
      return this.mapDatabasePlayerToPlayer(result.rows[0]);
      
    } finally {
      client.release();
    }
  }

  async deletePlayer(playerId: string): Promise<boolean> {
    const client = await this.pool.connect();
    
    try {
      // Soft delete by setting is_active to false
      const query = `
        UPDATE players 
        SET is_active = false, updated_at = NOW()
        WHERE id = $1 AND is_active = true
      `;
      
      const result = await client.query(query, [playerId]);
      return (result.rowCount ?? 0) > 0;
      
    } finally {
      client.release();
    }
  }

  // Bankroll Management
  async updateBankroll(request: BankrollUpdateRequest): Promise<BankrollUpdateResponse> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(
        'SELECT update_player_bankroll($1, $2, $3, $4, $5, $6) as result',
        [
          request.playerId,
          request.amount,
          request.transactionType,
          request.description || null,
          request.gameId || null,
          JSON.stringify(request.metadata || {})
        ]
      );
      
      const bankrollResult = result.rows?.[0]?.result;
      
      if (!bankrollResult || !bankrollResult.success) {
        throw new PlayerProfileError('Bankroll update failed', 'BANKROLL_UPDATE_FAILED');
      }
      
      return {
        success: true,
        previousBalance: parseFloat(bankrollResult.previous_balance),
        newBalance: parseFloat(bankrollResult.new_balance),
        transactionId: bankrollResult.transaction_id
      };
      
    } finally {
      client.release();
    }
  }

  async getBankrollHistory(
    playerId: string, 
    limit: number = 50, 
    offset: number = 0
  ): Promise<BankrollTransaction[]> {
    const client = await this.pool.connect();
    
    try {
      const query = `
        SELECT * FROM bankroll_history 
        WHERE player_id = $1 
        ORDER BY created_at DESC 
        LIMIT $2 OFFSET $3
      `;
      
      const result = await client.query(query, [playerId, limit, offset]);
      
      return result.rows.map(row => ({
        id: row.id,
        playerId: row.player_id,
        amount: parseFloat(row.amount),
        balanceBefore: parseFloat(row.balance_before),
        balanceAfter: parseFloat(row.balance_after),
        transactionType: row.transaction_type as TransactionType,
        description: row.description,
        gameId: row.game_id,
        createdAt: row.created_at,
        metadata: row.metadata
      }));
      
    } finally {
      client.release();
    }
  }

  // Game Statistics Management
  async updateGameStats(stats: Partial<PlayerGameStats>): Promise<PlayerGameStats> {
    const client = await this.pool.connect();
    
    try {
      const query = `
        INSERT INTO player_game_stats (
          player_id, game_type, stakes_level, hands_played, total_profit,
          biggest_win, biggest_loss, vpip, pfr, aggression_factor,
          total_session_time, last_played
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (player_id, game_type, stakes_level) 
        DO UPDATE SET
          hands_played = player_game_stats.hands_played + EXCLUDED.hands_played,
          total_profit = player_game_stats.total_profit + EXCLUDED.total_profit,
          biggest_win = GREATEST(player_game_stats.biggest_win, EXCLUDED.biggest_win),
          biggest_loss = LEAST(player_game_stats.biggest_loss, EXCLUDED.biggest_loss),
          vpip = EXCLUDED.vpip,
          pfr = EXCLUDED.pfr,
          aggression_factor = EXCLUDED.aggression_factor,
          total_session_time = player_game_stats.total_session_time + EXCLUDED.total_session_time,
          last_played = EXCLUDED.last_played,
          updated_at = NOW()
        RETURNING *
      `;
      
      const result = await client.query(query, [
        stats.playerId,
        stats.gameType,
        stats.stakesLevel,
        stats.handsPlayed || 0,
        stats.totalProfit || 0,
        stats.biggestWin || 0,
        stats.biggestLoss || 0,
        stats.vpip || 0,
        stats.pfr || 0,
        stats.aggressionFactor || 0,
        stats.totalSessionTime || 0,
        stats.lastPlayed || new Date()
      ]);
      
      return this.mapDatabaseStatsToGameStats(result.rows[0]);
      
    } finally {
      client.release();
    }
  }

  // Player Search and Pagination
  async searchPlayers(
    filters: PlayerFilters = {}, 
    pagination: PaginationOptions
  ): Promise<PaginatedPlayersResponse> {
    const client = await this.pool.connect();
    
    try {
      const whereConditions: string[] = ['is_active = true'];
      const values: any[] = [];
      let paramIndex = 1;
      
      // Build where conditions
      if (filters.username) {
        whereConditions.push(`username ILIKE $${paramIndex++}`);
        values.push(`%${filters.username}%`);
      }
      
      if (filters.email) {
        whereConditions.push(`email ILIKE $${paramIndex++}`);
        values.push(`%${filters.email}%`);
      }
      
      if (filters.minBankroll !== undefined) {
        whereConditions.push(`bankroll >= $${paramIndex++}`);
        values.push(filters.minBankroll);
      }
      
      if (filters.maxBankroll !== undefined) {
        whereConditions.push(`bankroll <= $${paramIndex++}`);
        values.push(filters.maxBankroll);
      }
      
      if (filters.createdAfter) {
        whereConditions.push(`created_at >= $${paramIndex++}`);
        values.push(filters.createdAfter);
      }
      
      if (filters.createdBefore) {
        whereConditions.push(`created_at <= $${paramIndex++}`);
        values.push(filters.createdBefore);
      }
      
      const whereClause = whereConditions.join(' AND ');
      
      // Count total
      const countQuery = `SELECT COUNT(*) as total FROM players WHERE ${whereClause}`;
      const countResult = await client.query(countQuery, values);
      const total = parseInt(countResult?.rows?.[0]?.total || '0');
      
      // Get paginated results
      const orderBy = pagination.sortBy || 'created_at';
      const order = pagination.sortOrder || 'desc';
      const offset = (pagination.page - 1) * pagination.limit;
      
      const dataQuery = `
        SELECT * FROM players 
        WHERE ${whereClause}
        ORDER BY ${orderBy} ${order}
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;
      
      values.push(pagination.limit, offset);
      const dataResult = await client.query(dataQuery, values);
      const players = dataResult?.rows?.map(row => this.mapDatabasePlayerToPlayer(row)) || [];
      
      return {
        players,
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.ceil(total / pagination.limit)
      };
      
    } finally {
      client.release();
    }
  }

  // Player Summary and Complete Profile
  async getPlayerSummary(playerId: string): Promise<PlayerSummary | null> {
    const client = await this.pool.connect();
    
    try {
      const summaryResult = await client.query(
        'SELECT get_player_summary($1) as summary',
        [playerId]
      );
      
      if (!summaryResult.rows[0]?.summary) {
        return null;
      }
      
      const summary = summaryResult.rows[0].summary;
      
      if (summary.error) {
        return null;
      }
      
      // Get additional data
      const [gameStatsResult, achievementsResult, preferencesResult] = await Promise.all([
        client.query('SELECT * FROM player_game_stats WHERE player_id = $1', [playerId]),
        client.query('SELECT * FROM player_achievements WHERE player_id = $1 ORDER BY earned_at DESC', [playerId]),
        client.query('SELECT * FROM player_preferences WHERE player_id = $1', [playerId])
      ]);
      
      return {
        player: {
          id: summary.id,
          username: summary.username,
          email: summary.email,
          avatarUrl: summary.avatar_url,
          createdAt: new Date(summary.created_at),
          updatedAt: new Date(),
          lastLogin: summary.last_login ? new Date(summary.last_login) : undefined,
          bankroll: parseFloat(summary.bankroll),
          stats: summary.stats || {},
          isActive: true,
          emailVerified: false
        },
        totalHandsPlayed: summary.total_hands_played || 0,
        totalProfit: parseFloat(summary.total_profit || '0'),
        recentActivity: summary.recent_activity || [],
        gameStats: gameStatsResult.rows.map(row => this.mapDatabaseStatsToGameStats(row)),
        achievements: achievementsResult.rows.map(row => this.mapDatabaseAchievement(row)),
        preferences: preferencesResult.rows.map(row => this.mapDatabasePreferences(row))
      };
      
    } finally {
      client.release();
    }
  }

  // Helper Methods
  private async initializeDefaultPreferences(client: PoolClient, playerId: string): Promise<void> {
    const defaultPreferences = [
      {
        category: PreferenceCategory.UI,
        preferences: {
          theme: 'dark',
          language: 'en',
          animations: true,
          soundEffects: true
        }
      },
      {
        category: PreferenceCategory.GAME,
        preferences: {
          autoFold: false,
          showOdds: true,
          quickBet: false,
          confirmActions: true
        }
      },
      {
        category: PreferenceCategory.NOTIFICATIONS,
        preferences: {
          email: true,
          browser: true,
          gameUpdates: true,
          promotions: false
        }
      }
    ];
    
    for (const pref of defaultPreferences) {
      await client.query(`
        INSERT INTO player_preferences (player_id, category, preferences)
        VALUES ($1, $2, $3)
      `, [playerId, pref.category, JSON.stringify(pref.preferences)]);
    }
  }

  private validatePlayerCreation(request: CreatePlayerRequest): void {
    if (!request.username || request.username.length < PlayerValidationRules.username.minLength) {
      throw new PlayerProfileError('Username too short', 'VALIDATION_ERROR');
    }
    
    if (!PlayerValidationRules.username.pattern.test(request.username)) {
      throw new PlayerProfileError('Invalid username format', 'VALIDATION_ERROR');
    }
    
    if (!PlayerValidationRules.email.pattern.test(request.email)) {
      throw new PlayerProfileError('Invalid email format', 'VALIDATION_ERROR');
    }
    
    if (request.password.length < PlayerValidationRules.password.minLength) {
      throw new PlayerProfileError('Password too short', 'VALIDATION_ERROR');
    }
  }

  private mapDatabasePlayerToPlayer(row: any): Player {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      avatarUrl: row.avatar_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLogin: row.last_login,
      bankroll: parseFloat(row.bankroll),
      stats: row.stats || {},
      isActive: row.is_active,
      emailVerified: row.email_verified,
      verificationToken: row.verification_token,
      resetToken: row.reset_token,
      resetTokenExpires: row.reset_token_expires
    };
  }

  private mapDatabaseStatsToGameStats(row: any): PlayerGameStats {
    return {
      id: row.id,
      playerId: row.player_id,
      gameType: row.game_type,
      stakesLevel: row.stakes_level,
      handsPlayed: row.hands_played,
      totalProfit: parseFloat(row.total_profit),
      biggestWin: parseFloat(row.biggest_win),
      biggestLoss: parseFloat(row.biggest_loss),
      vpip: parseFloat(row.vpip),
      pfr: parseFloat(row.pfr),
      aggressionFactor: parseFloat(row.aggression_factor),
      totalSessionTime: row.total_session_time,
      lastPlayed: row.last_played,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapDatabaseAchievement(row: any): PlayerAchievement {
    return {
      id: row.id,
      playerId: row.player_id,
      achievementType: row.achievement_type,
      achievementName: row.achievement_name,
      description: row.description,
      earnedAt: row.earned_at,
      metadata: row.metadata
    };
  }

  private mapDatabasePreferences(row: any): PlayerPreferences {
    return {
      id: row.id,
      playerId: row.player_id,
      category: row.category as PreferenceCategory,
      preferences: row.preferences,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private handlePlayerError(error: any, code: string): PlayerProfileError {
    const errorMessage = error?.message || 'Player operation failed';
    const playerError = new PlayerProfileError(errorMessage, code);
    
    if (error?.code === '23505') { // Unique constraint violation
      if (error.detail?.includes('username')) {
        playerError.message = 'Username already exists';
        playerError.code = 'USERNAME_EXISTS';
      } else if (error.detail?.includes('email')) {
        playerError.message = 'Email already exists';
        playerError.code = 'EMAIL_EXISTS';
      }
    }
    
    return playerError;
  }
}
