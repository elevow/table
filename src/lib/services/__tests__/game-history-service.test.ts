// US-010: Game History Recording - GameHistoryService Integration Tests

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { GameHistoryService } from '../game-history-service';
import { GameHistoryManager } from '../../database/game-history-manager';
import {
  CreateGameHistoryRequest,
  GameHistoryRecord,
  GameAction,
  GameResults,
  GameHistoryQueryOptions,
  GameHistoryFilters,
  PaginatedGameHistoryResponse,
  GameAnalytics
} from '../../../types/game-history';

// Mock the GameHistoryManager
const mockGameHistoryManager = {
  recordGameHistory: jest.fn(),
  getGameHistoryById: jest.fn(),
  queryGameHistory: jest.fn(),
  getPlayerGameHistory: jest.fn(),
  getGameAnalytics: jest.fn(),
  cleanupOldRecords: jest.fn(),
} as any;

describe('GameHistoryService', () => {
  let service: GameHistoryService;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create service instance with mocked manager
    service = new GameHistoryService(mockGameHistoryManager);
  });

  describe('Constructor', () => {
    test('should create service instance with manager', () => {
      expect(service).toBeInstanceOf(GameHistoryService);
    });
  });

  describe('recordGame', () => {
    const validGameActions: GameAction[] = [
      {
        playerId: 'player-1',
        action: 'bet',
        amount: 50,
        timestamp: new Date(),
        position: 1,
        holeCards: ['AH', 'KS']
      },
      {
        playerId: 'player-2',
        action: 'call',
        amount: 50,
        timestamp: new Date(),
        position: 2,
        holeCards: ['QD', 'JC']
      }
    ];

    const validGameResults: GameResults = {
      winners: [
        {
          playerId: 'player-1',
          position: 1,
          holeCards: ['AH', 'KS'],
          bestHand: ['AH', 'KS', 'AC', 'KD', 'QH'],
          handRank: 'Two Pair',
          winAmount: 100,
          showedCards: true
        }
      ],
      pot: [
        {
          type: 'main',
          amount: 100,
          eligiblePlayers: ['player-1', 'player-2'],
          winner: 'player-1'
        }
      ],
      totalPot: 100,
      rake: 5,
      handType: 'Two Pair'
    };

    const validCreateRequest: CreateGameHistoryRequest = {
      tableId: 'table-123',
      handId: 'hand-456',
      actionSequence: validGameActions,
      communityCards: ['AH', 'KD', 'QC', '7S', '2H'],
      results: validGameResults,
      startedAt: new Date('2023-01-01T10:00:00Z'),
      endedAt: new Date('2023-01-01T10:05:00Z')
    };

    const mockGameRecord: GameHistoryRecord = {
      id: 'game-123',
      tableId: 'table-123',
      handId: 'hand-456',
      actionSequence: validGameActions,
      communityCards: ['AH', 'KD', 'QC', '7S', '2H'],
      results: validGameResults,
      startedAt: new Date('2023-01-01T10:00:00Z'),
      endedAt: new Date('2023-01-01T10:05:00Z')
    };

    test('should record game successfully with valid request', async () => {
      mockGameHistoryManager.recordGameHistory.mockResolvedValue(mockGameRecord);

      const result = await service.recordGame(validCreateRequest);

      expect(mockGameHistoryManager.recordGameHistory).toHaveBeenCalledWith(validCreateRequest);
      expect(result).toEqual(mockGameRecord);
    });

    test('should validate minimum game duration', async () => {
      const invalidRequest = {
        ...validCreateRequest,
        startedAt: new Date('2023-01-01T10:00:00Z'),
        endedAt: new Date('2023-01-01T10:00:00.500Z') // Only 500ms duration
      };

      await expect(service.recordGame(invalidRequest)).rejects.toThrow('Game duration too short');
      expect(mockGameHistoryManager.recordGameHistory).not.toHaveBeenCalled();
    });

    test('should validate action sequence is not empty', async () => {
      const invalidRequest = {
        ...validCreateRequest,
        actionSequence: [] // Empty action sequence
      };

      await expect(service.recordGame(invalidRequest)).rejects.toThrow('Game must have at least one action');
      expect(mockGameHistoryManager.recordGameHistory).not.toHaveBeenCalled();
    });

    test('should validate winners exist', async () => {
      const invalidRequest = {
        ...validCreateRequest,
        results: {
          ...validGameResults,
          winners: [] // No winners
        }
      };

      await expect(service.recordGame(invalidRequest)).rejects.toThrow('Game must have at least one winner');
      expect(mockGameHistoryManager.recordGameHistory).not.toHaveBeenCalled();
    });

    test('should validate pot distribution matches total', async () => {
      const invalidRequest = {
        ...validCreateRequest,
        results: {
          ...validGameResults,
          totalPot: 100,
          pot: [
            {
              type: 'main' as const,
              amount: 150, // Mismatch: pot says 150 but total is 100
              eligiblePlayers: ['player-1', 'player-2'],
              winner: 'player-1'
            }
          ]
        }
      };

      await expect(service.recordGame(invalidRequest)).rejects.toThrow('Pot distribution does not match total pot');
      expect(mockGameHistoryManager.recordGameHistory).not.toHaveBeenCalled();
    });

    test('should allow small rounding differences in pot distribution', async () => {
      const validRequestWithRounding = {
        ...validCreateRequest,
        results: {
          ...validGameResults,
          totalPot: 100.00,
          pot: [
            {
              type: 'main' as const,
              amount: 100.005, // Small rounding difference (within 0.01 tolerance)
              eligiblePlayers: ['player-1', 'player-2'],
              winner: 'player-1'
            }
          ]
        }
      };

      mockGameHistoryManager.recordGameHistory.mockResolvedValue(mockGameRecord);

      await service.recordGame(validRequestWithRounding);

      expect(mockGameHistoryManager.recordGameHistory).toHaveBeenCalledWith(validRequestWithRounding);
    });

    test('should pass through manager errors', async () => {
      const managerError = new Error('Database connection failed');
      mockGameHistoryManager.recordGameHistory.mockRejectedValue(managerError);

      await expect(service.recordGame(validCreateRequest)).rejects.toThrow('Database connection failed');
      expect(mockGameHistoryManager.recordGameHistory).toHaveBeenCalledWith(validCreateRequest);
    });
  });

  describe('getGameById', () => {
    test('should retrieve game by ID successfully', async () => {
      const mockGame: GameHistoryRecord = {
        id: 'game-123',
        tableId: 'table-456',
        handId: 'hand-789',
        actionSequence: [],
        communityCards: ['AH', 'KD', 'QC'],
        results: {
          winners: [],
          pot: [],
          totalPot: 100,
          rake: 5
        },
        startedAt: new Date(),
        endedAt: new Date()
      };

      mockGameHistoryManager.getGameHistoryById.mockResolvedValue(mockGame);

      const result = await service.getGameById('game-123');

      expect(mockGameHistoryManager.getGameHistoryById).toHaveBeenCalledWith('game-123');
      expect(result).toEqual(mockGame);
    });

    test('should return null when game not found', async () => {
      mockGameHistoryManager.getGameHistoryById.mockResolvedValue(null);

      const result = await service.getGameById('nonexistent');

      expect(mockGameHistoryManager.getGameHistoryById).toHaveBeenCalledWith('nonexistent');
      expect(result).toBeNull();
    });

    test('should pass through manager errors', async () => {
      const managerError = new Error('Database error');
      mockGameHistoryManager.getGameHistoryById.mockRejectedValue(managerError);

      await expect(service.getGameById('game-123')).rejects.toThrow('Database error');
    });
  });

  describe('searchGames', () => {
    test('should search games with options and filters', async () => {
      const mockResponse: PaginatedGameHistoryResponse = {
        records: [
          {
            id: 'game-1',
            tableId: 'table-1',
            handId: 'hand-1',
            actionSequence: [],
            communityCards: [],
            results: { winners: [], pot: [], totalPot: 100, rake: 5 },
            startedAt: new Date(),
            endedAt: new Date()
          }
        ],
        total: 1,
        hasMore: false
      };

      const options: GameHistoryQueryOptions = {
        tableId: 'table-1',
        limit: 20,
        offset: 0
      };

      const filters: GameHistoryFilters = {
        minPot: 50,
        maxPot: 500
      };

      mockGameHistoryManager.queryGameHistory.mockResolvedValue(mockResponse);

      const result = await service.searchGames(options, filters);

      expect(mockGameHistoryManager.queryGameHistory).toHaveBeenCalledWith(options, filters);
      expect(result).toEqual(mockResponse);
    });

    test('should use default options when none provided', async () => {
      const mockResponse: PaginatedGameHistoryResponse = {
        records: [],
        total: 0,
        hasMore: false
      };

      mockGameHistoryManager.queryGameHistory.mockResolvedValue(mockResponse);

      await service.searchGames();

      expect(mockGameHistoryManager.queryGameHistory).toHaveBeenCalledWith({}, {});
    });

    test('should pass through manager errors', async () => {
      const managerError = new Error('Query failed');
      mockGameHistoryManager.queryGameHistory.mockRejectedValue(managerError);

      await expect(service.searchGames()).rejects.toThrow('Query failed');
    });
  });

  describe('getPlayerHistory', () => {
    test('should retrieve player history successfully', async () => {
      const mockResponse: PaginatedGameHistoryResponse = {
        records: [
          {
            id: 'game-1',
            tableId: 'table-1',
            handId: 'hand-1',
            actionSequence: [],
            communityCards: [],
            results: { winners: [], pot: [], totalPot: 100, rake: 5 },
            startedAt: new Date(),
            endedAt: new Date()
          }
        ],
        total: 1,
        hasMore: false
      };

      const options: GameHistoryQueryOptions = {
        limit: 50,
        offset: 0
      };

      mockGameHistoryManager.getPlayerGameHistory.mockResolvedValue(mockResponse);

      const result = await service.getPlayerHistory('player-123', options);

      expect(mockGameHistoryManager.getPlayerGameHistory).toHaveBeenCalledWith('player-123', options);
      expect(result).toEqual(mockResponse);
    });

    test('should use default options when none provided', async () => {
      const mockResponse: PaginatedGameHistoryResponse = {
        records: [],
        total: 0,
        hasMore: false
      };

      mockGameHistoryManager.getPlayerGameHistory.mockResolvedValue(mockResponse);

      await service.getPlayerHistory('player-123');

      expect(mockGameHistoryManager.getPlayerGameHistory).toHaveBeenCalledWith('player-123', {});
    });

    test('should pass through manager errors', async () => {
      const managerError = new Error('Player query failed');
      mockGameHistoryManager.getPlayerGameHistory.mockRejectedValue(managerError);

      await expect(service.getPlayerHistory('player-123')).rejects.toThrow('Player query failed');
    });
  });

  describe('getAnalytics', () => {
    test('should retrieve analytics for date range', async () => {
      const mockAnalytics: GameAnalytics = {
        totalHands: 100,
        totalPot: 10000,
        averagePot: 100,
        averageHandDuration: 180,
        mostFrequentAction: 'fold',
        playerStats: new Map()
      };

      const dateFrom = new Date('2023-01-01');
      const dateTo = new Date('2023-01-31');

      mockGameHistoryManager.getGameAnalytics.mockResolvedValue(mockAnalytics);

      const result = await service.getAnalytics(dateFrom, dateTo);

      expect(mockGameHistoryManager.getGameAnalytics).toHaveBeenCalledWith(dateFrom, dateTo, undefined);
      expect(result).toEqual(mockAnalytics);
    });

    test('should retrieve analytics for specific table', async () => {
      const mockAnalytics: GameAnalytics = {
        totalHands: 50,
        totalPot: 5000,
        averagePot: 100,
        averageHandDuration: 200,
        mostFrequentAction: 'call',
        playerStats: new Map()
      };

      const dateFrom = new Date('2023-01-01');
      const dateTo = new Date('2023-01-31');
      const tableId = 'table-123';

      mockGameHistoryManager.getGameAnalytics.mockResolvedValue(mockAnalytics);

      const result = await service.getAnalytics(dateFrom, dateTo, tableId);

      expect(mockGameHistoryManager.getGameAnalytics).toHaveBeenCalledWith(dateFrom, dateTo, tableId);
      expect(result).toEqual(mockAnalytics);
    });

    test('should pass through manager errors', async () => {
      const managerError = new Error('Analytics query failed');
      mockGameHistoryManager.getGameAnalytics.mockRejectedValue(managerError);

      const dateFrom = new Date('2023-01-01');
      const dateTo = new Date('2023-01-31');

      await expect(service.getAnalytics(dateFrom, dateTo)).rejects.toThrow('Analytics query failed');
    });
  });

  describe('cleanupOldRecords', () => {
    test('should cleanup old records successfully', async () => {
      mockGameHistoryManager.cleanupOldRecords.mockResolvedValue(25);

      const result = await service.cleanupOldRecords(90);

      expect(mockGameHistoryManager.cleanupOldRecords).toHaveBeenCalledWith(90);
      expect(result).toBe(25);
    });

    test('should reject cleanup of records newer than 30 days', async () => {
      await expect(service.cleanupOldRecords(29)).rejects.toThrow('Cannot cleanup records newer than 30 days');
      expect(mockGameHistoryManager.cleanupOldRecords).not.toHaveBeenCalled();
    });

    test('should allow cleanup of exactly 30 days old records', async () => {
      mockGameHistoryManager.cleanupOldRecords.mockResolvedValue(10);

      const result = await service.cleanupOldRecords(30);

      expect(mockGameHistoryManager.cleanupOldRecords).toHaveBeenCalledWith(30);
      expect(result).toBe(10);
    });

    test('should pass through manager errors', async () => {
      const managerError = new Error('Cleanup failed');
      mockGameHistoryManager.cleanupOldRecords.mockRejectedValue(managerError);

      await expect(service.cleanupOldRecords(90)).rejects.toThrow('Cleanup failed');
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});
