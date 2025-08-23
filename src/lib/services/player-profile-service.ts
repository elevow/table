// US-009: Player Profile Storage - Service Layer
// High-level service interface for player profile management

import { PlayerProfileManager } from '../database/player-profile-manager';
import {
  Player,
  CreatePlayerRequest,
  UpdatePlayerRequest,
  BankrollUpdateRequest,
  BankrollUpdateResponse,
  PlayerSummary,
  PlayerFilters,
  PaginationOptions,
  PaginatedPlayersResponse,
  TransactionType,
  PlayerProfileError
} from '../../types/player-profile';

// Implementation of PlayerProfileError interface
class PlayerProfileErrorImpl extends Error implements PlayerProfileError {
  code: string;
  details?: Record<string, any>;
  
  constructor(message: string) {
    super(message);
    this.name = 'PlayerProfileError';
    this.code = 'UNKNOWN_ERROR';
  }
}

export class PlayerProfileService {
  private profileManager: PlayerProfileManager;

  constructor(profileManager: PlayerProfileManager) {
    this.profileManager = profileManager;
  }

  // Core Player Operations
  async createPlayer(request: CreatePlayerRequest): Promise<Player> {
    try {
      return await this.profileManager.createPlayer(request);
    } catch (error) {
      throw this.handleServiceError(error, 'Failed to create player');
    }
  }

  async getPlayer(playerId: string): Promise<Player | null> {
    try {
      return await this.profileManager.getPlayerById(playerId, {
        includeStats: true,
        includeRecentActivity: true
      });
    } catch (error) {
      throw this.handleServiceError(error, 'Failed to retrieve player');
    }
  }

  async updatePlayer(playerId: string, updates: UpdatePlayerRequest): Promise<Player> {
    try {
      return await this.profileManager.updatePlayer(playerId, updates);
    } catch (error) {
      throw this.handleServiceError(error, 'Failed to update player');
    }
  }

  async deletePlayer(playerId: string): Promise<boolean> {
    try {
      return await this.profileManager.deletePlayer(playerId);
    } catch (error) {
      throw this.handleServiceError(error, 'Failed to delete player');
    }
  }

  // Authentication Methods
  async authenticatePlayer(username: string, password: string): Promise<Player | null> {
    try {
      // This would integrate with your authentication system
      // For now, just return the player if found
      return await this.profileManager.getPlayerByUsername(username);
    } catch (error) {
      throw this.handleServiceError(error, 'Authentication failed');
    }
  }

  async verifyEmail(playerId: string, token: string): Promise<boolean> {
    try {
      // Implementation would verify the token and update email_verified
      const player = await this.profileManager.getPlayerById(playerId);
      if (!player || player.verificationToken !== token) {
        return false;
      }
      
      await this.profileManager.updatePlayer(playerId, {
        stats: { ...player.stats, emailVerified: true }
      });
      
      return true;
    } catch (error) {
      throw this.handleServiceError(error, 'Email verification failed');
    }
  }

  // Bankroll Management
  async depositFunds(playerId: string, amount: number, description?: string): Promise<BankrollUpdateResponse> {
    if (amount <= 0) {
      throw new PlayerProfileErrorImpl('Deposit amount must be positive');
    }

    return this.updateBankroll({
      playerId,
      amount,
      transactionType: TransactionType.DEPOSIT,
      description: description || 'Player deposit'
    });
  }

  async withdrawFunds(playerId: string, amount: number, description?: string): Promise<BankrollUpdateResponse> {
    if (amount <= 0) {
      throw new PlayerProfileErrorImpl('Withdrawal amount must be positive');
    }

    return this.updateBankroll({
      playerId,
      amount: -amount,
      transactionType: TransactionType.WITHDRAWAL,
      description: description || 'Player withdrawal'
    });
  }

  async recordGameWin(playerId: string, amount: number, gameId: string): Promise<BankrollUpdateResponse> {
    if (amount <= 0) {
      throw new PlayerProfileErrorImpl('Amount must be positive');
    }
    
    try {
      return await this.updateBankroll({
        playerId,
        amount,
        transactionType: TransactionType.GAME_WIN,
        description: 'Game winnings',
        gameId
      });
    } catch (error) {
      throw this.handleServiceError(error, 'Failed to record game win');
    }
  }

  async recordGameLoss(playerId: string, amount: number, gameId: string): Promise<BankrollUpdateResponse> {
    if (amount <= 0) {
      throw new PlayerProfileErrorImpl('Amount must be positive');
    }
    
    try {
      return await this.updateBankroll({
        playerId,
        amount: -amount,
        transactionType: TransactionType.GAME_LOSS,
        description: 'Game loss',
        gameId
      });
    } catch (error) {
      throw this.handleServiceError(error, 'Failed to record game loss');
    }
  }

  async recordRake(playerId: string, amount: number, gameId: string): Promise<BankrollUpdateResponse> {
    if (amount <= 0) {
      throw new PlayerProfileErrorImpl('Amount must be positive');
    }
    
    try {
      return await this.updateBankroll({
        playerId,
        amount: -amount,
        transactionType: TransactionType.RAKE,
        description: 'Rake fee',
        gameId
      });
    } catch (error) {
      throw this.handleServiceError(error, 'Failed to record rake payment');
    }
  }

  private async updateBankroll(request: BankrollUpdateRequest): Promise<BankrollUpdateResponse> {
    try {
      return await this.profileManager.updateBankroll(request);
    } catch (error) {
      throw this.handleServiceError(error, 'Bankroll update failed');
    }
  }

  // Player Search and Analytics
  async searchPlayers(filters: PlayerFilters = {}, pagination: PaginationOptions): Promise<PaginatedPlayersResponse> {
    try {
      return await this.profileManager.searchPlayers(filters, pagination);
    } catch (error) {
      throw this.handleServiceError(error, 'Player search failed');
    }
  }

  async getPlayerSummary(playerId: string): Promise<PlayerSummary | null> {
    try {
      return await this.profileManager.getPlayerSummary(playerId);
    } catch (error) {
      throw this.handleServiceError(error, 'Failed to retrieve player summary');
    }
  }

  async getLeaderboard(gameType?: string, stakesLevel?: string, limit: number = 50): Promise<Player[]> {
    try {
      const filters: PlayerFilters = {};
      const pagination: PaginationOptions = {
        page: 1,
        limit,
        sortBy: 'bankroll',
        sortOrder: 'desc'
      };

      const result = await this.profileManager.searchPlayers(filters, pagination);
      return result.players;
    } catch (error) {
      throw this.handleServiceError(error, 'Failed to retrieve leaderboard');
    }
  }

  // Player Statistics
  async updatePlayerGameStats(playerId: string, gameData: {
    gameType: string;
    stakesLevel: string;
    handsPlayed: number;
    profit: number;
    vpip?: number;
    pfr?: number;
    aggressionFactor?: number;
    sessionTime: number;
  }): Promise<void> {
    try {
      await this.profileManager.updateGameStats({
        playerId,
        gameType: gameData.gameType,
        stakesLevel: gameData.stakesLevel,
        handsPlayed: gameData.handsPlayed,
        totalProfit: gameData.profit,
        biggestWin: gameData.profit > 0 ? gameData.profit : 0,
        biggestLoss: gameData.profit < 0 ? gameData.profit : 0,
        vpip: gameData.vpip || 0,
        pfr: gameData.pfr || 0,
        aggressionFactor: gameData.aggressionFactor || 0,
        totalSessionTime: gameData.sessionTime,
        lastPlayed: new Date()
      });
    } catch (error) {
      throw this.handleServiceError(error, 'Failed to update game statistics');
    }
  }

  // Validation Helpers
  async validateUsernameAvailable(username: string): Promise<boolean> {
    try {
      const existingPlayer = await this.profileManager.getPlayerByUsername(username);
      return existingPlayer === null;
    } catch (error) {
      throw this.handleServiceError(error, 'Username validation failed');
    }
  }

  async validateEmailAvailable(email: string): Promise<boolean> {
    try {
      const existingPlayer = await this.profileManager.getPlayerByEmail(email);
      return existingPlayer === null;
    } catch (error) {
      throw this.handleServiceError(error, 'Email validation failed');
    }
  }

  // Utility Methods
  async getBankrollHistory(playerId: string, limit: number = 50, offset: number = 0) {
    try {
      return await this.profileManager.getBankrollHistory(playerId, limit, offset);
    } catch (error) {
      throw this.handleServiceError(error, 'Failed to retrieve bankroll history');
    }
  }

  async getPlayerCount(): Promise<number> {
    try {
      const result = await this.searchPlayers({}, { page: 1, limit: 1 });
      return result.total;
    } catch (error) {
      throw this.handleServiceError(error, 'Failed to get player count');
    }
  }

  async getActivePlayersCount(): Promise<number> {
    try {
      // This would need additional logic to determine "active" players
      // For now, return total count
      return this.getPlayerCount();
    } catch (error) {
      throw this.handleServiceError(error, 'Failed to get active player count');
    }
  }

  // Error Handling
  private handleServiceError(error: any, defaultMessage: string): PlayerProfileError {
    if (error instanceof PlayerProfileErrorImpl) {
      return error;
    }

    const serviceError = new PlayerProfileErrorImpl(
      error.message || defaultMessage
    ) as PlayerProfileError;
    
    serviceError.code = error.code || 'SERVICE_ERROR';
    serviceError.details = { originalError: error };
    
    return serviceError;
  }
}

// Factory function for creating service instances
export function createPlayerProfileService(profileManager: PlayerProfileManager): PlayerProfileService {
  return new PlayerProfileService(profileManager);
}

// Singleton pattern for global access
let globalPlayerProfileService: PlayerProfileService | null = null;

export function setGlobalPlayerProfileService(service: PlayerProfileService): void {
  globalPlayerProfileService = service;
}

export function getGlobalPlayerProfileService(): PlayerProfileService {
  if (!globalPlayerProfileService) {
    throw new Error('Player profile service not initialized. Call setGlobalPlayerProfileService first.');
  }
  return globalPlayerProfileService;
}

// For testing purposes
export function resetGlobalPlayerProfileService(): void {
  globalPlayerProfileService = null;
}
