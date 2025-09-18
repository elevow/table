import { PlayerProfileService, createPlayerProfileService, setGlobalPlayerProfileService, getGlobalPlayerProfileService, resetGlobalPlayerProfileService } from '../player-profile-service';
import { PlayerProfileManager } from '../../database/player-profile-manager';
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
} from '../../../types/player-profile';

// Mock PlayerProfileManager
jest.mock('../../database/player-profile-manager');

describe('PlayerProfileService', () => {
  let playerProfileService: PlayerProfileService;
  let mockPlayerProfileManager: jest.Mocked<PlayerProfileManager>;

  const mockPlayer: Player = {
    id: 'player123',
    username: 'testuser',
    email: 'test@example.com',
    bankroll: 1000,
    stats: {
      totalHands: 100,
      totalProfit: 300,
      biggestWin: 500,
      biggestLoss: 200,
      totalSessionTime: 120,
      vpip: 25.5,
      pfr: 18.2,
      aggressionFactor: 2.1,
      achievements: [],
      level: 1,
      experience: 100,
      averageSessionLength: 60,
      gamesPerWeek: 3,
      preferredStakes: ['1/2']
    },
    isActive: true,
    emailVerified: true,
    verificationToken: 'token123',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetGlobalPlayerProfileService();

    mockPlayerProfileManager = {
      createPlayer: jest.fn(),
      getPlayerById: jest.fn(),
      getPlayerByUsername: jest.fn(),
      getPlayerByEmail: jest.fn(),
      updatePlayer: jest.fn(),
      deletePlayer: jest.fn(),
      updateBankroll: jest.fn(),
      searchPlayers: jest.fn(),
      getPlayerSummary: jest.fn(),
      updateGameStats: jest.fn(),
      getBankrollHistory: jest.fn(),
    } as any;

    playerProfileService = new PlayerProfileService(mockPlayerProfileManager);
  });

  describe('Constructor', () => {
    it('should create an instance with PlayerProfileManager', () => {
      expect(playerProfileService).toBeInstanceOf(PlayerProfileService);
    });
  });

  describe('createPlayer', () => {
    const validCreateRequest: CreatePlayerRequest = {
      username: 'newuser',
      email: 'new@example.com',
      password: 'password123',
      initialDeposit: 500
    };

    it('should create player successfully', async () => {
      mockPlayerProfileManager.createPlayer.mockResolvedValue(mockPlayer);

      const result = await playerProfileService.createPlayer(validCreateRequest);

      expect(mockPlayerProfileManager.createPlayer).toHaveBeenCalledWith(validCreateRequest);
      expect(result).toEqual(mockPlayer);
    });

    it('should handle creation errors', async () => {
      const error = new Error('Database error');
      mockPlayerProfileManager.createPlayer.mockRejectedValue(error);

      await expect(playerProfileService.createPlayer(validCreateRequest))
        .rejects.toThrow('Database error');
    });
  });

  describe('getPlayer', () => {
    it('should get player successfully', async () => {
      mockPlayerProfileManager.getPlayerById.mockResolvedValue(mockPlayer);

      const result = await playerProfileService.getPlayer('player123');

      expect(mockPlayerProfileManager.getPlayerById).toHaveBeenCalledWith('player123', {
        includeStats: true,
        includeRecentActivity: true
      });
      expect(result).toEqual(mockPlayer);
    });

    it('should return null when player not found', async () => {
      mockPlayerProfileManager.getPlayerById.mockResolvedValue(null);

      const result = await playerProfileService.getPlayer('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle retrieval errors', async () => {
      const error = new Error('Database error');
      mockPlayerProfileManager.getPlayerById.mockRejectedValue(error);

      await expect(playerProfileService.getPlayer('player123'))
        .rejects.toThrow('Database error');
    });
  });

  describe('updatePlayer', () => {
    const updateRequest: UpdatePlayerRequest = {
      stats: { emailVerified: true }
    };

    it('should update player successfully', async () => {
      const updatedPlayer = { ...mockPlayer, stats: { ...mockPlayer.stats, emailVerified: true } };
      mockPlayerProfileManager.updatePlayer.mockResolvedValue(updatedPlayer);

      const result = await playerProfileService.updatePlayer('player123', updateRequest);

      expect(mockPlayerProfileManager.updatePlayer).toHaveBeenCalledWith('player123', updateRequest);
      expect(result).toEqual(updatedPlayer);
    });

    it('should handle update errors', async () => {
      const error = new Error('Update failed');
      mockPlayerProfileManager.updatePlayer.mockRejectedValue(error);

      await expect(playerProfileService.updatePlayer('player123', updateRequest))
        .rejects.toThrow('Update failed');
    });
  });

  describe('deletePlayer', () => {
    it('should delete player successfully', async () => {
      mockPlayerProfileManager.deletePlayer.mockResolvedValue(true);

      const result = await playerProfileService.deletePlayer('player123');

      expect(mockPlayerProfileManager.deletePlayer).toHaveBeenCalledWith('player123');
      expect(result).toBe(true);
    });

    it('should handle deletion errors', async () => {
      const error = new Error('Deletion failed');
      mockPlayerProfileManager.deletePlayer.mockRejectedValue(error);

      await expect(playerProfileService.deletePlayer('player123'))
        .rejects.toThrow('Deletion failed');
    });
  });

  describe('authenticatePlayer', () => {
    it('should authenticate player successfully', async () => {
      mockPlayerProfileManager.getPlayerByUsername.mockResolvedValue(mockPlayer);

      const result = await playerProfileService.authenticatePlayer('testuser', 'password');

      expect(mockPlayerProfileManager.getPlayerByUsername).toHaveBeenCalledWith('testuser');
      expect(result).toEqual(mockPlayer);
    });

    it('should return null for invalid credentials', async () => {
      mockPlayerProfileManager.getPlayerByUsername.mockResolvedValue(null);

      const result = await playerProfileService.authenticatePlayer('invalid', 'password');

      expect(result).toBeNull();
    });

    it('should handle authentication errors', async () => {
      const error = new Error('Auth error');
      mockPlayerProfileManager.getPlayerByUsername.mockRejectedValue(error);

      await expect(playerProfileService.authenticatePlayer('testuser', 'password'))
        .rejects.toThrow('Auth error');
    });
  });

  describe('verifyEmail', () => {
    it('should verify email successfully', async () => {
      const playerWithToken = { ...mockPlayer, verificationToken: 'valid-token' };
      mockPlayerProfileManager.getPlayerById.mockResolvedValue(playerWithToken);
      mockPlayerProfileManager.updatePlayer.mockResolvedValue(mockPlayer);

      const result = await playerProfileService.verifyEmail('player123', 'valid-token');

      expect(mockPlayerProfileManager.getPlayerById).toHaveBeenCalledWith('player123');
      expect(mockPlayerProfileManager.updatePlayer).toHaveBeenCalledWith('player123', {
        stats: { ...playerWithToken.stats, emailVerified: true }
      });
      expect(result).toBe(true);
    });

    it('should return false for invalid token', async () => {
      const playerWithToken = { ...mockPlayer, verificationToken: 'different-token' };
      mockPlayerProfileManager.getPlayerById.mockResolvedValue(playerWithToken);

      const result = await playerProfileService.verifyEmail('player123', 'invalid-token');

      expect(result).toBe(false);
      expect(mockPlayerProfileManager.updatePlayer).not.toHaveBeenCalled();
    });

    it('should return false when player not found', async () => {
      mockPlayerProfileManager.getPlayerById.mockResolvedValue(null);

      const result = await playerProfileService.verifyEmail('player123', 'token');

      expect(result).toBe(false);
    });
  });

  describe('Bankroll Management', () => {
    const mockBankrollResponse: BankrollUpdateResponse = {
      success: true,
      previousBalance: 1000,
      newBalance: 1100,
      transactionId: 'txn123'
    };

    describe('depositFunds', () => {
      it('should deposit funds successfully', async () => {
        mockPlayerProfileManager.updateBankroll.mockResolvedValue(mockBankrollResponse);

        const result = await playerProfileService.depositFunds('player123', 100, 'Test deposit');

        expect(mockPlayerProfileManager.updateBankroll).toHaveBeenCalledWith({
          playerId: 'player123',
          amount: 100,
          transactionType: TransactionType.DEPOSIT,
          description: 'Test deposit'
        });
        expect(result).toEqual(mockBankrollResponse);
      });

      it('should use default description when none provided', async () => {
        mockPlayerProfileManager.updateBankroll.mockResolvedValue(mockBankrollResponse);

        await playerProfileService.depositFunds('player123', 100);

        expect(mockPlayerProfileManager.updateBankroll).toHaveBeenCalledWith({
          playerId: 'player123',
          amount: 100,
          transactionType: TransactionType.DEPOSIT,
          description: 'Player deposit'
        });
      });

      it('should throw error for negative amount', async () => {
        await expect(playerProfileService.depositFunds('player123', -100))
          .rejects.toThrow('Deposit amount must be positive');

        expect(mockPlayerProfileManager.updateBankroll).not.toHaveBeenCalled();
      });

      it('should throw error for zero amount', async () => {
        await expect(playerProfileService.depositFunds('player123', 0))
          .rejects.toThrow('Deposit amount must be positive');
      });
    });

    describe('withdrawFunds', () => {
      it('should withdraw funds successfully', async () => {
        mockPlayerProfileManager.updateBankroll.mockResolvedValue(mockBankrollResponse);

        const result = await playerProfileService.withdrawFunds('player123', 50, 'Test withdrawal');

        expect(mockPlayerProfileManager.updateBankroll).toHaveBeenCalledWith({
          playerId: 'player123',
          amount: -50,
          transactionType: TransactionType.WITHDRAWAL,
          description: 'Test withdrawal'
        });
        expect(result).toEqual(mockBankrollResponse);
      });

      it('should use default description when none provided', async () => {
        mockPlayerProfileManager.updateBankroll.mockResolvedValue(mockBankrollResponse);

        await playerProfileService.withdrawFunds('player123', 50);

        expect(mockPlayerProfileManager.updateBankroll).toHaveBeenCalledWith({
          playerId: 'player123',
          amount: -50,
          transactionType: TransactionType.WITHDRAWAL,
          description: 'Player withdrawal'
        });
      });

      it('should throw error for negative amount', async () => {
        await expect(playerProfileService.withdrawFunds('player123', -50))
          .rejects.toThrow('Withdrawal amount must be positive');
      });
    });

    describe('recordGameWin', () => {
      it('should record game win successfully', async () => {
        mockPlayerProfileManager.updateBankroll.mockResolvedValue(mockBankrollResponse);

        const result = await playerProfileService.recordGameWin('player123', 200, 'game456');

        expect(mockPlayerProfileManager.updateBankroll).toHaveBeenCalledWith({
          playerId: 'player123',
          amount: 200,
          transactionType: TransactionType.GAME_WIN,
          description: 'Game winnings',
          gameId: 'game456'
        });
        expect(result).toEqual(mockBankrollResponse);
      });

      it('should throw error for negative amount', async () => {
        await expect(playerProfileService.recordGameWin('player123', -200, 'game456'))
          .rejects.toThrow('Amount must be positive');
      });

      it('should handle recording errors', async () => {
        const error = new Error('Record error');
        mockPlayerProfileManager.updateBankroll.mockRejectedValue(error);

        await expect(playerProfileService.recordGameWin('player123', 200, 'game456'))
          .rejects.toThrow('Record error');
      });
    });

    describe('recordGameLoss', () => {
      it('should record game loss successfully', async () => {
        mockPlayerProfileManager.updateBankroll.mockResolvedValue(mockBankrollResponse);

        const result = await playerProfileService.recordGameLoss('player123', 150, 'game456');

        expect(mockPlayerProfileManager.updateBankroll).toHaveBeenCalledWith({
          playerId: 'player123',
          amount: -150,
          transactionType: TransactionType.GAME_LOSS,
          description: 'Game loss',
          gameId: 'game456'
        });
        expect(result).toEqual(mockBankrollResponse);
      });

      it('should throw error for negative amount', async () => {
        await expect(playerProfileService.recordGameLoss('player123', -150, 'game456'))
          .rejects.toThrow('Amount must be positive');
      });
    });

    describe('recordRake', () => {
      it('should record rake successfully', async () => {
        mockPlayerProfileManager.updateBankroll.mockResolvedValue(mockBankrollResponse);

        const result = await playerProfileService.recordRake('player123', 10, 'game456');

        expect(mockPlayerProfileManager.updateBankroll).toHaveBeenCalledWith({
          playerId: 'player123',
          amount: -10,
          transactionType: TransactionType.RAKE,
          description: 'Rake fee',
          gameId: 'game456'
        });
        expect(result).toEqual(mockBankrollResponse);
      });

      it('should throw error for negative amount', async () => {
        await expect(playerProfileService.recordRake('player123', -10, 'game456'))
          .rejects.toThrow('Amount must be positive');
      });
    });
  });

  describe('searchPlayers', () => {
    const mockSearchResponse: PaginatedPlayersResponse = {
      players: [mockPlayer],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1
    };

    it('should search players successfully', async () => {
      const filters: PlayerFilters = { isActive: true };
      const pagination: PaginationOptions = { page: 1, limit: 10 };

      mockPlayerProfileManager.searchPlayers.mockResolvedValue(mockSearchResponse);

      const result = await playerProfileService.searchPlayers(filters, pagination);

      expect(mockPlayerProfileManager.searchPlayers).toHaveBeenCalledWith(filters, pagination);
      expect(result).toEqual(mockSearchResponse);
    });

    it('should handle search with empty filters', async () => {
      const pagination: PaginationOptions = { page: 1, limit: 10 };

      mockPlayerProfileManager.searchPlayers.mockResolvedValue(mockSearchResponse);

      const result = await playerProfileService.searchPlayers({}, pagination);

      expect(result).toEqual(mockSearchResponse);
    });

    it('should handle search errors', async () => {
      const error = new Error('Search failed');
      mockPlayerProfileManager.searchPlayers.mockRejectedValue(error);

      await expect(playerProfileService.searchPlayers({}, { page: 1, limit: 10 }))
        .rejects.toThrow('Search failed');
    });
  });

  describe('getPlayerSummary', () => {
    const mockSummary: PlayerSummary = {
      player: mockPlayer,
      totalHandsPlayed: 100,
      totalProfit: 300,
      recentActivity: [],
      gameStats: [],
      achievements: [],
      preferences: []
    };

    it('should get player summary successfully', async () => {
      mockPlayerProfileManager.getPlayerSummary.mockResolvedValue(mockSummary);

      const result = await playerProfileService.getPlayerSummary('player123');

      expect(mockPlayerProfileManager.getPlayerSummary).toHaveBeenCalledWith('player123');
      expect(result).toEqual(mockSummary);
    });

    it('should return null when summary not found', async () => {
      mockPlayerProfileManager.getPlayerSummary.mockResolvedValue(null);

      const result = await playerProfileService.getPlayerSummary('player123');

      expect(result).toBeNull();
    });
  });

  describe('getLeaderboard', () => {
    it('should get leaderboard successfully', async () => {
      const mockSearchResponse: PaginatedPlayersResponse = {
        players: [mockPlayer],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1
      };

      mockPlayerProfileManager.searchPlayers.mockResolvedValue(mockSearchResponse);

      const result = await playerProfileService.getLeaderboard();

      expect(mockPlayerProfileManager.searchPlayers).toHaveBeenCalledWith({}, {
        page: 1,
        limit: 50,
        sortBy: 'bankroll',
        sortOrder: 'desc'
      });
      expect(result).toEqual([mockPlayer]);
    });

    it('should get leaderboard with custom limit', async () => {
      const mockSearchResponse: PaginatedPlayersResponse = {
        players: [mockPlayer],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1
      };

      mockPlayerProfileManager.searchPlayers.mockResolvedValue(mockSearchResponse);

      const result = await playerProfileService.getLeaderboard(undefined, undefined, 10);

      expect(mockPlayerProfileManager.searchPlayers).toHaveBeenCalledWith({}, {
        page: 1,
        limit: 10,
        sortBy: 'bankroll',
        sortOrder: 'desc'
      });
      expect(result).toEqual([mockPlayer]);
    });
  });

  describe('updatePlayerGameStats', () => {
    it('should update game stats successfully', async () => {
      const gameData = {
        gameType: 'texas_holdem',
        stakesLevel: '1/2',
        handsPlayed: 50,
        profit: 100,
        vpip: 25.0,
        pfr: 18.5,
        aggressionFactor: 2.2,
        sessionTime: 7200
      };

      mockPlayerProfileManager.updateGameStats.mockResolvedValue({
        id: 'stats123',
        playerId: 'player123',
        gameType: 'texas_holdem',
        stakesLevel: '1/2',
        handsPlayed: 50,
        totalProfit: 100,
        biggestWin: 200,
        biggestLoss: 50,
        vpip: 25.0,
        pfr: 18.5,
        aggressionFactor: 2.2,
        totalSessionTime: 7200,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await playerProfileService.updatePlayerGameStats('player123', gameData);

      expect(mockPlayerProfileManager.updateGameStats).toHaveBeenCalledWith({
        playerId: 'player123',
        gameType: 'texas_holdem',
        stakesLevel: '1/2',
        handsPlayed: 50,
        totalProfit: 100,
        biggestWin: 100,
        biggestLoss: 0,
        vpip: 25.0,
        pfr: 18.5,
        aggressionFactor: 2.2,
        totalSessionTime: 7200,
        lastPlayed: expect.any(Date)
      });
    });

    it('should handle negative profit correctly', async () => {
      const gameData = {
        gameType: 'texas_holdem',
        stakesLevel: '1/2',
        handsPlayed: 50,
        profit: -100,
        sessionTime: 7200
      };

      mockPlayerProfileManager.updateGameStats.mockResolvedValue({
        id: 'stats124',
        playerId: 'player123',
        gameType: 'texas_holdem',
        stakesLevel: '1/2',
        handsPlayed: 50,
        totalProfit: -100,
        biggestWin: 0,
        biggestLoss: 100,
        vpip: 0,
        pfr: 0,
        aggressionFactor: 0,
        totalSessionTime: 7200,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await playerProfileService.updatePlayerGameStats('player123', gameData);

      expect(mockPlayerProfileManager.updateGameStats).toHaveBeenCalledWith(
        expect.objectContaining({
          biggestWin: 0,
          biggestLoss: -100
        })
      );
    });

    it('should use default values for optional stats', async () => {
      const gameData = {
        gameType: 'texas_holdem',
        stakesLevel: '1/2',
        handsPlayed: 50,
        profit: 100,
        sessionTime: 7200
      };

      mockPlayerProfileManager.updateGameStats.mockResolvedValue({
        id: 'stats125',
        playerId: 'player123',
        gameType: 'texas_holdem',
        stakesLevel: '1/2',
        handsPlayed: 50,
        totalProfit: 100,
        biggestWin: 100,
        biggestLoss: 0,
        vpip: 0,
        pfr: 0,
        aggressionFactor: 0,
        totalSessionTime: 7200,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await playerProfileService.updatePlayerGameStats('player123', gameData);

      expect(mockPlayerProfileManager.updateGameStats).toHaveBeenCalledWith(
        expect.objectContaining({
          vpip: 0,
          pfr: 0,
          aggressionFactor: 0
        })
      );
    });
  });

  describe('Validation Methods', () => {
    describe('validateUsernameAvailable', () => {
      it('should return true when username is available', async () => {
        mockPlayerProfileManager.getPlayerByUsername.mockResolvedValue(null);

        const result = await playerProfileService.validateUsernameAvailable('newuser');

        expect(mockPlayerProfileManager.getPlayerByUsername).toHaveBeenCalledWith('newuser');
        expect(result).toBe(true);
      });

      it('should return false when username is taken', async () => {
        mockPlayerProfileManager.getPlayerByUsername.mockResolvedValue(mockPlayer);

        const result = await playerProfileService.validateUsernameAvailable('testuser');

        expect(result).toBe(false);
      });
    });

    describe('validateEmailAvailable', () => {
      it('should return true when email is available', async () => {
        mockPlayerProfileManager.getPlayerByEmail.mockResolvedValue(null);

        const result = await playerProfileService.validateEmailAvailable('new@example.com');

        expect(mockPlayerProfileManager.getPlayerByEmail).toHaveBeenCalledWith('new@example.com');
        expect(result).toBe(true);
      });

      it('should return false when email is taken', async () => {
        mockPlayerProfileManager.getPlayerByEmail.mockResolvedValue(mockPlayer);

        const result = await playerProfileService.validateEmailAvailable('test@example.com');

        expect(result).toBe(false);
      });
    });
  });

  describe('Utility Methods', () => {
    describe('getBankrollHistory', () => {
      it('should get bankroll history successfully', async () => {
        const mockHistory = [{ 
          id: 'txn1', 
          playerId: 'player123',
          amount: 100, 
          balanceBefore: 1000,
          balanceAfter: 1100,
          transactionType: TransactionType.DEPOSIT,
          description: 'Test deposit',
          createdAt: new Date(),
          metadata: {}
        }];
        mockPlayerProfileManager.getBankrollHistory.mockResolvedValue(mockHistory);

        const result = await playerProfileService.getBankrollHistory('player123', 25, 10);

        expect(mockPlayerProfileManager.getBankrollHistory).toHaveBeenCalledWith('player123', 25, 10);
        expect(result).toEqual(mockHistory);
      });

      it('should use default pagination when not specified', async () => {
        const mockHistory: any[] = [];
        mockPlayerProfileManager.getBankrollHistory.mockResolvedValue(mockHistory);

        await playerProfileService.getBankrollHistory('player123');

        expect(mockPlayerProfileManager.getBankrollHistory).toHaveBeenCalledWith('player123', 50, 0);
      });
    });

    describe('getPlayerCount', () => {
      it('should get total player count', async () => {
        const mockSearchResponse: PaginatedPlayersResponse = {
          players: [],
          total: 42,
          page: 1,
          limit: 1,
          totalPages: 42
        };

        mockPlayerProfileManager.searchPlayers.mockResolvedValue(mockSearchResponse);

        const result = await playerProfileService.getPlayerCount();

        expect(mockPlayerProfileManager.searchPlayers).toHaveBeenCalledWith({}, { page: 1, limit: 1 });
        expect(result).toBe(42);
      });
    });

    describe('getActivePlayersCount', () => {
      it('should get active player count (currently same as total)', async () => {
        const mockSearchResponse: PaginatedPlayersResponse = {
          players: [],
          total: 25,
          page: 1,
          limit: 1,
          totalPages: 25
        };

        mockPlayerProfileManager.searchPlayers.mockResolvedValue(mockSearchResponse);

        const result = await playerProfileService.getActivePlayersCount();

        expect(result).toBe(25);
      });
    });
  });

  describe('Factory and Singleton Functions', () => {
    it('should create service instance via factory', () => {
      const service = createPlayerProfileService(mockPlayerProfileManager);
      expect(service).toBeInstanceOf(PlayerProfileService);
    });

    it('should set and get global service instance', () => {
      setGlobalPlayerProfileService(playerProfileService);
      const globalService = getGlobalPlayerProfileService();
      expect(globalService).toBe(playerProfileService);
    });

    it('should throw error when getting uninitialized global service', () => {
      resetGlobalPlayerProfileService();
      expect(() => getGlobalPlayerProfileService())
        .toThrow('Player profile service not initialized. Call setGlobalPlayerProfileService first.');
    });

    it('should reset global service instance', () => {
      setGlobalPlayerProfileService(playerProfileService);
      resetGlobalPlayerProfileService();
      expect(() => getGlobalPlayerProfileService())
        .toThrow('Player profile service not initialized. Call setGlobalPlayerProfileService first.');
    });
  });
});