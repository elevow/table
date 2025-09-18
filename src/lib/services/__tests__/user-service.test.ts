import { UserService } from '../user-service';
import { UserManager } from '../../database/user-manager';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  UserRecord,
  CreateUserRequest,
  UpdateUserRequest,
  PaginatedUsersResponse,
  UserQueryFilters,
  PaginationOptions,
  ChangePasswordRequest,
  ResetPasswordRequest,
  ConfirmPasswordResetRequest,
  AuthTokenRecord
} from '../../../types/user';

// Mock external dependencies
jest.mock('bcryptjs');
jest.mock('crypto');
jest.mock('../../database/user-manager');

describe('UserService', () => {
  let userService: UserService;
  let mockUserManager: jest.Mocked<UserManager>;
  let mockBcrypt: jest.Mocked<typeof bcrypt>;
  let mockCrypto: jest.Mocked<typeof crypto>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockUserManager = {
      createUser: jest.fn(),
      getUserById: jest.fn(),
      getUserByEmail: jest.fn(),
      getUserByUsername: jest.fn(),
      updateUser: jest.fn(),
      searchUsers: jest.fn(),
      upsertAuthToken: jest.fn(),
      findValidToken: jest.fn(),
      deleteToken: jest.fn(),
    } as any;

    mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;
    mockBcrypt.hash = jest.fn();
    mockBcrypt.compare = jest.fn();
    mockCrypto = crypto as jest.Mocked<typeof crypto>;
    
    // Mock crypto.randomBytes
    const mockRandomBytes = jest.fn();
    mockCrypto.randomBytes = mockRandomBytes;
    mockRandomBytes.mockReturnValue({
      toString: jest.fn().mockReturnValue('mockedtoken123')
    } as any);

    // Mock crypto.createHash
    const mockHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('mockedhash123')
    };
    mockCrypto.createHash = jest.fn().mockReturnValue(mockHash as any);

    userService = new UserService(mockUserManager);
  });

  describe('Constructor', () => {
    it('should create an instance with UserManager', () => {
      expect(userService).toBeInstanceOf(UserService);
    });
  });

  describe('createUser', () => {
    it('should create user with hashed password', async () => {
      const request: CreateUserRequest = {
        email: 'test@example.com',
        username: 'testuser',
        password: 'plainpassword'
      };

      const expectedUser: UserRecord = {
        id: 'user123',
        email: 'test@example.com',
        username: 'testuser',
        passwordHash: 'hashedpassword',
        createdAt: new Date(),
        isVerified: false,
        lastLogin: null
      };

      (mockBcrypt.hash as jest.Mock).mockResolvedValue('hashedpassword');
      mockUserManager.createUser.mockResolvedValue(expectedUser);

      const result = await userService.createUser(request);

      expect(mockBcrypt.hash).toHaveBeenCalledWith('plainpassword', 12);
      expect(mockUserManager.createUser).toHaveBeenCalledWith({
        email: 'test@example.com',
        username: 'testuser',
        passwordHash: 'hashedpassword'
      });
      expect(result).toEqual(expectedUser);
      expect(request.password).toBeUndefined(); // Password should be deleted
    });

    it('should create user without password', async () => {
      const request: CreateUserRequest = {
        email: 'test@example.com',
        username: 'testuser'
      };

      const expectedUser: UserRecord = {
        id: 'user123',
        email: 'test@example.com',
        username: 'testuser',
        passwordHash: null,
        createdAt: new Date(),
        isVerified: false,
        lastLogin: null
      };

      mockUserManager.createUser.mockResolvedValue(expectedUser);

      const result = await userService.createUser(request);

      expect(mockBcrypt.hash).not.toHaveBeenCalled();
      expect(mockUserManager.createUser).toHaveBeenCalledWith(request);
      expect(result).toEqual(expectedUser);
    });
  });

  describe('getUserById', () => {
    it('should get user by id', async () => {
      const userId = 'user123';
      const expectedUser: UserRecord = {
        id: userId,
        email: 'test@example.com',
        username: 'testuser',
        passwordHash: 'hashedpassword',
        createdAt: new Date(),
        isVerified: true,
        lastLogin: new Date()
      };

      mockUserManager.getUserById.mockResolvedValue(expectedUser);

      const result = await userService.getUserById(userId);

      expect(mockUserManager.getUserById).toHaveBeenCalledWith(userId, undefined);
      expect(result).toEqual(expectedUser);
    });

    it('should get user by id with caller', async () => {
      const userId = 'user123';
      const callerId = 'caller456';

      mockUserManager.getUserById.mockResolvedValue(null);

      const result = await userService.getUserById(userId, callerId);

      expect(mockUserManager.getUserById).toHaveBeenCalledWith(userId, callerId);
      expect(result).toBeNull();
    });
  });

  describe('getUserByEmail', () => {
    it('should get user by email', async () => {
      const email = 'test@example.com';
      const expectedUser: UserRecord = {
        id: 'user123',
        email: email,
        username: 'testuser',
        passwordHash: 'hashedpassword',
        createdAt: new Date(),
        isVerified: true,
        lastLogin: new Date()
      };

      mockUserManager.getUserByEmail.mockResolvedValue(expectedUser);

      const result = await userService.getUserByEmail(email);

      expect(mockUserManager.getUserByEmail).toHaveBeenCalledWith(email);
      expect(result).toEqual(expectedUser);
    });
  });

  describe('getUserByUsername', () => {
    it('should get user by username', async () => {
      const username = 'testuser';
      const expectedUser: UserRecord = {
        id: 'user123',
        email: 'test@example.com',
        username: username,
        passwordHash: 'hashedpassword',
        createdAt: new Date(),
        isVerified: true,
        lastLogin: new Date()
      };

      mockUserManager.getUserByUsername.mockResolvedValue(expectedUser);

      const result = await userService.getUserByUsername(username);

      expect(mockUserManager.getUserByUsername).toHaveBeenCalledWith(username);
      expect(result).toEqual(expectedUser);
    });
  });

  describe('updateUser', () => {
    it('should update user', async () => {
      const userId = 'user123';
      const updates: UpdateUserRequest = {
        username: 'newusername',
        isVerified: true
      };

      const updatedUser: UserRecord = {
        id: userId,
        email: 'test@example.com',
        username: 'newusername',
        passwordHash: 'hashedpassword',
        createdAt: new Date(),
        isVerified: true,
        lastLogin: new Date()
      };

      mockUserManager.updateUser.mockResolvedValue(updatedUser);

      const result = await userService.updateUser(userId, updates);

      expect(mockUserManager.updateUser).toHaveBeenCalledWith(userId, updates, undefined);
      expect(result).toEqual(updatedUser);
    });
  });

  describe('searchUsers', () => {
    it('should search users with filters and pagination', async () => {
      const filters: UserQueryFilters = {
        email: 'test@example.com',
        username: 'testuser'
      };
      const pagination: PaginationOptions = {
        page: 1,
        limit: 10
      };

      const expectedResponse: PaginatedUsersResponse = {
        users: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0
      };

      mockUserManager.searchUsers.mockResolvedValue(expectedResponse);

      const result = await userService.searchUsers(filters, pagination);

      expect(mockUserManager.searchUsers).toHaveBeenCalledWith(filters, pagination);
      expect(result).toEqual(expectedResponse);
    });
  });

  describe('hashPassword', () => {
    it('should hash password with bcrypt', async () => {
      const password = 'testpassword';
      const hashedPassword = 'hashedpassword';

      (mockBcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);

      const result = await userService.hashPassword(password);

      expect(mockBcrypt.hash).toHaveBeenCalledWith(password, 12);
      expect(result).toBe(hashedPassword);
    });
  });

  describe('verifyPassword', () => {
    it('should verify password with bcrypt', async () => {
      const password = 'testpassword';
      const hash = 'hashedpassword';

      (mockBcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await userService.verifyPassword(password, hash);

      expect(mockBcrypt.compare).toHaveBeenCalledWith(password, hash);
      expect(result).toBe(true);
    });

    it('should return false for invalid password', async () => {
      const password = 'wrongpassword';
      const hash = 'hashedpassword';

      (mockBcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await userService.verifyPassword(password, hash);

      expect(result).toBe(false);
    });
  });

  describe('changePassword', () => {
    const existingUser: UserRecord = {
      id: 'user123',
      email: 'test@example.com',
      username: 'testuser',
      passwordHash: 'oldhashedpassword',
      createdAt: new Date(),
      isVerified: true,
      lastLogin: new Date()
    };

    it('should change password successfully', async () => {
      const request: ChangePasswordRequest = {
        userId: 'user123',
        currentPassword: 'oldpassword',
        newPassword: 'newpassword'
      };

      mockUserManager.getUserById.mockResolvedValue(existingUser);
      (mockBcrypt.compare as jest.Mock).mockResolvedValue(true);
      (mockBcrypt.hash as jest.Mock).mockResolvedValue('newhashedpassword');
      mockUserManager.updateUser.mockResolvedValue({
        ...existingUser,
        passwordHash: 'newhashedpassword'
      });

      const result = await userService.changePassword(request);

      expect(mockUserManager.getUserById).toHaveBeenCalledWith('user123', undefined);
      expect(mockBcrypt.compare).toHaveBeenCalledWith('oldpassword', 'oldhashedpassword');
      expect(mockBcrypt.hash).toHaveBeenCalledWith('newpassword', 12);
      expect(mockUserManager.updateUser).toHaveBeenCalledWith('user123', {
        passwordHash: 'newhashedpassword'
      }, undefined);
      expect(result).toBe(true);
    });

    it('should throw error when user not found', async () => {
      const request: ChangePasswordRequest = {
        userId: 'user123',
        currentPassword: 'oldpassword',
        newPassword: 'newpassword'
      };

      mockUserManager.getUserById.mockResolvedValue(null);

      await expect(userService.changePassword(request))
        .rejects.toThrow('User not found or no password set');
    });

    it('should throw error when user has no password', async () => {
      const userWithoutPassword = { ...existingUser, passwordHash: null };
      const request: ChangePasswordRequest = {
        userId: 'user123',
        currentPassword: 'oldpassword',
        newPassword: 'newpassword'
      };

      mockUserManager.getUserById.mockResolvedValue(userWithoutPassword);

      await expect(userService.changePassword(request))
        .rejects.toThrow('User not found or no password set');
    });

    it('should throw error when current password is incorrect', async () => {
      const request: ChangePasswordRequest = {
        userId: 'user123',
        currentPassword: 'wrongpassword',
        newPassword: 'newpassword'
      };

      mockUserManager.getUserById.mockResolvedValue(existingUser);
      (mockBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(userService.changePassword(request))
        .rejects.toThrow('Current password is incorrect');
    });
  });

  describe('resetPassword', () => {
    it('should return null when user not found', async () => {
      const request: ResetPasswordRequest = {
        email: 'nonexistent@example.com'
      };

      mockUserManager.getUserByEmail.mockResolvedValue(null);

      const result = await userService.resetPassword(request);

      expect(result).toBeNull();
    });

    it('should create password reset token when user exists', async () => {
      const request: ResetPasswordRequest = {
        email: 'test@example.com'
      };

      const user: UserRecord = {
        id: 'user123',
        email: 'test@example.com',
        username: 'testuser',
        passwordHash: 'hashedpassword',
        createdAt: new Date(),
        isVerified: true,
        lastLogin: new Date()
      };

      mockUserManager.getUserByEmail.mockResolvedValue(user);
      mockUserManager.upsertAuthToken.mockResolvedValue({
        id: 'token123',
        userId: 'user123',
        tokenHash: 'mockedhash123',
        expiresAt: new Date(),
        type: 'password_reset'
      });

      const result = await userService.resetPassword(request);

      expect(mockUserManager.getUserByEmail).toHaveBeenCalledWith('test@example.com');
      expect(mockCrypto.randomBytes).toHaveBeenCalledWith(32);
      expect(mockUserManager.upsertAuthToken).toHaveBeenCalledWith(
        'user123',
        'mockedhash123',
        expect.any(Date),
        'password_reset'
      );
      expect(result).toEqual({
        token: 'mockedtoken123',
        expiresAt: expect.any(Date)
      });
    });
  });

  describe('confirmPasswordReset', () => {
    it('should confirm password reset', async () => {
      const request: ConfirmPasswordResetRequest = {
        token: 'resettoken123',
        newPassword: 'newpassword'
      };

      (mockBcrypt.hash as jest.Mock).mockResolvedValue('newhashedpassword');

      const result = await userService.confirmPasswordReset(request);

      expect(mockBcrypt.hash).toHaveBeenCalledWith('newpassword', 12);
      expect(result).toBe(true);
    });
  });

  describe('createPasswordReset', () => {
    it('should create password reset token with default TTL', async () => {
      const userId = 'user123';

      mockUserManager.upsertAuthToken.mockResolvedValue({
        id: 'token123',
        userId: userId,
        tokenHash: 'mockedhash123',
        expiresAt: new Date(),
        type: 'password_reset'
      });

      const result = await userService.createPasswordReset(userId);

      expect(mockCrypto.randomBytes).toHaveBeenCalledWith(32);
      expect(mockUserManager.upsertAuthToken).toHaveBeenCalledWith(
        userId,
        'mockedhash123',
        expect.any(Date),
        'password_reset'
      );
      expect(result).toEqual({
        token: 'mockedtoken123',
        expiresAt: expect.any(Date)
      });
    });

    it('should create password reset token with custom TTL', async () => {
      const userId = 'user123';
      const ttlMinutes = 30;

      mockUserManager.upsertAuthToken.mockResolvedValue({
        id: 'token123',
        userId: userId,
        tokenHash: 'mockedhash123',
        expiresAt: new Date(),
        type: 'password_reset'
      });

      const result = await userService.createPasswordReset(userId, ttlMinutes);

      expect(result.token).toBe('mockedtoken123');
      expect(result.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('verifyPasswordReset', () => {
    it('should verify valid password reset token', async () => {
      const userId = 'user123';
      const token = 'resettoken123';

      mockUserManager.findValidToken.mockResolvedValue({
        id: 'token123',
        userId: userId,
        tokenHash: 'mockedhash123',
        type: 'password_reset',
        expiresAt: new Date()
      });

      const result = await userService.verifyPasswordReset(userId, token);

      expect(mockCrypto.createHash).toHaveBeenCalledWith('sha256');
      expect(mockUserManager.findValidToken).toHaveBeenCalledWith(
        userId,
        'mockedhash123',
        'password_reset'
      );
      expect(result).toBe(true);
    });

    it('should return false for invalid token', async () => {
      const userId = 'user123';
      const token = 'invalidtoken';

      mockUserManager.findValidToken.mockResolvedValue(null);

      const result = await userService.verifyPasswordReset(userId, token);

      expect(result).toBe(false);
    });
  });

  describe('consumePasswordReset', () => {
    it('should consume valid password reset token', async () => {
      const userId = 'user123';
      const token = 'resettoken123';
      const tokenRecord: AuthTokenRecord = {
        id: 'token123',
        userId: userId,
        tokenHash: 'mockedhash123',
        type: 'password_reset' as const,
        expiresAt: new Date()
      };

      mockUserManager.findValidToken.mockResolvedValue(tokenRecord);
      mockUserManager.deleteToken.mockResolvedValue();

      const result = await userService.consumePasswordReset(userId, token);

      expect(mockUserManager.findValidToken).toHaveBeenCalledWith(
        userId,
        'mockedhash123',
        'password_reset'
      );
      expect(mockUserManager.deleteToken).toHaveBeenCalledWith('token123');
      expect(result).toBe(true);
    });

    it('should return false for invalid token', async () => {
      const userId = 'user123';
      const token = 'invalidtoken';

      mockUserManager.findValidToken.mockResolvedValue(null);

      const result = await userService.consumePasswordReset(userId, token);

      expect(result).toBe(false);
      expect(mockUserManager.deleteToken).not.toHaveBeenCalled();
    });
  });
});