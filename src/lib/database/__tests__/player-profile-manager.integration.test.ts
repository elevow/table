// US-009: Player Profile Storage - PlayerProfileManager Integration Tests

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('PlayerProfileManager Integration Tests', () => {
  let mockPool: any;
  let mockClient: any;
  let PlayerProfileManager: any;
  let playerManager: any;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();
    jest.resetModules();

    // Create mock implementations
    const mockBcrypt = {
      hash: jest.fn().mockResolvedValue('$2a$12$hashedpassword'),
      compare: jest.fn().mockResolvedValue(true)
    };

    const mockUuid = {
      v4: jest.fn().mockReturnValue('550e8400-e29b-41d4-a716-446655440000')
    };

    // Mock the external dependencies
    jest.doMock('bcryptjs', () => mockBcrypt);
    jest.doMock('uuid', () => ({ v4: mockUuid.v4 }));
    jest.doMock('pg', () => ({
      Pool: jest.fn()
    }));

    // Create mock client
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    // Create mock pool
    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient)
    };

    // Dynamically import the PlayerProfileManager
    const module = await import('../player-profile-manager');
    PlayerProfileManager = module.PlayerProfileManager;
    
    // Create the actual PlayerProfileManager instance
    playerManager = new PlayerProfileManager(mockPool);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('createPlayer', () => {
    const validRequest = {
      username: 'testuser123',
      email: 'test@example.com',
      password: 'SecurePass123!',
      initialDeposit: 1000
    };

    test('should create a player successfully', async () => {
      // Setup mock responses
      const mockQueries = [
        { rows: [], rowCount: 0 }, // BEGIN
        { rows: [], rowCount: 0 }, // username check
        { rows: [], rowCount: 0 }, // email check
        { 
          rows: [{ 
            id: '550e8400-e29b-41d4-a716-446655440000',
            username: 'testuser123',
            email: 'test@example.com',
            bankroll: 0,
            created_at: new Date(),
            updated_at: new Date(),
            is_active: true,
            email_verified: false
          }], 
          rowCount: 1
        }, // INSERT player
        {
          rows: [{ 
            success: true,
            previous_balance: 0,
            new_balance: 1000,
            transaction_id: 'tx-123'
          }],
          rowCount: 1
        }, // Initial deposit
        { rows: [], rowCount: 0 } // COMMIT
      ];

      mockQueries.forEach((response, index) => {
        mockClient.query.mockResolvedValueOnce(response);
      });

      const result = await playerManager.createPlayer(validRequest);

      expect(result).toBeDefined();
      expect(result.username).toBe(validRequest.username);
      expect(result.email).toBe(validRequest.email);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle validation errors', async () => {
      await expect(playerManager.createPlayer({
        username: '',
        email: 'test@example.com',
        password: 'password123'
      })).rejects.toThrow();
    });

    test('should handle duplicate username', async () => {
      const mockQueries = [
        { rows: [], rowCount: 0 }, // BEGIN
        { rows: [{ username: 'testuser123' }], rowCount: 1 } // username exists
      ];

      mockQueries.forEach((response) => {
        mockClient.query.mockResolvedValueOnce(response);
      });

      await expect(playerManager.createPlayer(validRequest))
        .rejects.toThrow('Username already exists');

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('getPlayerById', () => {
    const playerId = '550e8400-e29b-41d4-a716-446655440000';

    test('should retrieve a player by ID', async () => {
      const mockPlayerData = {
        id: playerId,
        username: 'testuser',
        email: 'test@example.com',
        bankroll: 1500,
        created_at: new Date(),
        updated_at: new Date(),
        is_active: true,
        email_verified: false
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockPlayerData],
        rowCount: 1
      });

      const result = await playerManager.getPlayerById(playerId);

      expect(result).toBeDefined();
      expect(result.id).toBe(playerId);
      expect(result.username).toBe('testuser');
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return null for non-existent player', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      });

      const result = await playerManager.getPlayerById('non-existent');

      expect(result).toBeNull();
    });

    test('should handle database errors', async () => {
      mockClient.query.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(playerManager.getPlayerById(playerId))
        .rejects.toThrow('Connection failed');

      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('updateBankroll', () => {
    test('should process deposit successfully', async () => {
      const request = {
        playerId: '550e8400-e29b-41d4-a716-446655440000',
        amount: 500,
        transactionType: 'deposit',
        description: 'Test deposit'
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [{
          result: {
            success: true,
            previous_balance: 1000,
            new_balance: 1500,
            transaction_id: 'tx-123'
          }
        }],
        rowCount: 1
      });

      const result = await playerManager.updateBankroll(request);

      expect(result.success).toBe(true);
      expect(result.previousBalance).toBe(1000);
      expect(result.newBalance).toBe(1500);
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle insufficient funds', async () => {
      const withdrawalRequest = {
        playerId: '550e8400-e29b-41d4-a716-446655440000',
        amount: -2000,
        transactionType: 'withdrawal',
        description: 'Large withdrawal'
      };

      mockClient.query.mockRejectedValueOnce(
        new Error('Insufficient funds. Current balance: 100, requested: 2000')
      );

      await expect(playerManager.updateBankroll(withdrawalRequest))
        .rejects.toThrow('Insufficient funds');

      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getBankrollHistory', () => {
    const playerId = '550e8400-e29b-41d4-a716-446655440000';

    test('should retrieve bankroll history', async () => {
      const mockHistory = [
        {
          id: 'tx-1',
          player_id: playerId,
          amount: 1000,
          balance_before: 0,
          balance_after: 1000,
          transaction_type: 'deposit',
          description: 'Initial deposit',
          created_at: new Date(),
          game_id: null,
          metadata: {}
        }
      ];

      mockClient.query.mockResolvedValueOnce({
        rows: mockHistory,
        rowCount: 1
      });

      const result = await playerManager.getBankrollHistory(playerId, 10);

      expect(result).toHaveLength(1);
      expect(result[0].transactionType).toBe('deposit');
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle pagination', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      });

      const result = await playerManager.getBankrollHistory(playerId, 5, 10);

      expect(result).toHaveLength(0);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2 OFFSET $3'),
        [playerId, 5, 10]
      );
    });
  });

  describe('searchPlayers', () => {
    test('should search players with filters', async () => {
      const mockPlayers = [
        {
          id: '1',
          username: 'player1',
          email: 'player1@example.com',
          bankroll: 1000,
          created_at: new Date(),
          is_active: true
        }
      ];

      // Mock count query result
      mockClient.query.mockResolvedValueOnce({
        rows: [{ total: '1' }],
        rowCount: 1
      });
      
      // Mock data query result
      mockClient.query.mockResolvedValueOnce({
        rows: mockPlayers,
        rowCount: 1
      });

      const filters = { usernamePattern: 'player' };
      const pagination = { limit: 10, page: 1 };

      const result = await playerManager.searchPlayers(filters, pagination);

      expect(result.players).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle empty results', async () => {
      // Mock count query result
      mockClient.query.mockResolvedValueOnce({
        rows: [{ total: '0' }],
        rowCount: 1
      });
      
      // Mock data query result
      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      });

      const result = await playerManager.searchPlayers({}, { limit: 10, page: 1 });

      expect(result.players).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('updatePlayer', () => {
    const playerId = '550e8400-e29b-41d4-a716-446655440000';

    test('should update player information', async () => {
      const updates = {
        username: 'newusername',
        email: 'newemail@example.com'
      };

      const updatedPlayer = {
        id: playerId,
        username: 'newusername',
        email: 'newemail@example.com',
        bankroll: 1500,
        created_at: new Date(),
        updated_at: new Date(),
        is_active: true,
        email_verified: false
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [updatedPlayer],
        rowCount: 1
      });

      const result = await playerManager.updatePlayer(playerId, updates);

      expect(result).toBeDefined();
      expect(result.username).toBe('newusername');
      expect(result.email).toBe('newemail@example.com');
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should throw error for non-existent player', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      });

      await expect(playerManager.updatePlayer('non-existent', {
        username: 'test'
      })).rejects.toThrow('Player not found');
    });
  });

  describe('Connection Management and Error Handling', () => {
    test('should handle pool connection errors', async () => {
      mockPool.connect.mockRejectedValueOnce(new Error('Pool exhausted'));

      await expect(playerManager.getPlayerById('any-id'))
        .rejects.toThrow('Pool exhausted');
    });

    test('should always release client connections', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      });

      await playerManager.getPlayerById('test-id');

      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should release client even on query error', async () => {
      mockClient.query.mockRejectedValueOnce(new Error('Query failed'));

      await expect(playerManager.getPlayerById('test-id'))
        .rejects.toThrow('Query failed');

      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle multiple concurrent operations', async () => {
      mockClient.query.mockResolvedValue({
        rows: [{ id: '123', username: 'test' }],
        rowCount: 1
      });

      // Simulate multiple concurrent requests
      const promises = [
        playerManager.getPlayerById('1'),
        playerManager.getPlayerById('2'),
        playerManager.getPlayerById('3')
      ];

      await Promise.all(promises);

      expect(mockPool.connect).toHaveBeenCalledTimes(3);
      expect(mockClient.release).toHaveBeenCalledTimes(3);
    });
  });

  describe('Transaction Management', () => {
    test('should handle complex transaction scenarios', async () => {
      const request = {
        username: 'transactionuser',
        email: 'transaction@example.com',
        password: 'TestPass123!',
        initialDeposit: 500
      };

      // Mock complex transaction sequence
      const mockQueries = [
        { rows: [], rowCount: 0 }, // BEGIN
        { rows: [], rowCount: 0 }, // username check
        { rows: [], rowCount: 0 }, // email check
        { 
          rows: [{ 
            id: '550e8400-e29b-41d4-a716-446655440000',
            username: 'transactionuser',
            email: 'transaction@example.com',
            bankroll: 0
          }], 
          rowCount: 1
        }, // INSERT player
        {
          rows: [{ 
            success: true,
            previous_balance: 0,
            new_balance: 500,
            transaction_id: 'tx-initial'
          }],
          rowCount: 1
        }, // Initial deposit
        { rows: [], rowCount: 0 } // COMMIT
      ];

      mockQueries.forEach((response) => {
        mockClient.query.mockResolvedValueOnce(response);
      });

      const result = await playerManager.createPlayer(request);

      expect(result).toBeDefined();
      expect(result.username).toBe(request.username);
      
      // Verify transaction management
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.query).not.toHaveBeenCalledWith('ROLLBACK');
    });

    test('should properly rollback failed transactions', async () => {
      const request = {
        username: 'failuser',
        email: 'fail@example.com',
        password: 'TestPass123!'
      };

      const mockQueries = [
        { rows: [], rowCount: 0 }, // BEGIN
        { rows: [], rowCount: 0 }, // username check
        { rows: [], rowCount: 0 }, // email check
      ];

      mockQueries.forEach((response) => {
        mockClient.query.mockResolvedValueOnce(response);
      });

      // Make the INSERT fail
      mockClient.query.mockRejectedValueOnce(new Error('Constraint violation'));

      await expect(playerManager.createPlayer(request))
        .rejects.toThrow('Constraint violation');

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
    });
  });
});
