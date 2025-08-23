// US-010: Game History Recording - Service Layer Implementation

import { GameHistoryManager } from '../database/game-history-manager';
import {
  GameHistoryRecord,
  CreateGameHistoryRequest,
  GameHistoryQueryOptions,
  GameHistoryFilters,
  PaginatedGameHistoryResponse,
  GameAnalytics
} from '../../types/game-history';

export class GameHistoryService {
  constructor(private gameHistoryManager: GameHistoryManager) {}

  /**
   * Record a completed game's history
   */
  async recordGame(request: CreateGameHistoryRequest): Promise<GameHistoryRecord> {
    // Add any business logic validation here
    this.validateBusinessRules(request);
    
    return await this.gameHistoryManager.recordGameHistory(request);
  }

  /**
   * Get game history by ID
   */
  async getGameById(id: string): Promise<GameHistoryRecord | null> {
    return await this.gameHistoryManager.getGameHistoryById(id);
  }

  /**
   * Search game history with filters
   */
  async searchGames(
    options: GameHistoryQueryOptions = {},
    filters: GameHistoryFilters = {}
  ): Promise<PaginatedGameHistoryResponse> {
    return await this.gameHistoryManager.queryGameHistory(options, filters);
  }

  /**
   * Get player's game history
   */
  async getPlayerHistory(
    playerId: string,
    options: GameHistoryQueryOptions = {}
  ): Promise<PaginatedGameHistoryResponse> {
    return await this.gameHistoryManager.getPlayerGameHistory(playerId, options);
  }

  /**
   * Get analytics for a date range
   */
  async getAnalytics(
    dateFrom: Date,
    dateTo: Date,
    tableId?: string
  ): Promise<GameAnalytics> {
    return await this.gameHistoryManager.getGameAnalytics(dateFrom, dateTo, tableId);
  }

  /**
   * Cleanup old records (admin function)
   */
  async cleanupOldRecords(olderThanDays: number): Promise<number> {
    if (olderThanDays < 30) {
      throw new Error('Cannot cleanup records newer than 30 days');
    }
    
    return await this.gameHistoryManager.cleanupOldRecords(olderThanDays);
  }

  /**
   * Business rules validation
   */
  private validateBusinessRules(request: CreateGameHistoryRequest): void {
    // Ensure minimum game duration
    const durationMs = request.endedAt.getTime() - request.startedAt.getTime();
    if (durationMs < 1000) { // Less than 1 second
      throw new Error('Game duration too short');
    }

    // Ensure at least one action
    if (request.actionSequence.length === 0) {
      throw new Error('Game must have at least one action');
    }

    // Ensure winners exist
    if (request.results.winners.length === 0) {
      throw new Error('Game must have at least one winner');
    }

    // Validate pot distribution matches total
    const distributedAmount = request.results.pot.reduce((sum, pot) => sum + pot.amount, 0);
    if (Math.abs(distributedAmount - request.results.totalPot) > 0.01) {
      throw new Error('Pot distribution does not match total pot');
    }
  }
}
