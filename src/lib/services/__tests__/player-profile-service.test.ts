import { PlayerProfileService, createPlayerProfileService, setGlobalPlayerProfileService, getGlobalPlayerProfileService, resetGlobalPlayerProfileService } from '../player-profile-service';
import { PlayerProfileManager } from '../../database/player-profile-manager';
import { 
  Player, 
  PlayerFilters, 
  PaginationOptions, 
  PaginatedPlayersResponse, 
  PlayerSummary,
  BankrollTransaction,
  BankrollUpdateResponse,
  PlayerStats,
  PlayerGameStats,
  PlayerAchievement,
  PlayerPreferences,
  TransactionType
} from '../../../types/player-profile';

// Mock the PlayerProfileManager module completely
jest.mock('../../database/player-profile-manager', () => {
  return {
    PlayerProfileManager: jest.fn().mockImplementation(() => ({
      createPlayer: jest.fn(),
      getPlayerById: jest.fn(),
      getPlayerByUsername: jest.fn(),
      getPlayerByEmail: jest.fn(),
      updatePlayer: jest.fn(),
      deletePlayer: jest.fn(),
      updateBankroll: jest.fn(),
      getBankrollHistory: jest.fn(),
      searchPlayers: jest.fn(),
      getPlayerSummary: jest.fn(),
      updateGameStats: jest.fn()
    }))
  };
});

// Create a PlayerProfileError class for testing
class PlayerProfileError extends Error {
  code: string;
  details?: Record<string, any>;
  
  constructor(message: string) {
    super(message);
    this.name = 'PlayerProfileError';
    this.code = 'UNKNOWN_ERROR';
  }
}

describe('PlayerProfileService', () => {
  let service: PlayerProfileService;
  let mockProfileManager: jest.Mocked<PlayerProfileManager>;

  const mockPlayer: Player = {
    id: 'player-123',
    username: 'testuser',
    email: 'test@example.com',
    passwordHash: 'hashed-password',
    bankroll: 1000,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    lastLogin: new Date('2024-01-01'),
    emailVerified: true,
    isActive: true,
    avatarUrl: undefined,
    verificationToken: undefined,
    resetToken: undefined,
    resetTokenExpires: undefined,
    stats: {
      totalHands: 100,
      totalProfit: 500,
      biggestWin: 200,
      biggestLoss: -100,
      totalSessionTime: 3600,
      vpip: 0.25,
      pfr: 0.15,
      aggressionFactor: 2.5,
      achievements: [],
      level: 1,
      experience: 1000,
      averageSessionLength: 360,
      gamesPerWeek: 5,
      preferredStakes: ['$1/$2']
    }
  };

  const mockPlayerSummary: PlayerSummary = {
    player: mockPlayer,
    totalHandsPlayed: 100,
    totalProfit: 500,
    recentActivity: [],
    gameStats: [],
    achievements: [],
    preferences: []
  };

  const mockBankrollTransaction: BankrollTransaction = {
    id: 'tx-123',
    playerId: 'player-123',
    transactionType: TransactionType.DEPOSIT,
    amount: 100,
    balanceBefore: 1000,
    balanceAfter: 1100,
    description: 'Test deposit',
    createdAt: new Date('2024-01-01'),
    metadata: {}
  };

  const mockBankrollUpdateResponse: BankrollUpdateResponse = {
    success: true,
    previousBalance: 1000,
    newBalance: 1100,
    transactionId: 'tx-123'
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock instance
    mockProfileManager = new PlayerProfileManager({} as any) as jest.Mocked<PlayerProfileManager>;
    
    // Setup default mock implementations
    mockProfileManager.createPlayer = jest.fn();
    mockProfileManager.getPlayerById = jest.fn();
    mockProfileManager.getPlayerByUsername = jest.fn();
    mockProfileManager.getPlayerByEmail = jest.fn();
    mockProfileManager.updatePlayer = jest.fn();
    mockProfileManager.deletePlayer = jest.fn();
    mockProfileManager.updateBankroll = jest.fn();
    mockProfileManager.getBankrollHistory = jest.fn();
    mockProfileManager.searchPlayers = jest.fn();
    mockProfileManager.getPlayerSummary = jest.fn();
    mockProfileManager.updateGameStats = jest.fn();
    
    service = new PlayerProfileService(mockProfileManager);
  });

  describe('Constructor', () => {
    it('should create service instance with profile manager', () => {
      expect(service).toBeInstanceOf(PlayerProfileService);
    });
  });

  describe('Core CRUD Operations', () => {
    describe('createPlayer', () => {
      const playerData = {
        username: 'newuser',
        email: 'new@example.com',
        password: 'newpassword',
        avatarUrl: 'http://example.com/avatar.png',
        initialDeposit: 500
      };

      it('should create a new player successfully', async () => {
        mockProfileManager.createPlayer.mockResolvedValue(mockPlayer);

        const result = await service.createPlayer(playerData);

        expect(mockProfileManager.createPlayer).toHaveBeenCalledWith(playerData);
        expect(result).toEqual(mockPlayer);
      });

      it('should handle errors during player creation', async () => {
        const error = new Error('Database error');
        mockProfileManager.createPlayer.mockRejectedValue(error);

        await expect(service.createPlayer(playerData)).rejects.toThrow();
      });

      it('should propagate PlayerProfileError correctly', async () => {
        const profileError = new PlayerProfileError('Username already exists');
        profileError.code = 'DUPLICATE_USERNAME';
        mockProfileManager.createPlayer.mockRejectedValue(profileError);

        await expect(service.createPlayer(playerData)).rejects.toThrow(profileError);
      });
    });

    describe('getPlayer', () => {
      it('should retrieve player by ID successfully', async () => {
        mockProfileManager.getPlayerById.mockResolvedValue(mockPlayer);
        
        const result = await service.getPlayer('player-123');
        
        expect(mockProfileManager.getPlayerById).toHaveBeenCalledWith('player-123', {
          includeStats: true,
          includeRecentActivity: true
        });
        expect(result).toEqual(mockPlayer);
      });      it('should return null when player not found', async () => {
        mockProfileManager.getPlayerById.mockResolvedValue(null);

        const result = await service.getPlayer('nonexistent');

        expect(result).toBeNull();
      });

      it('should handle errors during player retrieval', async () => {
        const error = new Error('Database error');
        mockProfileManager.getPlayerById.mockRejectedValue(error);

        await expect(service.getPlayer('player-123')).rejects.toThrow();
      });
    });

    describe('updatePlayer', () => {
      const updateData = { username: 'updateduser', email: 'updated@example.com' };

      it('should update player successfully', async () => {
        const updatedPlayer = { ...mockPlayer, username: 'updateduser', email: 'updated@example.com' };
        mockProfileManager.updatePlayer.mockResolvedValue(updatedPlayer);

        const result = await service.updatePlayer('player-123', updateData);

        expect(mockProfileManager.updatePlayer).toHaveBeenCalledWith('player-123', updateData);
        expect(result).toEqual(updatedPlayer);
      });

      it('should handle errors during player update', async () => {
        const error = new Error('Database error');
        mockProfileManager.updatePlayer.mockRejectedValue(error);

        await expect(service.updatePlayer('player-123', updateData)).rejects.toThrow();
      });
    });

    describe('deletePlayer', () => {
      it('should delete player successfully', async () => {
        mockProfileManager.deletePlayer.mockResolvedValue(true);

        const result = await service.deletePlayer('player-123');

        expect(mockProfileManager.deletePlayer).toHaveBeenCalledWith('player-123');
        expect(result).toBe(true);
      });

      it('should handle errors during player deletion', async () => {
        const error = new Error('Database error');
        mockProfileManager.deletePlayer.mockRejectedValue(error);

        await expect(service.deletePlayer('player-123')).rejects.toThrow();
      });
    });
  });

  describe('Authentication', () => {
    describe('authenticatePlayer', () => {
      it('should authenticate player with username successfully', async () => {
        mockProfileManager.getPlayerByUsername.mockResolvedValue(mockPlayer);

        const result = await service.authenticatePlayer('testuser', 'password');

        expect(mockProfileManager.getPlayerByUsername).toHaveBeenCalledWith('testuser');
        expect(result).toEqual(mockPlayer);
      });

      it('should authenticate player with email successfully', async () => {
        // Note: Current implementation uses getPlayerByUsername, not getPlayerByEmail
        // This test reflects current behavior - should be updated if email auth is implemented
        mockProfileManager.getPlayerByUsername.mockResolvedValue(mockPlayer);
        
        const result = await service.authenticatePlayer('test@example.com', 'password');
        
        expect(mockProfileManager.getPlayerByUsername).toHaveBeenCalledWith('test@example.com');
        expect(result).toEqual(mockPlayer);
      });      it('should return null for invalid credentials', async () => {
        mockProfileManager.getPlayerByUsername.mockResolvedValue(null);
        mockProfileManager.getPlayerByEmail.mockResolvedValue(null);

        const result = await service.authenticatePlayer('invalid', 'password');

        expect(result).toBeNull();
      });

      it('should handle errors during authentication', async () => {
        const error = new Error('Database error');
        mockProfileManager.getPlayerByUsername.mockRejectedValue(error);

        await expect(service.authenticatePlayer('testuser', 'password')).rejects.toThrow();
      });
    });

    describe('verifyEmail', () => {
      it('should verify email successfully', async () => {
        const unverifiedPlayer = { ...mockPlayer, emailVerified: false, verificationToken: 'token123' };
        
        mockProfileManager.getPlayerById.mockResolvedValue(unverifiedPlayer);

        const result = await service.verifyEmail('player-123', 'token123');

        expect(mockProfileManager.getPlayerById).toHaveBeenCalledWith('player-123');
        expect(mockProfileManager.updatePlayer).toHaveBeenCalledWith('player-123', {
          stats: { ...unverifiedPlayer.stats, emailVerified: true }
        });
        expect(result).toBe(true);
      });

      it('should return false for invalid verification token', async () => {
        const unverifiedPlayer = { ...mockPlayer, emailVerified: false, verificationToken: 'different-token' };
        mockProfileManager.getPlayerById.mockResolvedValue(unverifiedPlayer);

        const result = await service.verifyEmail('player-123', 'wrong-token');

        expect(result).toBe(false);
      });

      it('should return false for already verified email', async () => {
        mockProfileManager.getPlayerById.mockResolvedValue(mockPlayer);

        const result = await service.verifyEmail('player-123', 'token123');

        expect(result).toBe(false);
      });

      it('should handle errors during email verification', async () => {
        const error = new Error('Database error');
        mockProfileManager.getPlayerById.mockRejectedValue(error);

        await expect(service.verifyEmail('player-123', 'token123')).rejects.toThrow();
      });
    });
  });

  describe('Bankroll Management', () => {
    describe('depositFunds', () => {
      it('should deposit funds successfully', async () => {
        mockProfileManager.updateBankroll.mockResolvedValue(mockBankrollUpdateResponse);

        const result = await service.depositFunds('player-123', 100, 'Test deposit');

        expect(mockProfileManager.updateBankroll).toHaveBeenCalledWith({
          playerId: 'player-123',
          amount: 100,
          transactionType: TransactionType.DEPOSIT,
          description: 'Test deposit'
        });
        expect(result).toEqual(mockBankrollUpdateResponse);
      });

      it('should reject negative deposit amounts', async () => {
        await expect(service.depositFunds('player-123', -100)).rejects.toThrow('Deposit amount must be positive');
      });

      it('should reject zero deposit amounts', async () => {
        await expect(service.depositFunds('player-123', 0)).rejects.toThrow('Deposit amount must be positive');
      });

      it('should handle errors during deposit', async () => {
        const error = new Error('Database error');
        mockProfileManager.updateBankroll.mockRejectedValue(error);

        await expect(service.depositFunds('player-123', 100)).rejects.toThrow();
      });
    });

    describe('withdrawFunds', () => {
      it('should withdraw funds successfully', async () => {
        const withdrawalResponse = { ...mockBankrollUpdateResponse, previousBalance: 1100, newBalance: 1000 };
        mockProfileManager.updateBankroll.mockResolvedValue(withdrawalResponse);

        const result = await service.withdrawFunds('player-123', 100, 'Test withdrawal');

        expect(mockProfileManager.updateBankroll).toHaveBeenCalledWith({
          playerId: 'player-123',
          amount: -100,
          transactionType: TransactionType.WITHDRAWAL,
          description: 'Test withdrawal'
        });
        expect(result).toEqual(withdrawalResponse);
      });

      it('should reject negative withdrawal amounts', async () => {
        await expect(service.withdrawFunds('player-123', -100)).rejects.toThrow('Withdrawal amount must be positive');
      });

      it('should reject zero withdrawal amounts', async () => {
        await expect(service.withdrawFunds('player-123', 0)).rejects.toThrow('Withdrawal amount must be positive');
      });

      it('should handle errors during withdrawal', async () => {
        const error = new Error('Database error');
        mockProfileManager.updateBankroll.mockRejectedValue(error);

        await expect(service.withdrawFunds('player-123', 100)).rejects.toThrow();
      });
    });

    describe('recordGameWin', () => {
      it('should record game win successfully', async () => {
        const winResponse = { ...mockBankrollUpdateResponse, previousBalance: 1000, newBalance: 1200 };
        mockProfileManager.updateBankroll.mockResolvedValue(winResponse);

        const result = await service.recordGameWin('player-123', 200, 'game-456');

        expect(mockProfileManager.updateBankroll).toHaveBeenCalledWith({
          playerId: 'player-123',
          amount: 200,
          transactionType: TransactionType.GAME_WIN,
          description: 'Game winnings',
          gameId: 'game-456'
        });
        expect(result).toEqual(winResponse);
      });

      it('should reject negative win amounts', async () => {
        await expect(service.recordGameWin('player-123', -200, 'game-456')).rejects.toThrow('Amount must be positive');
      });

      it('should handle errors during game win recording', async () => {
        const error = new Error('Database error');
        mockProfileManager.updateBankroll.mockRejectedValue(error);

        await expect(service.recordGameWin('player-123', 200, 'game-456')).rejects.toThrow();
      });
    });

    describe('recordGameLoss', () => {
      it('should record game loss successfully', async () => {
        const lossResponse = { ...mockBankrollUpdateResponse, previousBalance: 1000, newBalance: 850 };
        mockProfileManager.updateBankroll.mockResolvedValue(lossResponse);

        const result = await service.recordGameLoss('player-123', 150, 'game-456');

        expect(mockProfileManager.updateBankroll).toHaveBeenCalledWith({
          playerId: 'player-123',
          amount: -150,
          transactionType: TransactionType.GAME_LOSS,
          description: 'Game loss',
          gameId: 'game-456'
        });
        expect(result).toEqual(lossResponse);
      });

      it('should reject negative loss amounts', async () => {
        await expect(service.recordGameLoss('player-123', -150, 'game-456')).rejects.toThrow('Amount must be positive');
      });

      it('should handle errors during game loss recording', async () => {
        const error = new Error('Database error');
        mockProfileManager.updateBankroll.mockRejectedValue(error);

        await expect(service.recordGameLoss('player-123', 150, 'game-456')).rejects.toThrow();
      });
    });

    describe('recordRake', () => {
      it('should record rake payment successfully', async () => {
        const rakeResponse = { ...mockBankrollUpdateResponse, previousBalance: 1000, newBalance: 995 };
        mockProfileManager.updateBankroll.mockResolvedValue(rakeResponse);

        const result = await service.recordRake('player-123', 5, 'game-456');

        expect(mockProfileManager.updateBankroll).toHaveBeenCalledWith({
          playerId: 'player-123',
          amount: -5,
          transactionType: TransactionType.RAKE,
          description: 'Rake fee',
          gameId: 'game-456'
        });
        expect(result).toEqual(rakeResponse);
      });

      it('should reject negative rake amounts', async () => {
        await expect(service.recordRake('player-123', -5, 'game-456')).rejects.toThrow('Amount must be positive');
      });

      it('should handle errors during rake recording', async () => {
        const error = new Error('Database error');
        mockProfileManager.updateBankroll.mockRejectedValue(error);

        await expect(service.recordRake('player-123', 5, 'game-456')).rejects.toThrow();
      });
    });
  });

  describe('Player Search and Analytics', () => {
    describe('searchPlayers', () => {
      const mockPaginatedResponse: PaginatedPlayersResponse = {
        players: [mockPlayer],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1
      };

      it('should search players with filters and pagination', async () => {
        const filters: PlayerFilters = { emailVerified: true, minBankroll: 500 };
        const pagination: PaginationOptions = { page: 1, limit: 10 };
        
        mockProfileManager.searchPlayers.mockResolvedValue(mockPaginatedResponse);

        const result = await service.searchPlayers(filters, pagination);

        expect(mockProfileManager.searchPlayers).toHaveBeenCalledWith(filters, pagination);
        expect(result).toEqual(mockPaginatedResponse);
      });

      it('should search players with default filters', async () => {
        const pagination: PaginationOptions = { page: 1, limit: 10 };
        
        mockProfileManager.searchPlayers.mockResolvedValue(mockPaginatedResponse);

        const result = await service.searchPlayers({}, pagination);

        expect(mockProfileManager.searchPlayers).toHaveBeenCalledWith({}, pagination);
        expect(result).toEqual(mockPaginatedResponse);
      });

      it('should handle errors during player search', async () => {
        const error = new Error('Database error');
        mockProfileManager.searchPlayers.mockRejectedValue(error);

        await expect(service.searchPlayers({}, { page: 1, limit: 10 })).rejects.toThrow();
      });
    });

    describe('getPlayerSummary', () => {
      it('should get player summary successfully', async () => {
        mockProfileManager.getPlayerSummary.mockResolvedValue(mockPlayerSummary);

        const result = await service.getPlayerSummary('player-123');

        expect(mockProfileManager.getPlayerSummary).toHaveBeenCalledWith('player-123');
        expect(result).toEqual(mockPlayerSummary);
      });

      it('should return null when player summary not found', async () => {
        mockProfileManager.getPlayerSummary.mockResolvedValue(null);

        const result = await service.getPlayerSummary('nonexistent');

        expect(result).toBeNull();
      });

      it('should handle errors during player summary retrieval', async () => {
        const error = new Error('Database error');
        mockProfileManager.getPlayerSummary.mockRejectedValue(error);

        await expect(service.getPlayerSummary('player-123')).rejects.toThrow();
      });
    });

    describe('getLeaderboard', () => {
      it('should get leaderboard with default limit', async () => {
        const mockPaginatedResponse: PaginatedPlayersResponse = {
          players: [mockPlayer],
          total: 1,
          page: 1,
          limit: 50,
          totalPages: 1
        };
        
        mockProfileManager.searchPlayers.mockResolvedValue(mockPaginatedResponse);

        const result = await service.getLeaderboard();

        expect(mockProfileManager.searchPlayers).toHaveBeenCalledWith({}, {
          page: 1,
          limit: 50,
          sortBy: 'bankroll',
          sortOrder: 'desc'
        });
        expect(result).toEqual([mockPlayer]);
      });

      it('should get leaderboard with custom limit', async () => {
        const mockPaginatedResponse: PaginatedPlayersResponse = {
          players: [mockPlayer],
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1
        };
        
        mockProfileManager.searchPlayers.mockResolvedValue(mockPaginatedResponse);

        const result = await service.getLeaderboard(undefined, undefined, 25);

        expect(mockProfileManager.searchPlayers).toHaveBeenCalledWith({}, {
          page: 1,
          limit: 25,
          sortBy: 'bankroll',
          sortOrder: 'desc'
        });
        expect(result).toEqual([mockPlayer]);
      });

      it('should handle errors during leaderboard retrieval', async () => {
        const error = new Error('Database error');
        mockProfileManager.searchPlayers.mockRejectedValue(error);

        await expect(service.getLeaderboard()).rejects.toThrow();
      });
    });
  });

  describe('Player Statistics', () => {
    describe('updatePlayerGameStats', () => {
      const gameData = {
        gameType: 'NL Hold\'em',
        stakesLevel: '$1/$2',
        handsPlayed: 50,
        profit: 200,
        vpip: 0.25,
        pfr: 0.15,
        aggressionFactor: 2.5,
        sessionTime: 3600
      };

      it('should update player game stats successfully', async () => {
        mockProfileManager.updateGameStats.mockResolvedValue(undefined);

        await service.updatePlayerGameStats('player-123', gameData);

        expect(mockProfileManager.updateGameStats).toHaveBeenCalledWith({
          playerId: 'player-123',
          gameType: 'NL Hold\'em',
          stakesLevel: '$1/$2',
          handsPlayed: 50,
          totalProfit: 200,
          biggestWin: 200,
          biggestLoss: 0,
          vpip: 0.25,
          pfr: 0.15,
          aggressionFactor: 2.5,
          totalSessionTime: 3600,
          lastPlayed: expect.any(Date)
        });
      });

      it('should handle negative profit correctly', async () => {
        const lossGameData = { ...gameData, profit: -150 };
        mockProfileManager.updateGameStats.mockResolvedValue(undefined);

        await service.updatePlayerGameStats('player-123', lossGameData);

        expect(mockProfileManager.updateGameStats).toHaveBeenCalledWith(expect.objectContaining({
          totalProfit: -150,
          biggestWin: 0,
          biggestLoss: -150
        }));
      });

      it('should use default values for optional stats', async () => {
        const minimalGameData = {
          gameType: 'NL Hold\'em',
          stakesLevel: '$1/$2',
          handsPlayed: 50,
          profit: 100,
          sessionTime: 1800
        };
        
        mockProfileManager.updateGameStats.mockResolvedValue(undefined);

        await service.updatePlayerGameStats('player-123', minimalGameData);

        expect(mockProfileManager.updateGameStats).toHaveBeenCalledWith(expect.objectContaining({
          vpip: 0,
          pfr: 0,
          aggressionFactor: 0
        }));
      });

      it('should handle errors during stats update', async () => {
        const error = new Error('Database error');
        mockProfileManager.updateGameStats.mockRejectedValue(error);

        await expect(service.updatePlayerGameStats('player-123', gameData)).rejects.toThrow();
      });
    });
  });

  describe('Validation Helpers', () => {
    describe('validateUsernameAvailable', () => {
      it('should return true for available username', async () => {
        mockProfileManager.getPlayerByUsername.mockResolvedValue(null);

        const result = await service.validateUsernameAvailable('newuser');

        expect(mockProfileManager.getPlayerByUsername).toHaveBeenCalledWith('newuser');
        expect(result).toBe(true);
      });

      it('should return false for taken username', async () => {
        mockProfileManager.getPlayerByUsername.mockResolvedValue(mockPlayer);

        const result = await service.validateUsernameAvailable('testuser');

        expect(result).toBe(false);
      });

      it('should handle errors during username validation', async () => {
        const error = new Error('Database error');
        mockProfileManager.getPlayerByUsername.mockRejectedValue(error);

        await expect(service.validateUsernameAvailable('testuser')).rejects.toThrow();
      });
    });

    describe('validateEmailAvailable', () => {
      it('should return true for available email', async () => {
        mockProfileManager.getPlayerByEmail.mockResolvedValue(null);

        const result = await service.validateEmailAvailable('new@example.com');

        expect(mockProfileManager.getPlayerByEmail).toHaveBeenCalledWith('new@example.com');
        expect(result).toBe(true);
      });

      it('should return false for taken email', async () => {
        mockProfileManager.getPlayerByEmail.mockResolvedValue(mockPlayer);

        const result = await service.validateEmailAvailable('test@example.com');

        expect(result).toBe(false);
      });

      it('should handle errors during email validation', async () => {
        const error = new Error('Database error');
        mockProfileManager.getPlayerByEmail.mockRejectedValue(error);

        await expect(service.validateEmailAvailable('test@example.com')).rejects.toThrow();
      });
    });
  });

  describe('Utility Methods', () => {
    describe('getBankrollHistory', () => {
      it('should get bankroll history with default parameters', async () => {
        const mockHistory = [mockBankrollTransaction];
        mockProfileManager.getBankrollHistory.mockResolvedValue(mockHistory);

        const result = await service.getBankrollHistory('player-123');

        expect(mockProfileManager.getBankrollHistory).toHaveBeenCalledWith('player-123', 50, 0);
        expect(result).toEqual(mockHistory);
      });

      it('should get bankroll history with custom parameters', async () => {
        const mockHistory = [mockBankrollTransaction];
        mockProfileManager.getBankrollHistory.mockResolvedValue(mockHistory);

        const result = await service.getBankrollHistory('player-123', 25, 10);

        expect(mockProfileManager.getBankrollHistory).toHaveBeenCalledWith('player-123', 25, 10);
        expect(result).toEqual(mockHistory);
      });

      it('should handle errors during bankroll history retrieval', async () => {
        const error = new Error('Database error');
        mockProfileManager.getBankrollHistory.mockRejectedValue(error);

        await expect(service.getBankrollHistory('player-123')).rejects.toThrow();
      });
    });

    describe('getPlayerCount', () => {
      it('should get total player count', async () => {
        const mockPaginatedResponse: PaginatedPlayersResponse = {
          players: [],
          total: 42,
          page: 1,
          limit: 1,
          totalPages: 42
        };
        
        mockProfileManager.searchPlayers.mockResolvedValue(mockPaginatedResponse);

        const result = await service.getPlayerCount();

        expect(mockProfileManager.searchPlayers).toHaveBeenCalledWith({}, { page: 1, limit: 1 });
        expect(result).toBe(42);
      });

      it('should handle errors during player count retrieval', async () => {
        const error = new Error('Database error');
        mockProfileManager.searchPlayers.mockRejectedValue(error);

        await expect(service.getPlayerCount()).rejects.toThrow();
      });
    });

    describe('getActivePlayersCount', () => {
      it('should get active player count (currently returns total count)', async () => {
        const mockPaginatedResponse: PaginatedPlayersResponse = {
          players: [],
          total: 25,
          page: 1,
          limit: 1,
          totalPages: 25
        };
        
        mockProfileManager.searchPlayers.mockResolvedValue(mockPaginatedResponse);

        const result = await service.getActivePlayersCount();

        expect(result).toBe(25);
      });

      it('should handle errors during active player count retrieval', async () => {
        const error = new Error('Database error');
        mockProfileManager.searchPlayers.mockRejectedValue(error);

        await expect(service.getActivePlayersCount()).rejects.toThrow();
      });
    });
  });

  describe('Error Handling', () => {
    describe('handleServiceError', () => {
      it('should propagate PlayerProfileError instances unchanged', async () => {
        const profileError = new PlayerProfileError('Custom error');
        profileError.code = 'CUSTOM_ERROR';
        mockProfileManager.getPlayerById.mockRejectedValue(profileError);

        await expect(service.getPlayer('player-123')).rejects.toThrow(profileError);
      });

      it('should wrap generic errors in PlayerProfileError', async () => {
        const genericError = new Error('Generic error');
        mockProfileManager.getPlayerById.mockRejectedValue(genericError);

        try {
          await service.getPlayer('player-123');
          fail('Should have thrown an error');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as any).code).toBe('SERVICE_ERROR');
          expect((error as any).details?.originalError).toBe(genericError);
        }
      });

      it('should handle errors with custom codes', async () => {
        const errorWithCode = new Error('Database connection failed');
        (errorWithCode as any).code = 'DB_CONNECTION_ERROR';
        mockProfileManager.getPlayerById.mockRejectedValue(errorWithCode);

        try {
          await service.getPlayer('player-123');
          fail('Should have thrown an error');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as any).code).toBe('DB_CONNECTION_ERROR');
        }
      });
    });
  });

  describe('Factory and Singleton Patterns', () => {
    describe('createPlayerProfileService', () => {
      it('should create service instance', () => {
        const service = createPlayerProfileService(mockProfileManager);
        expect(service).toBeInstanceOf(PlayerProfileService);
      });
    });

    describe('Global service management', () => {
      beforeEach(() => {
        resetGlobalPlayerProfileService();
      });

      it('should set and get global service instance', () => {
        const service = new PlayerProfileService(mockProfileManager);
        
        setGlobalPlayerProfileService(service);
        const retrieved = getGlobalPlayerProfileService();
        
        expect(retrieved).toBe(service);
      });

      it('should throw error when getting uninitialized global service', () => {
        expect(() => getGlobalPlayerProfileService()).toThrow('Player profile service not initialized. Call setGlobalPlayerProfileService first.');
      });
    });
  });
});
