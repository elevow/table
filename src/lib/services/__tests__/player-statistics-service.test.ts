import { PlayerStatisticsService } from '../player-statistics-service';
import { PlayerStatisticsManager } from '../../database/player-statistics-manager';
import { Pool } from 'pg';
import { LeaderboardMetric, PlayerStatisticsDelta } from '../../../types/player-statistics';

// Mock PlayerStatisticsManager
jest.mock('../../database/player-statistics-manager');

describe('PlayerStatisticsService', () => {
  let playerStatisticsService: PlayerStatisticsService;
  let mockPlayerStatisticsManager: jest.Mocked<PlayerStatisticsManager>;
  let mockPool: jest.Mocked<Pool>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPool = {} as jest.Mocked<Pool>;

    mockPlayerStatisticsManager = {
      ensureExists: jest.fn(),
      updateStats: jest.fn(),
      recordAchievement: jest.fn(),
      listAchievements: jest.fn(),
      getLeaderboard: jest.fn(),
    } as any;

    (PlayerStatisticsManager as jest.MockedClass<typeof PlayerStatisticsManager>).mockImplementation(() => mockPlayerStatisticsManager);
    
    playerStatisticsService = new PlayerStatisticsService(mockPool);
  });

  describe('Constructor', () => {
    it('should create an instance with Pool', () => {
      expect(playerStatisticsService).toBeInstanceOf(PlayerStatisticsService);
      expect(PlayerStatisticsManager).toHaveBeenCalledWith(mockPool);
    });
  });

  describe('getOrCreate', () => {
    const mockPlayerStats = {
      id: 'stats123',
      userId: 'user123',
      handsPlayed: 100,
      handsWon: 60,
      totalProfit: 500,
      biggestPot: 200,
      lastUpdated: new Date()
    };

    it('should get or create player statistics successfully', async () => {
      mockPlayerStatisticsManager.ensureExists.mockResolvedValue(mockPlayerStats);

      const result = await playerStatisticsService.getOrCreate('user123');

      expect(mockPlayerStatisticsManager.ensureExists).toHaveBeenCalledWith('user123');
      expect(result).toEqual(mockPlayerStats);
    });

    it('should throw error for missing userId', async () => {
      await expect(playerStatisticsService.getOrCreate(''))
        .rejects.toThrow('userId is required');
      
      expect(mockPlayerStatisticsManager.ensureExists).not.toHaveBeenCalled();
    });

    it('should throw error for undefined userId', async () => {
      await expect(playerStatisticsService.getOrCreate(undefined as any))
        .rejects.toThrow('userId is required');
    });

    it('should throw error for null userId', async () => {
      await expect(playerStatisticsService.getOrCreate(null as any))
        .rejects.toThrow('userId is required');
    });
  });

  describe('update', () => {
    const validDelta: PlayerStatisticsDelta = {
      handsPlayed: 10,
      handsWon: 6,
      totalProfit: 150,
      biggestPot: 50
    };

    const mockUpdatedStats = {
      id: 'stats123',
      userId: 'user123',
      handsPlayed: 110,
      handsWon: 66,
      totalProfit: 650,
      biggestPot: 200,
      lastUpdated: new Date()
    };

    it('should update player statistics successfully', async () => {
      mockPlayerStatisticsManager.updateStats.mockResolvedValue(mockUpdatedStats);

      const result = await playerStatisticsService.update('user123', validDelta);

      expect(mockPlayerStatisticsManager.updateStats).toHaveBeenCalledWith('user123', validDelta);
      expect(result).toEqual(mockUpdatedStats);
    });

    it('should allow partial delta updates', async () => {
      const partialDelta: PlayerStatisticsDelta = {
        handsPlayed: 5,
        totalProfit: 25
      };

      mockPlayerStatisticsManager.updateStats.mockResolvedValue(mockUpdatedStats);

      const result = await playerStatisticsService.update('user123', partialDelta);

      expect(mockPlayerStatisticsManager.updateStats).toHaveBeenCalledWith('user123', partialDelta);
      expect(result).toEqual(mockUpdatedStats);
    });

    it('should allow null values in delta', async () => {
      const deltaWithNulls: PlayerStatisticsDelta = {
        handsPlayed: 5,
        handsWon: undefined,
        totalProfit: 25,
        biggestPot: undefined
      };

      mockPlayerStatisticsManager.updateStats.mockResolvedValue(mockUpdatedStats);

      await expect(playerStatisticsService.update('user123', deltaWithNulls))
        .resolves.toEqual(mockUpdatedStats);
    });

    it('should throw error for missing userId', async () => {
      await expect(playerStatisticsService.update('', validDelta))
        .rejects.toThrow('userId is required');
      
      expect(mockPlayerStatisticsManager.updateStats).not.toHaveBeenCalled();
    });

    it('should throw error for undefined userId', async () => {
      await expect(playerStatisticsService.update(undefined as any, validDelta))
        .rejects.toThrow('userId is required');
    });

    it('should throw error for missing delta', async () => {
      await expect(playerStatisticsService.update('user123', undefined as any))
        .rejects.toThrow('delta is required');
    });

    it('should throw error for null delta', async () => {
      await expect(playerStatisticsService.update('user123', null as any))
        .rejects.toThrow('delta is required');
    });

    it('should throw error for non-object delta', async () => {
      await expect(playerStatisticsService.update('user123', 'invalid' as any))
        .rejects.toThrow('delta is required');
    });

    it('should throw error for non-numeric handsPlayed', async () => {
      const invalidDelta = { ...validDelta, handsPlayed: 'invalid' as any };

      await expect(playerStatisticsService.update('user123', invalidDelta))
        .rejects.toThrow('handsPlayed must be a number');
    });

    it('should throw error for non-numeric handsWon', async () => {
      const invalidDelta = { ...validDelta, handsWon: 'invalid' as any };

      await expect(playerStatisticsService.update('user123', invalidDelta))
        .rejects.toThrow('handsWon must be a number');
    });

    it('should throw error for non-numeric totalProfit', async () => {
      const invalidDelta = { ...validDelta, totalProfit: 'invalid' as any };

      await expect(playerStatisticsService.update('user123', invalidDelta))
        .rejects.toThrow('totalProfit must be a number');
    });

    it('should throw error for non-numeric biggestPot', async () => {
      const invalidDelta = { ...validDelta, biggestPot: 'invalid' as any };

      await expect(playerStatisticsService.update('user123', invalidDelta))
        .rejects.toThrow('biggestPot must be a number');
    });

    it('should allow zero values in delta', async () => {
      const deltaWithZeros: PlayerStatisticsDelta = {
        handsPlayed: 0,
        handsWon: 0,
        totalProfit: 0,
        biggestPot: 0
      };

      mockPlayerStatisticsManager.updateStats.mockResolvedValue(mockUpdatedStats);

      await expect(playerStatisticsService.update('user123', deltaWithZeros))
        .resolves.toEqual(mockUpdatedStats);
    });

    it('should allow negative values in delta', async () => {
      const deltaWithNegatives: PlayerStatisticsDelta = {
        handsPlayed: -1,
        handsWon: -1,
        totalProfit: -100,
        biggestPot: -50
      };

      mockPlayerStatisticsManager.updateStats.mockResolvedValue(mockUpdatedStats);

      await expect(playerStatisticsService.update('user123', deltaWithNegatives))
        .resolves.toEqual(mockUpdatedStats);
    });
  });

  describe('recordAchievement', () => {
    const mockAchievement = {
      id: 'achievement123',
      userId: 'user123',
      achievementType: 'first_win',
      metadata: { gameId: 'game456' },
      achievedAt: new Date()
    };

    it('should record achievement successfully', async () => {
      mockPlayerStatisticsManager.recordAchievement.mockResolvedValue(mockAchievement);

      const result = await playerStatisticsService.recordAchievement('user123', 'first_win', { gameId: 'game456' });

      expect(mockPlayerStatisticsManager.recordAchievement).toHaveBeenCalledWith('user123', 'first_win', { gameId: 'game456' });
      expect(result).toEqual(mockAchievement);
    });

    it('should record achievement without metadata', async () => {
      mockPlayerStatisticsManager.recordAchievement.mockResolvedValue(mockAchievement);

      const result = await playerStatisticsService.recordAchievement('user123', 'first_win');

      expect(mockPlayerStatisticsManager.recordAchievement).toHaveBeenCalledWith('user123', 'first_win', undefined);
      expect(result).toEqual(mockAchievement);
    });

    it('should throw error for missing userId', async () => {
      await expect(playerStatisticsService.recordAchievement('', 'first_win'))
        .rejects.toThrow('userId is required');
      
      expect(mockPlayerStatisticsManager.recordAchievement).not.toHaveBeenCalled();
    });

    it('should throw error for undefined userId', async () => {
      await expect(playerStatisticsService.recordAchievement(undefined as any, 'first_win'))
        .rejects.toThrow('userId is required');
    });

    it('should throw error for missing type', async () => {
      await expect(playerStatisticsService.recordAchievement('user123', ''))
        .rejects.toThrow('type is required');
    });

    it('should throw error for undefined type', async () => {
      await expect(playerStatisticsService.recordAchievement('user123', undefined as any))
        .rejects.toThrow('type is required');
    });

    it('should throw error for null type', async () => {
      await expect(playerStatisticsService.recordAchievement('user123', null as any))
        .rejects.toThrow('type is required');
    });
  });

  describe('listAchievements', () => {
    const mockAchievements = [
      {
        id: 'achievement1',
        userId: 'user123',
        achievementType: 'first_win',
        metadata: {},
        achievedAt: new Date()
      },
      {
        id: 'achievement2',
        userId: 'user123',
        achievementType: 'big_win',
        metadata: { amount: 1000 },
        achievedAt: new Date()
      }
    ];

    it('should list achievements successfully with default parameters', async () => {
      mockPlayerStatisticsManager.listAchievements.mockResolvedValue(mockAchievements);

      const result = await playerStatisticsService.listAchievements('user123');

      expect(mockPlayerStatisticsManager.listAchievements).toHaveBeenCalledWith('user123', 50, 0);
      expect(result).toEqual(mockAchievements);
    });

    it('should list achievements with custom limit and offset', async () => {
      mockPlayerStatisticsManager.listAchievements.mockResolvedValue(mockAchievements);

      const result = await playerStatisticsService.listAchievements('user123', 25, 10);

      expect(mockPlayerStatisticsManager.listAchievements).toHaveBeenCalledWith('user123', 25, 10);
      expect(result).toEqual(mockAchievements);
    });

    it('should enforce minimum limit of 1', async () => {
      mockPlayerStatisticsManager.listAchievements.mockResolvedValue(mockAchievements);

      await playerStatisticsService.listAchievements('user123', 0);

      expect(mockPlayerStatisticsManager.listAchievements).toHaveBeenCalledWith('user123', 1, 0);
    });

    it('should enforce maximum limit of 100', async () => {
      mockPlayerStatisticsManager.listAchievements.mockResolvedValue(mockAchievements);

      await playerStatisticsService.listAchievements('user123', 150);

      expect(mockPlayerStatisticsManager.listAchievements).toHaveBeenCalledWith('user123', 100, 0);
    });

    it('should handle negative limit by using minimum', async () => {
      mockPlayerStatisticsManager.listAchievements.mockResolvedValue(mockAchievements);

      await playerStatisticsService.listAchievements('user123', -5);

      expect(mockPlayerStatisticsManager.listAchievements).toHaveBeenCalledWith('user123', 1, 0);
    });

    it('should enforce minimum offset of 0', async () => {
      mockPlayerStatisticsManager.listAchievements.mockResolvedValue(mockAchievements);

      await playerStatisticsService.listAchievements('user123', 50, -10);

      expect(mockPlayerStatisticsManager.listAchievements).toHaveBeenCalledWith('user123', 50, 0);
    });

    it('should handle non-numeric limit and offset', async () => {
      mockPlayerStatisticsManager.listAchievements.mockResolvedValue(mockAchievements);

      await playerStatisticsService.listAchievements('user123', 'invalid' as any, 'invalid' as any);

      expect(mockPlayerStatisticsManager.listAchievements).toHaveBeenCalledWith('user123', NaN, NaN);
    });

    it('should throw error for missing userId', async () => {
      await expect(playerStatisticsService.listAchievements(''))
        .rejects.toThrow('userId is required');
      
      expect(mockPlayerStatisticsManager.listAchievements).not.toHaveBeenCalled();
    });

    it('should throw error for undefined userId', async () => {
      await expect(playerStatisticsService.listAchievements(undefined as any))
        .rejects.toThrow('userId is required');
    });
  });

  describe('leaderboard', () => {
    const mockLeaderboard = [
      { userId: 'user1', value: 1000, rank: 1 },
      { userId: 'user2', value: 800, rank: 2 },
      { userId: 'user3', value: 600, rank: 3 }
    ];

    it('should get leaderboard successfully with default limit', async () => {
      mockPlayerStatisticsManager.getLeaderboard.mockResolvedValue(mockLeaderboard);

      const result = await playerStatisticsService.leaderboard('total_profit');

      expect(mockPlayerStatisticsManager.getLeaderboard).toHaveBeenCalledWith('total_profit', 10);
      expect(result).toEqual(mockLeaderboard);
    });

    it('should get leaderboard with custom limit', async () => {
      mockPlayerStatisticsManager.getLeaderboard.mockResolvedValue(mockLeaderboard);

      const result = await playerStatisticsService.leaderboard('hands_won', 25);

      expect(mockPlayerStatisticsManager.getLeaderboard).toHaveBeenCalledWith('hands_won', 25);
      expect(result).toEqual(mockLeaderboard);
    });

    it('should get leaderboard for all valid metrics', async () => {
      const validMetrics: LeaderboardMetric[] = ['total_profit', 'hands_won', 'hands_played', 'biggest_pot'];
      
      mockPlayerStatisticsManager.getLeaderboard.mockResolvedValue(mockLeaderboard);

      for (const metric of validMetrics) {
        await playerStatisticsService.leaderboard(metric);
        expect(mockPlayerStatisticsManager.getLeaderboard).toHaveBeenCalledWith(metric, 10);
      }
    });

    it('should enforce minimum limit of 1', async () => {
      mockPlayerStatisticsManager.getLeaderboard.mockResolvedValue(mockLeaderboard);

      await playerStatisticsService.leaderboard('total_profit', 0);

      expect(mockPlayerStatisticsManager.getLeaderboard).toHaveBeenCalledWith('total_profit', 1);
    });

    it('should enforce maximum limit of 100', async () => {
      mockPlayerStatisticsManager.getLeaderboard.mockResolvedValue(mockLeaderboard);

      await playerStatisticsService.leaderboard('total_profit', 150);

      expect(mockPlayerStatisticsManager.getLeaderboard).toHaveBeenCalledWith('total_profit', 100);
    });

    it('should handle negative limit by using minimum', async () => {
      mockPlayerStatisticsManager.getLeaderboard.mockResolvedValue(mockLeaderboard);

      await playerStatisticsService.leaderboard('total_profit', -5);

      expect(mockPlayerStatisticsManager.getLeaderboard).toHaveBeenCalledWith('total_profit', 1);
    });

    it('should handle non-numeric limit', async () => {
      mockPlayerStatisticsManager.getLeaderboard.mockResolvedValue(mockLeaderboard);

      await playerStatisticsService.leaderboard('total_profit', 'invalid' as any);

      expect(mockPlayerStatisticsManager.getLeaderboard).toHaveBeenCalledWith('total_profit', NaN);
    });

    it('should throw error for invalid metric', async () => {
      await expect(playerStatisticsService.leaderboard('invalid_metric' as any))
        .rejects.toThrow('invalid metric');
      
      expect(mockPlayerStatisticsManager.getLeaderboard).not.toHaveBeenCalled();
    });

    it('should throw error for undefined metric', async () => {
      await expect(playerStatisticsService.leaderboard(undefined as any))
        .rejects.toThrow('invalid metric');
    });

    it('should throw error for null metric', async () => {
      await expect(playerStatisticsService.leaderboard(null as any))
        .rejects.toThrow('invalid metric');
    });
  });

  describe('Parameter validation edge cases', () => {
    it('should allow whitespace-only userId in getOrCreate', async () => {
      mockPlayerStatisticsManager.ensureExists.mockResolvedValue({
        id: 'stats124',
        userId: '   ',
        handsPlayed: 0,
        handsWon: 0,
        totalProfit: 0,
        biggestPot: 0,
        lastUpdated: new Date()
      });

      await playerStatisticsService.getOrCreate('   ');

      expect(mockPlayerStatisticsManager.ensureExists).toHaveBeenCalledWith('   ');
    });

    it('should allow whitespace-only type in recordAchievement', async () => {
      mockPlayerStatisticsManager.recordAchievement.mockResolvedValue({
        id: 'achievement124',
        userId: 'user123',
        achievementType: '   ',
        achievedAt: new Date()
      });

      await playerStatisticsService.recordAchievement('user123', '   ');

      expect(mockPlayerStatisticsManager.recordAchievement).toHaveBeenCalledWith('user123', '   ', undefined);
    });

    it('should handle empty object as delta', async () => {
      const emptyDelta: PlayerStatisticsDelta = {};
      mockPlayerStatisticsManager.updateStats.mockResolvedValue({
        id: 'stats125',
        userId: 'user123',
        handsPlayed: 100,
        handsWon: 60,
        totalProfit: 500,
        biggestPot: 200,
        lastUpdated: new Date()
      });

      await expect(playerStatisticsService.update('user123', emptyDelta))
        .resolves.toBeDefined();
    });

    it('should handle Infinity and -Infinity in limit parameters', async () => {
      mockPlayerStatisticsManager.listAchievements.mockResolvedValue([]);

      await playerStatisticsService.listAchievements('user123', Infinity, -Infinity);

      expect(mockPlayerStatisticsManager.listAchievements).toHaveBeenCalledWith('user123', 100, 0);
    });

    it('should handle NaN in numeric parameters', async () => {
      mockPlayerStatisticsManager.getLeaderboard.mockResolvedValue([]);

      await playerStatisticsService.leaderboard('total_profit', NaN);

      expect(mockPlayerStatisticsManager.getLeaderboard).toHaveBeenCalledWith('total_profit', NaN);
    });
  });
});