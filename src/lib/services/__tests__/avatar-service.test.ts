import { AvatarService } from '../avatar-service';
import { AvatarManager } from '../../database/avatar-manager';
import { Pool } from 'pg';
import {
  AvatarRecord,
  AvatarVersionRecord,
  CreateAvatarRequest,
  PaginatedAvatarsResponse
} from '../../../types/avatar';

// Mock the avatar manager
jest.mock('../../database/avatar-manager');

describe('AvatarService', () => {
  let avatarService: AvatarService;
  let mockPool: jest.Mocked<Pool>;
  let mockAvatarManager: jest.Mocked<AvatarManager>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
    } as any;

    mockAvatarManager = {
      createAvatar: jest.fn(),
      updateAvatar: jest.fn(),
      addAvatarVersion: jest.fn(),
      listVersions: jest.fn(),
      getLatestAvatarForUser: jest.fn(),
      searchAvatars: jest.fn(),
    } as any;

    (AvatarManager as jest.MockedClass<typeof AvatarManager>).mockImplementation(() => mockAvatarManager);
    
    avatarService = new AvatarService(mockPool);
  });

  describe('Constructor', () => {
    it('should create an instance with AvatarManager', () => {
      expect(avatarService).toBeInstanceOf(AvatarService);
      expect(AvatarManager).toHaveBeenCalledWith(mockPool);
    });
  });

  describe('uploadAvatar', () => {
    it('should create a new avatar with pending status', async () => {
      const createRequest: CreateAvatarRequest = {
        userId: 'user123',
        originalUrl: 'https://example.com/avatar.jpg',
        variants: { 'small': 'https://example.com/avatar-small.jpg', 'medium': 'https://example.com/avatar-medium.jpg' }
      };

      const expectedAvatar: AvatarRecord = {
        id: 'avatar123',
        userId: 'user123',
        originalUrl: 'https://example.com/avatar.jpg',
        variants: { 'small': 'https://example.com/avatar-small.jpg', 'medium': 'https://example.com/avatar-medium.jpg' },
        status: 'pending',
        version: 1,
        createdAt: new Date(),
        moderatorId: null,
        moderatedAt: null
      };

      mockAvatarManager.createAvatar.mockResolvedValue(expectedAvatar);

      const result = await avatarService.uploadAvatar(createRequest);

      expect(mockAvatarManager.createAvatar).toHaveBeenCalledWith(createRequest);
      expect(result).toEqual(expectedAvatar);
    });
  });

  describe('approveAvatar', () => {
    it('should approve an avatar with moderator info', async () => {
      const avatarId = 'avatar123';
      const moderatorId = 'mod123';
      const mockDate = new Date();
      
      const approvedAvatar: AvatarRecord = {
        id: avatarId,
        userId: 'user123',
        originalUrl: 'https://example.com/avatar.jpg',
        variants: { 'small': 'https://example.com/avatar-small.jpg' },
        status: 'approved',
        version: 1,
        createdAt: new Date(),
        moderatorId: moderatorId,
        moderatedAt: mockDate
      };

      mockAvatarManager.updateAvatar.mockResolvedValue(approvedAvatar);

      const result = await avatarService.approveAvatar(avatarId, moderatorId);

      expect(mockAvatarManager.updateAvatar).toHaveBeenCalledWith(avatarId, {
        status: 'approved',
        moderatorId,
        moderatedAt: expect.any(Date)
      });
      expect(result).toEqual(approvedAvatar);
    });
  });

  describe('rejectAvatar', () => {
    it('should reject an avatar with moderator info', async () => {
      const avatarId = 'avatar123';
      const moderatorId = 'mod123';
      const mockDate = new Date();
      
      const rejectedAvatar: AvatarRecord = {
        id: avatarId,
        userId: 'user123',
        originalUrl: 'https://example.com/avatar.jpg',
        variants: { 'small': 'https://example.com/avatar-small.jpg' },
        status: 'rejected',
        version: 1,
        createdAt: new Date(),
        moderatorId: moderatorId,
        moderatedAt: mockDate
      };

      mockAvatarManager.updateAvatar.mockResolvedValue(rejectedAvatar);

      const result = await avatarService.rejectAvatar(avatarId, moderatorId);

      expect(mockAvatarManager.updateAvatar).toHaveBeenCalledWith(avatarId, {
        status: 'rejected',
        moderatorId,
        moderatedAt: expect.any(Date)
      });
      expect(result).toEqual(rejectedAvatar);
    });
  });

  describe('addVersion', () => {
    it('should add a new avatar version', async () => {
      const avatarId = 'avatar123';
      const url = 'https://example.com/avatar-v2.jpg';
      
      const expectedVersion: AvatarVersionRecord = {
        id: 'version123',
        avatarId: avatarId,
        url: url,
        version: 2,
        createdAt: new Date()
      };

      mockAvatarManager.addAvatarVersion.mockResolvedValue(expectedVersion);

      const result = await avatarService.addVersion(avatarId, url);

      expect(mockAvatarManager.addAvatarVersion).toHaveBeenCalledWith(avatarId, url);
      expect(result).toEqual(expectedVersion);
    });
  });

  describe('listVersions', () => {
    it('should list all versions for an avatar', async () => {
      const avatarId = 'avatar123';
      
      const expectedVersions: AvatarVersionRecord[] = [
        {
          id: 'version1',
          avatarId: avatarId,
          url: 'https://example.com/avatar-v1.jpg',
          version: 1,
          createdAt: new Date('2023-01-01')
        },
        {
          id: 'version2',
          avatarId: avatarId,
          url: 'https://example.com/avatar-v2.jpg',
          version: 2,
          createdAt: new Date('2023-01-02')
        }
      ];

      mockAvatarManager.listVersions.mockResolvedValue(expectedVersions);

      const result = await avatarService.listVersions(avatarId);

      expect(mockAvatarManager.listVersions).toHaveBeenCalledWith(avatarId);
      expect(result).toEqual(expectedVersions);
    });
  });

  describe('getLatestForUser', () => {
    it('should return latest avatar for user', async () => {
      const userId = 'user123';
      
      const expectedAvatar: AvatarRecord = {
        id: 'avatar123',
        userId: userId,
        originalUrl: 'https://example.com/avatar.jpg',
        variants: { 'small': 'https://example.com/avatar-small.jpg' },
        status: 'approved',
        version: 1,
        createdAt: new Date(),
        moderatorId: 'mod123',
        moderatedAt: new Date()
      };

      mockAvatarManager.getLatestAvatarForUser.mockResolvedValue(expectedAvatar);

      const result = await avatarService.getLatestForUser(userId);

      expect(mockAvatarManager.getLatestAvatarForUser).toHaveBeenCalledWith(userId);
      expect(result).toEqual(expectedAvatar);
    });

    it('should return null when no avatar found', async () => {
      const userId = 'user123';
      
      mockAvatarManager.getLatestAvatarForUser.mockResolvedValue(null);

      const result = await avatarService.getLatestForUser(userId);

      expect(mockAvatarManager.getLatestAvatarForUser).toHaveBeenCalledWith(userId);
      expect(result).toBeNull();
    });
  });

  describe('search', () => {
    it('should search avatars with all parameters', async () => {
      const userId = 'user123';
      const status = 'approved';
      const page = 1;
      const limit = 10;
      
      const expectedResponse: PaginatedAvatarsResponse = {
        avatars: [
          {
            id: 'avatar123',
            userId: userId,
            originalUrl: 'https://example.com/avatar.jpg',
            variants: { 'small': 'https://example.com/avatar-small.jpg' },
            status: 'approved',
            version: 1,
            createdAt: new Date(),
            moderatorId: 'mod123',
            moderatedAt: new Date()
          }
        ],
        total: 1,
        page: page,
        limit: limit,
        totalPages: 1
      };

      mockAvatarManager.searchAvatars.mockResolvedValue(expectedResponse);

      const result = await avatarService.search(userId, status, page, limit);

      expect(mockAvatarManager.searchAvatars).toHaveBeenCalledWith(
        { userId, status },
        page,
        limit
      );
      expect(result).toEqual(expectedResponse);
    });

    it('should search avatars with undefined parameters', async () => {
      const page = 1;
      const limit = 10;
      
      const expectedResponse: PaginatedAvatarsResponse = {
        avatars: [],
        total: 0,
        page: page,
        limit: limit,
        totalPages: 0
      };

      mockAvatarManager.searchAvatars.mockResolvedValue(expectedResponse);

      const result = await avatarService.search(undefined, undefined, page, limit);

      expect(mockAvatarManager.searchAvatars).toHaveBeenCalledWith(
        { userId: undefined, status: undefined },
        page,
        limit
      );
      expect(result).toEqual(expectedResponse);
    });
  });
});