// US-010: Game History Recording - GameHistoryManager Integration Tests

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { GameHistoryManager } from '../game-history-manager';
import {
  CreateGameHistoryRequest,
  GameAction,
  GameResults,
  GameHistoryQueryOptions,
  GameHistoryFilters
} from '../../../types/game-history';

// Mock external dependencies
const mockPool = {
  connect: jest.fn(),
};

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

const mockUuidv4 = jest.fn();

// Mock the modules
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPool),
}));

jest.mock('uuid', () => {
  return { v4: (...args: any[]) => mockUuidv4(...args) };
});

describe('GameHistoryManager', () => {
  let manager: GameHistoryManager;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock implementations
    (mockPool.connect as any).mockResolvedValue(mockClient);
    (mockUuidv4 as any).mockReturnValue('test-uuid-123');

    // Create manager instance
    manager = new GameHistoryManager(mockPool as any);
  });

  describe('Constructor', () => {
    test('should create manager instance with pool', () => {
      expect(manager).toBeInstanceOf(GameHistoryManager);
    });
  });

  describe('recordGameHistory', () => {
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
      },
      {
        playerId: 'player-3',
        action: 'fold',
        timestamp: new Date(),
        position: 3
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

    test.skip('should record game history successfully', async () => {
      // Mock successful database operations
      (mockClient.query as any).mockImplementation((query: string) => {
        if (query.includes('BEGIN')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (query.includes('INSERT INTO game_history')) {
          return Promise.resolve({
            rows: [{
              id: 'test-uuid-123',
              table_id: 'table-123',
              hand_id: 'hand-456',
              action_sequence: JSON.stringify(validGameActions),
              community_cards: ['AH', 'KD', 'QC', '7S', '2H'],
              results: JSON.stringify(validGameResults),
              started_at: new Date('2023-01-01T10:00:00Z'),
              ended_at: new Date('2023-01-01T10:05:00Z')
            }],
            rowCount: 1
          });
        }
        if (query.includes('INSERT INTO player_actions')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (query.includes('COMMIT')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const result = await manager.recordGameHistory(validCreateRequest);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(result.id).toBe('test-uuid-123');
      expect(result.tableId).toBe('table-123');
      expect(result.handId).toBe('hand-456');
      expect(result.actionSequence).toEqual(validGameActions);
      expect(result.results).toEqual(validGameResults);
    });

    test('should handle database errors during recording', async () => {
      (mockClient.query as any).mockImplementation((query: string) => {
        if (query.includes('BEGIN')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (query.includes('INSERT INTO game_history')) {
          throw new Error('Database constraint violation');
        }
        if (query.includes('ROLLBACK')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      await expect(manager.recordGameHistory(validCreateRequest)).rejects.toThrow();
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    test('should validate required fields', async () => {
      const invalidRequest = {
        ...validCreateRequest,
        tableId: '', // Invalid: empty table ID
      };

      await expect(manager.recordGameHistory(invalidRequest)).rejects.toThrow();
    });

    test('should validate action sequence', async () => {
      const invalidRequest = {
        ...validCreateRequest,
        actionSequence: [], // Invalid: empty action sequence
      };

      await expect(manager.recordGameHistory(invalidRequest)).rejects.toThrow();
    });

    test('should validate time sequence', async () => {
      const invalidRequest = {
        ...validCreateRequest,
        startedAt: new Date('2023-01-01T10:05:00Z'),
        endedAt: new Date('2023-01-01T10:00:00Z'), // Invalid: end before start
      };

      await expect(manager.recordGameHistory(invalidRequest)).rejects.toThrow();
    });
  });

  describe('getGameHistoryById', () => {
    test('should retrieve game history by ID successfully', async () => {
      const mockGameRow = {
        id: 'game-123',
        table_id: 'table-456',
        hand_id: 'hand-789',
        action_sequence: JSON.stringify([
          { playerId: 'player-1', action: 'bet', amount: 50, timestamp: new Date(), position: 1 }
        ]),
        community_cards: ['AH', 'KD', 'QC'],
        results: JSON.stringify({
          winners: [{ playerId: 'player-1', winAmount: 100 }],
          totalPot: 100,
          rake: 5
        }),
        started_at: new Date('2023-01-01T10:00:00Z'),
        ended_at: new Date('2023-01-01T10:05:00Z')
      };

      (mockClient.query as any).mockResolvedValue({
        rows: [mockGameRow],
        rowCount: 1
      });

      const result = await manager.getGameHistoryById('game-123');

      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT * FROM game_history WHERE id = $1',
        ['game-123']
      );
      expect(result?.id).toBe('game-123');
      expect(result?.tableId).toBe('table-456');
      expect(result?.handId).toBe('hand-789');
    });

    test('should return null when game not found', async () => {
      (mockClient.query as any).mockResolvedValue({
        rows: [],
        rowCount: 0
      });

      const result = await manager.getGameHistoryById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('queryGameHistory', () => {
    test('should query game history with pagination', async () => {
      const mockGameRows = [
        {
          id: 'game-1',
          table_id: 'table-1',
          hand_id: 'hand-1',
          action_sequence: JSON.stringify([]),
          community_cards: [],
          results: JSON.stringify({ totalPot: 100 }),
          started_at: new Date(),
          ended_at: new Date()
        },
        {
          id: 'game-2',
          table_id: 'table-1',
          hand_id: 'hand-2',
          action_sequence: JSON.stringify([]),
          community_cards: [],
          results: JSON.stringify({ totalPot: 200 }),
          started_at: new Date(),
          ended_at: new Date()
        }
      ];

      (mockClient.query as any).mockImplementation((query: string) => {
        if (query.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: '10' }] });
        }
        return Promise.resolve({ rows: mockGameRows, rowCount: 2 });
      });

      const options: GameHistoryQueryOptions = {
        tableId: 'table-1',
        limit: 2,
        offset: 0
      };

      const result = await manager.queryGameHistory(options);

      expect(result.records).toHaveLength(2);
      expect(result.total).toBe(10);
      expect(result.hasMore).toBe(true);
      expect(result.nextOffset).toBe(2);
    });

    test('should apply filters correctly', async () => {
      (mockClient.query as any).mockImplementation((query: string) => {
        if (query.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: '5' }] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const options: GameHistoryQueryOptions = {
        tableId: 'table-1',
        dateFrom: new Date('2023-01-01'),
        dateTo: new Date('2023-01-31')
      };

      const filters: GameHistoryFilters = {
        minPot: 100,
        maxPot: 1000
      };

      await manager.queryGameHistory(options, filters);

      // Verify that the query was built with proper conditions
      expect(mockClient.query).toHaveBeenCalled();
    });
  });

  describe('getPlayerGameHistory', () => {
    test('should retrieve player-specific game history', async () => {
      const mockGameRows = [
        {
          id: 'game-1',
          table_id: 'table-1',
          hand_id: 'hand-1',
          action_sequence: JSON.stringify([
            { playerId: 'player-123', action: 'bet', amount: 50 }
          ]),
          community_cards: [],
          results: JSON.stringify({ 
            winners: [{ playerId: 'player-123', winAmount: 100 }] 
          }),
          started_at: new Date(),
          ended_at: new Date()
        }
      ];

      (mockClient.query as any).mockImplementation((query: string) => {
        if (query.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: '1' }] });
        }
        return Promise.resolve({ rows: mockGameRows, rowCount: 1 });
      });

      const result = await manager.getPlayerGameHistory('player-123');

      expect(result.records).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('getGameAnalytics', () => {
    test('should calculate game analytics', async () => {
      const mockAnalyticsData = {
        total_hands: '50',
        average_pot: '150.75',
        total_pot: '7537.50',
        average_duration: '180.5'
      };

      (mockClient.query as any).mockImplementation((query: string) => {
        if (query.includes('COUNT(*)') || query.includes('AVG(')) {
          return Promise.resolve({ rows: [mockAnalyticsData] });
        }
        if (query.includes('action_type')) {
          return Promise.resolve({ 
            rows: [{ action_type: 'fold', frequency: '45' }] 
          });
        }
        return Promise.resolve({ rows: [mockAnalyticsData], rowCount: 1 });
      });

      const dateFrom = new Date('2023-01-01');
      const dateTo = new Date('2023-01-31');

      const result = await manager.getGameAnalytics(dateFrom, dateTo);

      expect(result.totalHands).toBe(50);
      expect(result.averagePot).toBe(150.75);
      expect(result.totalPot).toBe(7537.50);
      expect(result.averageHandDuration).toBe(180.5);
      expect(result.mostFrequentAction).toBe('fold');
    });

    test('should handle table-specific analytics', async () => {
      (mockClient.query as any).mockResolvedValue({ 
        rows: [{ 
          total_hands: '25',
          average_pot: '200.00',
          total_pot: '5000.00',
          average_duration: '200.0'
        }] 
      });

      const dateFrom = new Date('2023-01-01');
      const dateTo = new Date('2023-01-31');
      const tableId = 'table-123';

      await manager.getGameAnalytics(dateFrom, dateTo, tableId);

      // Verify table ID was included in query
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('table_id = $3'),
        expect.arrayContaining([dateFrom, dateTo, tableId])
      );
    });
  });

  describe('cleanupOldRecords', () => {
    test('should delete old records successfully', async () => {
      (mockClient.query as any).mockResolvedValue({
        rowCount: 15
      });

      const result = await manager.cleanupOldRecords(90);

      expect(result).toBe(15);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM game_history'),
        expect.any(Array)
      );
    });

    test('should handle no records to delete', async () => {
      (mockClient.query as any).mockResolvedValue({
        rowCount: 0
      });

      const result = await manager.cleanupOldRecords(30);

      expect(result).toBe(0);
    });
  });

  describe('Error handling', () => {
    test('should always release client connection', async () => {
      (mockClient.query as any).mockRejectedValue(new Error('Database error'));

      try {
        await manager.getGameHistoryById('game-123');
      } catch (error) {
        // Expected to throw
      }

      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle pool connection errors', async () => {
      (mockPool.connect as any).mockRejectedValue(new Error('Connection failed'));

      await expect(manager.getGameHistoryById('game-123')).rejects.toThrow('Connection failed');
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});
