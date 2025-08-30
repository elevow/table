// US-009: Player Profile Storage - PlayerProfileManager Integration Tests

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { PlayerProfileManager } from '../player-profile-manager';
import {
  Player,
  CreatePlayerRequest,
  UpdatePlayerRequest,
  BankrollUpdateRequest,
  TransactionType,
  PlayerProfileError
} from '../../../types/player-profile';

// Mock external dependencies
const mockPool = {
  connect: jest.fn(),
};

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

const mockBcrypt = {
  hash: jest.fn(),
} as any;

const mockUuidv4 = jest.fn();

// Mock the modules
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPool),
}));

jest.mock('bcryptjs', () => ({
  default: {
    hash: jest.fn(),
  },
  hash: jest.fn(),
}));

jest.mock('uuid', () => {
  return { v4: (...args: any[]) => mockUuidv4(...args) };
});

describe('PlayerProfileManager', () => {
  let manager: PlayerProfileManager;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock implementations with any types
    (mockPool.connect as any).mockResolvedValue(mockClient);
    
    // Mock bcrypt
    const bcrypt = require('bcryptjs');
    jest.mocked(bcrypt.hash).mockResolvedValue('hashed_password');
    jest.mocked(bcrypt.default.hash).mockResolvedValue('hashed_password');
    
    (mockUuidv4 as any).mockReturnValue('test-uuid-123');

    // Create manager instance
    manager = new PlayerProfileManager(mockPool as any);
  });

  describe('Constructor', () => {
    test('should create manager instance with pool', () => {
      expect(manager).toBeInstanceOf(PlayerProfileManager);
    });
  });

  describe('createPlayer', () => {
    const validCreateRequest: CreatePlayerRequest = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
      avatarUrl: 'https://example.com/avatar.jpg',
      initialDeposit: 100
    };

    test.skip('should create a new player successfully', async () => {
      // Mock successful database operations
      (mockClient.query as any).mockImplementation((query: string) => {
        if (query.includes('BEGIN')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (query.includes('INSERT INTO players')) {
          return Promise.resolve({
            rows: [{
              id: 'test-uuid-123',
              username: 'testuser',
              email: 'test@example.com',
              password_hash: 'hashed_password',
              avatar_url: 'https://example.com/avatar.jpg',
              bankroll: 100,
              is_active: true,
              email_verified: false,
              verification_token: 'test-uuid-123',
              created_at: new Date(),
              updated_at: new Date(),
              last_login: null,
              reset_token: null,
              reset_token_expires: null,
              stats: {}
            }],
            rowCount: 1
          });
        }
        if (query.includes('INSERT INTO bankroll_history')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (query.includes('INSERT INTO player_preferences')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (query.includes('COMMIT')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const result = await manager.createPlayer(validCreateRequest);

      const bcrypt = require('bcryptjs');
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(result.id).toBe('test-uuid-123');
      expect(result.username).toBe('testuser');
      expect(result.email).toBe('test@example.com');
      expect(result.bankroll).toBe(100);
    });

    test('should handle database errors during creation', async () => {
      (mockClient.query as any).mockImplementation((query: string) => {
        if (query.includes('BEGIN')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (query.includes('INSERT INTO players')) {
          throw new Error('Database constraint violation');
        }
        if (query.includes('ROLLBACK')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      await expect(manager.createPlayer(validCreateRequest)).rejects.toThrow();
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    test('should handle validation errors', async () => {
      const invalidRequest = {
        username: '', // Invalid: empty username
        email: 'test@example.com',
        password: 'password123'
      };

      await expect(manager.createPlayer(invalidRequest)).rejects.toThrow();
    });
  });

  describe('getPlayerById', () => {
    test('should retrieve player by ID successfully', async () => {
      const mockPlayerRow = {
        id: 'player-123',
        username: 'testuser',
        email: 'test@example.com',
        password_hash: 'hashed_password',
        avatar_url: 'https://example.com/avatar.jpg',
        bankroll: 150,
        is_active: true,
        email_verified: true,
        verification_token: null,
        created_at: new Date(),
        updated_at: new Date(),
        last_login: new Date(),
        reset_token: null,
        reset_token_expires: null,
        stats: { totalHands: 100 }
      };

      (mockClient.query as any).mockResolvedValue({
        rows: [mockPlayerRow],
        rowCount: 1
      });

      const result = await manager.getPlayerById('player-123');

      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT * FROM players WHERE id = $1 AND is_active = true',
        ['player-123']
      );
      expect(result?.id).toBe('player-123');
      expect(result?.username).toBe('testuser');
      expect(result?.email).toBe('test@example.com');
      expect(result?.bankroll).toBe(150);
    });

    test('should return null when player not found', async () => {
      (mockClient.query as any).mockResolvedValue({
        rows: [],
        rowCount: 0
      });

      const result = await manager.getPlayerById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getPlayerByUsername', () => {
    test('should retrieve player by username successfully', async () => {
      const mockPlayerRow = {
        id: 'player-123',
        username: 'testuser',
        email: 'test@example.com',
        password_hash: 'hashed_password',
        avatar_url: null,
        bankroll: 150,
        is_active: true,
        email_verified: true,
        verification_token: null,
        created_at: new Date(),
        updated_at: new Date(),
        last_login: null,
        reset_token: null,
        reset_token_expires: null,
        stats: {}
      };

      (mockClient.query as any).mockResolvedValue({
        rows: [mockPlayerRow],
        rowCount: 1
      });

      const result = await manager.getPlayerByUsername('testuser');

      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT * FROM players WHERE username = $1 AND is_active = true',
        ['testuser']
      );
      expect(result?.username).toBe('testuser');
    });

    test('should return null when username not found', async () => {
      (mockClient.query as any).mockResolvedValue({
        rows: [],
        rowCount: 0
      });

      const result = await manager.getPlayerByUsername('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getPlayerByEmail', () => {
    test('should retrieve player by email successfully', async () => {
      const mockPlayerRow = {
        id: 'player-123',
        username: 'testuser',
        email: 'test@example.com',
        password_hash: 'hashed_password',
        avatar_url: null,
        bankroll: 150,
        is_active: true,
        email_verified: true,
        verification_token: null,
        created_at: new Date(),
        updated_at: new Date(),
        last_login: null,
        reset_token: null,
        reset_token_expires: null,
        stats: {}
      };

      (mockClient.query as any).mockResolvedValue({
        rows: [mockPlayerRow],
        rowCount: 1
      });

      const result = await manager.getPlayerByEmail('test@example.com');

      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT * FROM players WHERE email = $1 AND is_active = true',
        ['test@example.com']
      );
      expect(result?.email).toBe('test@example.com');
    });

    test('should return null when email not found', async () => {
      (mockClient.query as any).mockResolvedValue({
        rows: [],
        rowCount: 0
      });

      const result = await manager.getPlayerByEmail('nonexistent@example.com');
      expect(result).toBeNull();
    });
  });

  describe('updatePlayer', () => {
    test('should update player successfully', async () => {
      const updates: UpdatePlayerRequest = {
        username: 'newusername',
        email: 'newemail@example.com',
        avatarUrl: 'https://example.com/newavatar.jpg'
      };

      const mockUpdatedPlayer = {
        id: 'player-123',
        username: 'newusername',
        email: 'newemail@example.com',
        password_hash: 'hashed_password',
        avatar_url: 'https://example.com/newavatar.jpg',
        bankroll: 150,
        is_active: true,
        email_verified: true,
        verification_token: null,
        created_at: new Date(),
        updated_at: new Date(),
        last_login: null,
        reset_token: null,
        reset_token_expires: null,
        stats: {}
      };

      (mockClient.query as any).mockResolvedValue({
        rows: [mockUpdatedPlayer],
        rowCount: 1
      });

      const result = await manager.updatePlayer('player-123', updates);

      expect(result.username).toBe('newusername');
      expect(result.email).toBe('newemail@example.com');
    });

    test('should throw error when player not found', async () => {
      (mockClient.query as any).mockResolvedValue({
        rows: [],
        rowCount: 0
      });

      await expect(manager.updatePlayer('nonexistent', { username: 'new' })).rejects.toThrow();
    });
  });

  describe('deletePlayer', () => {
    test('should soft delete player successfully', async () => {
      (mockClient.query as any).mockResolvedValue({
        rows: [],
        rowCount: 1
      });

      const result = await manager.deletePlayer('player-123');

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE players'),
        ['player-123']
      );
      expect(result).toBe(true);
    });

    test('should return false when player not found', async () => {
      (mockClient.query as any).mockResolvedValue({
        rows: [],
        rowCount: 0
      });

      const result = await manager.deletePlayer('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('updateBankroll', () => {
    test('should process deposit successfully', async () => {
      const request: BankrollUpdateRequest = {
        playerId: 'player-123',
        amount: 100,
        transactionType: TransactionType.DEPOSIT,
        description: 'Test deposit'
      };

      (mockClient.query as any).mockResolvedValue({
        rows: [{
          result: {
            success: true,
            previous_balance: 150,
            new_balance: 250,
            transaction_id: 'tx-123'
          }
        }],
        rowCount: 1
      });

      const result = await manager.updateBankroll(request);

      expect(result).toEqual({
        success: true,
        previousBalance: 150,
        newBalance: 250,
        transactionId: 'tx-123'
      });
    });

    test('should handle bankroll update failure', async () => {
      const request: BankrollUpdateRequest = {
        playerId: 'player-123',
        amount: -1000,
        transactionType: TransactionType.WITHDRAWAL,
        description: 'Invalid withdrawal'
      };

      (mockClient.query as any).mockResolvedValue({
        rows: [{
          result: {
            success: false,
            error: 'Insufficient funds'
          }
        }],
        rowCount: 1
      });

      await expect(manager.updateBankroll(request)).rejects.toThrow();
    });
  });

  describe('getBankrollHistory', () => {
    test('should retrieve bankroll history', async () => {
      const mockTransactions = [
        {
          id: 'tx-1',
          player_id: 'player-123',
          amount: 100,
          balance_before: 50,
          balance_after: 150,
          transaction_type: 'DEPOSIT',
          description: 'Test deposit',
          game_id: null,
          created_at: new Date(),
          metadata: {}
        }
      ];

      (mockClient.query as any).mockResolvedValue({
        rows: mockTransactions,
        rowCount: 1
      });

      const result = await manager.getBankrollHistory('player-123', 50, 0);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM bankroll_history'),
        ['player-123', 50, 0]
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'tx-1',
        playerId: 'player-123',
        amount: 100,
        balanceBefore: 50,
        balanceAfter: 150,
        transactionType: 'DEPOSIT',
        description: 'Test deposit',
        gameId: null,
        createdAt: expect.any(Date),
        metadata: {}
      });
    });
  });

  describe('Error handling', () => {
    test('should always release client connection', async () => {
      (mockClient.query as any).mockRejectedValue(new Error('Database error'));

      try {
        await manager.getPlayerById('player-123');
      } catch (error) {
        // Expected to throw
      }

      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle pool connection errors', async () => {
      (mockPool.connect as any).mockRejectedValue(new Error('Connection failed'));

      await expect(manager.getPlayerById('player-123')).rejects.toThrow('Connection failed');
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});
