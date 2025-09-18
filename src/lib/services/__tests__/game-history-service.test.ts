import { GameHistoryService } from '../game-history-service';
import { GameHistoryManager } from '../../database/game-history-manager';
import {
  GameHistoryRecord,
  CreateGameHistoryRequest,
  GameHistoryQueryOptions,
  GameHistoryFilters,
  PaginatedGameHistoryResponse,
  GameAnalytics,
  GameAction
} from '../../../types/game-history';

// Mock GameHistoryManager
jest.mock('../../database/game-history-manager');

describe('GameHistoryService', () => {
  let gameHistoryService: GameHistoryService;
  let mockGameHistoryManager: jest.Mocked<GameHistoryManager>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGameHistoryManager = {
      recordGameHistory: jest.fn(),
      getGameHistoryById: jest.fn(),
      queryGameHistory: jest.fn(),
      getPlayerGameHistory: jest.fn(),
      getGameAnalytics: jest.fn(),
      cleanupOldRecords: jest.fn(),
    } as any;

    gameHistoryService = new GameHistoryService(mockGameHistoryManager);
  });

  describe('Constructor', () => {
    it('should create an instance with GameHistoryManager', () => {
      expect(gameHistoryService).toBeInstanceOf(GameHistoryService);
    });
  });

  describe('recordGame', () => {
    const createValidGameRequest = (): CreateGameHistoryRequest => ({
      tableId: 'table123',
      handId: 'hand123',
      communityCards: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
      startedAt: new Date('2023-01-01T10:00:00Z'),
      endedAt: new Date('2023-01-01T10:05:00Z'),
      actionSequence: [
        { 
          playerId: 'dealer', 
          action: 'bet', 
          amount: 0, 
          timestamp: new Date(),
          position: 0
        } as GameAction
      ],
      results: {
        winners: [{
          playerId: 'player1',
          position: 0,
          holeCards: ['As', 'Ks'],
          bestHand: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
          handRank: 'royal flush',
          winAmount: 100,
          showedCards: true
        }],
        totalPot: 100,
        pot: [{ type: 'main', amount: 100, eligiblePlayers: ['player1'], winner: 'player1' }],
        rake: 0
      }
    });

    const mockGameRecord: GameHistoryRecord = {
      id: 'game123',
      tableId: 'table123',
      handId: 'hand123',
      actionSequence: [],
      communityCards: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
      results: {
        winners: [{
          playerId: 'player1',
          position: 0,
          holeCards: ['As', 'Ks'],
          bestHand: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
          handRank: 'royal flush',
          winAmount: 100,
          showedCards: true
        }],
        totalPot: 100,
        pot: [{ type: 'main', amount: 100, eligiblePlayers: ['player1'], winner: 'player1' }],
        rake: 0
      },
      startedAt: new Date('2023-01-01T10:00:00Z'),
      endedAt: new Date('2023-01-01T10:05:00Z')
    };

    it('should record game successfully', async () => {
      const request = createValidGameRequest();
      mockGameHistoryManager.recordGameHistory.mockResolvedValue(mockGameRecord);

      const result = await gameHistoryService.recordGame(request);

      expect(mockGameHistoryManager.recordGameHistory).toHaveBeenCalledWith(request);
      expect(result).toEqual(mockGameRecord);
    });

    it('should throw error for game duration too short', async () => {
      const request = createValidGameRequest();
      request.endedAt = new Date(request.startedAt.getTime() + 500); // 500ms duration

      await expect(gameHistoryService.recordGame(request))
        .rejects.toThrow('Game duration too short');
      
      expect(mockGameHistoryManager.recordGameHistory).not.toHaveBeenCalled();
    });

    it('should throw error for empty action sequence', async () => {
      const request = createValidGameRequest();
      request.actionSequence = [];

      await expect(gameHistoryService.recordGame(request))
        .rejects.toThrow('Game must have at least one action');
      
      expect(mockGameHistoryManager.recordGameHistory).not.toHaveBeenCalled();
    });

    it('should throw error for no winners', async () => {
      const request = createValidGameRequest();
      request.results.winners = [];

      await expect(gameHistoryService.recordGame(request))
        .rejects.toThrow('Game must have at least one winner');
      
      expect(mockGameHistoryManager.recordGameHistory).not.toHaveBeenCalled();
    });

    it('should throw error for pot distribution mismatch', async () => {
      const request = createValidGameRequest();
      request.results.totalPot = 100;
      request.results.pot = [{ type: 'main', amount: 90, eligiblePlayers: ['player1'], winner: 'player1' }]; // Mismatch

      await expect(gameHistoryService.recordGame(request))
        .rejects.toThrow('Pot distribution does not match total pot');
      
      expect(mockGameHistoryManager.recordGameHistory).not.toHaveBeenCalled();
    });

    it('should allow small rounding differences in pot distribution', async () => {
      const request = createValidGameRequest();
      request.results.totalPot = 100;
      request.results.pot = [{ type: 'main', amount: 100.005, eligiblePlayers: ['player1'], winner: 'player1' }]; // Small difference

      mockGameHistoryManager.recordGameHistory.mockResolvedValue(mockGameRecord);

      await expect(gameHistoryService.recordGame(request))
        .resolves.toEqual(mockGameRecord);
    });

    it('should validate minimum game duration of 1 second', async () => {
      const request = createValidGameRequest();
      request.endedAt = new Date(request.startedAt.getTime() + 1000); // Exactly 1 second

      mockGameHistoryManager.recordGameHistory.mockResolvedValue(mockGameRecord);

      await expect(gameHistoryService.recordGame(request))
        .resolves.toEqual(mockGameRecord);
    });
  });

  describe('getGameById', () => {
    it('should get game by id', async () => {
      const gameId = 'game123';
      const mockGame: GameHistoryRecord = {
        id: gameId,
        tableId: 'table123',
        handId: 'hand123',
        actionSequence: [],
        communityCards: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
        results: {
          winners: [{
            playerId: 'player1',
            position: 0,
            holeCards: ['As', 'Ks'],
            bestHand: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
            handRank: 'royal flush',
            winAmount: 100,
            showedCards: true
          }],
          totalPot: 100,
          pot: [{ type: 'main', amount: 100, eligiblePlayers: ['player1'], winner: 'player1' }],
          rake: 0
        },
        startedAt: new Date(),
        endedAt: new Date()
      };

      mockGameHistoryManager.getGameHistoryById.mockResolvedValue(mockGame);

      const result = await gameHistoryService.getGameById(gameId);

      expect(mockGameHistoryManager.getGameHistoryById).toHaveBeenCalledWith(gameId);
      expect(result).toEqual(mockGame);
    });

    it('should return null when game not found', async () => {
      mockGameHistoryManager.getGameHistoryById.mockResolvedValue(null);

      const result = await gameHistoryService.getGameById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('searchGames', () => {
    const mockResponse: PaginatedGameHistoryResponse = {
      records: [],
      total: 0,
      hasMore: false
    };

    it('should search games with default options', async () => {
      mockGameHistoryManager.queryGameHistory.mockResolvedValue(mockResponse);

      const result = await gameHistoryService.searchGames();

      expect(mockGameHistoryManager.queryGameHistory).toHaveBeenCalledWith({}, {});
      expect(result).toEqual(mockResponse);
    });

    it('should search games with custom options and filters', async () => {
      const options: GameHistoryQueryOptions = {
        limit: 10,
        offset: 20,
        tableId: 'table123',
        playerId: 'player1'
      };
      const filters: GameHistoryFilters = {
        minPot: 50,
        maxPot: 500,
        playerCount: 2
      };

      mockGameHistoryManager.queryGameHistory.mockResolvedValue(mockResponse);

      const result = await gameHistoryService.searchGames(options, filters);

      expect(mockGameHistoryManager.queryGameHistory).toHaveBeenCalledWith(options, filters);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getPlayerHistory', () => {
    const mockResponse: PaginatedGameHistoryResponse = {
      records: [],
      total: 0,
      hasMore: false
    };

    it('should get player history with default options', async () => {
      const playerId = 'player123';
      mockGameHistoryManager.getPlayerGameHistory.mockResolvedValue(mockResponse);

      const result = await gameHistoryService.getPlayerHistory(playerId);

      expect(mockGameHistoryManager.getPlayerGameHistory).toHaveBeenCalledWith(playerId, {});
      expect(result).toEqual(mockResponse);
    });

    it('should get player history with custom options', async () => {
      const playerId = 'player123';
      const options: GameHistoryQueryOptions = {
        limit: 15,
        offset: 30,
        includeActions: true
      };

      mockGameHistoryManager.getPlayerGameHistory.mockResolvedValue(mockResponse);

      const result = await gameHistoryService.getPlayerHistory(playerId, options);

      expect(mockGameHistoryManager.getPlayerGameHistory).toHaveBeenCalledWith(playerId, options);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getAnalytics', () => {
    const mockAnalytics: GameAnalytics = {
      totalHands: 100,
      totalPot: 10000,
      averagePot: 100,
      averageHandDuration: 300,
      mostFrequentAction: 'bet',
      playerStats: new Map()
    };

    it('should get analytics for date range', async () => {
      const dateFrom = new Date('2023-01-01');
      const dateTo = new Date('2023-01-31');

      mockGameHistoryManager.getGameAnalytics.mockResolvedValue(mockAnalytics);

      const result = await gameHistoryService.getAnalytics(dateFrom, dateTo);

      expect(mockGameHistoryManager.getGameAnalytics).toHaveBeenCalledWith(dateFrom, dateTo, undefined);
      expect(result).toEqual(mockAnalytics);
    });

    it('should get analytics for specific table', async () => {
      const dateFrom = new Date('2023-01-01');
      const dateTo = new Date('2023-01-31');
      const tableId = 'table123';

      mockGameHistoryManager.getGameAnalytics.mockResolvedValue(mockAnalytics);

      const result = await gameHistoryService.getAnalytics(dateFrom, dateTo, tableId);

      expect(mockGameHistoryManager.getGameAnalytics).toHaveBeenCalledWith(dateFrom, dateTo, tableId);
      expect(result).toEqual(mockAnalytics);
    });
  });

  describe('cleanupOldRecords', () => {
    it('should cleanup records older than specified days', async () => {
      const olderThanDays = 90;
      const deletedCount = 50;

      mockGameHistoryManager.cleanupOldRecords.mockResolvedValue(deletedCount);

      const result = await gameHistoryService.cleanupOldRecords(olderThanDays);

      expect(mockGameHistoryManager.cleanupOldRecords).toHaveBeenCalledWith(olderThanDays);
      expect(result).toBe(deletedCount);
    });

    it('should throw error for cleanup period less than 30 days', async () => {
      const olderThanDays = 15;

      await expect(gameHistoryService.cleanupOldRecords(olderThanDays))
        .rejects.toThrow('Cannot cleanup records newer than 30 days');
      
      expect(mockGameHistoryManager.cleanupOldRecords).not.toHaveBeenCalled();
    });

    it('should allow cleanup at exactly 30 days', async () => {
      const olderThanDays = 30;
      const deletedCount = 25;

      mockGameHistoryManager.cleanupOldRecords.mockResolvedValue(deletedCount);

      const result = await gameHistoryService.cleanupOldRecords(olderThanDays);

      expect(result).toBe(deletedCount);
    });
  });

  describe('Business rules validation edge cases', () => {
    it('should validate complex pot distribution scenarios', async () => {
      const request: CreateGameHistoryRequest = {
        tableId: 'table123',
        handId: 'hand123',
        communityCards: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
        startedAt: new Date('2023-01-01T10:00:00Z'),
        endedAt: new Date('2023-01-01T10:05:00Z'),
        actionSequence: [
          { 
            playerId: 'dealer', 
            action: 'bet', 
            amount: 0, 
            timestamp: new Date(),
            position: 0
          } as GameAction
        ],
        results: {
          winners: [{
            playerId: 'player1',
            position: 0,
            holeCards: ['As', 'Ks'],
            bestHand: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
            handRank: 'royal flush',
            winAmount: 100,
            showedCards: true
          }, {
            playerId: 'player2',
            position: 1,
            holeCards: ['Ac', 'Kc'],
            bestHand: ['Ac', 'Kc', 'Qc', 'Jc', 'Tc'],
            handRank: 'royal flush',
            winAmount: 50,
            showedCards: true
          }],
          totalPot: 150,
          pot: [
            { type: 'main', amount: 100, eligiblePlayers: ['player1'], winner: 'player1' },
            { type: 'side', amount: 50, eligiblePlayers: ['player2'], winner: 'player2' }
          ],
          rake: 0
        }
      };

      const mockRecord: GameHistoryRecord = {
        id: 'game123',
        tableId: 'table123',
        handId: 'hand123',
        actionSequence: request.actionSequence,
        communityCards: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
        results: request.results,
        startedAt: request.startedAt,
        endedAt: request.endedAt
      };

      mockGameHistoryManager.recordGameHistory.mockResolvedValue(mockRecord);

      await expect(gameHistoryService.recordGame(request))
        .resolves.toEqual(mockRecord);
    });

    it('should handle zero pot games', async () => {
      const request: CreateGameHistoryRequest = {
        tableId: 'table123',
        handId: 'hand123',
        communityCards: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
        startedAt: new Date('2023-01-01T10:00:00Z'),
        endedAt: new Date('2023-01-01T10:05:00Z'),
        actionSequence: [
          { 
            playerId: 'dealer', 
            action: 'bet', 
            amount: 0, 
            timestamp: new Date(),
            position: 0
          } as GameAction
        ],
        results: {
          winners: [{
            playerId: 'player1',
            position: 0,
            holeCards: ['As', 'Ks'],
            bestHand: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
            handRank: 'royal flush',
            winAmount: 0,
            showedCards: true
          }],
          totalPot: 0,
          pot: [{ type: 'main', amount: 0, eligiblePlayers: ['player1'], winner: 'player1' }],
          rake: 0
        }
      };

      const mockRecord: GameHistoryRecord = {
        id: 'game123',
        tableId: 'table123',
        handId: 'hand123',
        actionSequence: request.actionSequence,
        communityCards: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
        results: request.results,
        startedAt: request.startedAt,
        endedAt: request.endedAt
      };

      mockGameHistoryManager.recordGameHistory.mockResolvedValue(mockRecord);

      await expect(gameHistoryService.recordGame(request))
        .resolves.toEqual(mockRecord);
    });
  });
});