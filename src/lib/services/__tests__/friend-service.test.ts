import { FriendService } from '../friend-service';
import { FriendManager } from '../../database/friend-manager';
import { Pool } from 'pg';
import {
  FriendRelationshipRecord,
  BlockRecord,
  FriendInviteRecord,
  FriendRelationshipStatus,
  HeadToHeadSummary,
  Paginated
} from '../../../types/friend';

// Mock FriendManager
jest.mock('../../database/friend-manager');

describe('FriendService', () => {
  let friendService: FriendService;
  let mockFriendManager: jest.Mocked<FriendManager>;
  let mockPool: jest.Mocked<Pool>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPool = {} as jest.Mocked<Pool>;

    mockFriendManager = {
      sendRequest: jest.fn(),
      respondToRequest: jest.fn(),
      listFriends: jest.fn(),
      listPending: jest.fn(),
      unfriend: jest.fn(),
      block: jest.fn(),
      unblock: jest.fn(),
      getRelationshipStatus: jest.fn(),
      createGameInvite: jest.fn(),
      respondToGameInvite: jest.fn(),
      listInvites: jest.fn(),
      getHeadToHeadSummary: jest.fn(),
    } as any;

    (FriendManager as jest.MockedClass<typeof FriendManager>).mockImplementation(() => mockFriendManager);
    
    friendService = new FriendService(mockPool);
  });

  describe('Constructor', () => {
    it('should create an instance with Pool', () => {
      expect(friendService).toBeInstanceOf(FriendService);
      expect(FriendManager).toHaveBeenCalledWith(mockPool);
    });
  });

  describe('sendRequest', () => {
    const mockRelationship: FriendRelationshipRecord = {
      id: 'rel123',
      userId: 'user1',
      friendId: 'user2',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    it('should send friend request successfully', async () => {
      mockFriendManager.sendRequest.mockResolvedValue(mockRelationship);

      const result = await friendService.sendRequest('user1', 'user2');

      expect(mockFriendManager.sendRequest).toHaveBeenCalledWith({
        requesterId: 'user1',
        recipientId: 'user2'
      });
      expect(result).toEqual(mockRelationship);
    });

    it('should throw error for empty requesterId', async () => {
      await expect(friendService.sendRequest('', 'user2'))
        .rejects.toThrow('Missing or invalid requesterId');
    });

    it('should throw error for missing requesterId', async () => {
      await expect(friendService.sendRequest(undefined as any, 'user2'))
        .rejects.toThrow('Missing or invalid requesterId');
    });

    it('should throw error for empty recipientId', async () => {
      await expect(friendService.sendRequest('user1', ''))
        .rejects.toThrow('Missing or invalid recipientId');
    });

    it('should throw error for whitespace requesterId', async () => {
      await expect(friendService.sendRequest('   ', 'user2'))
        .rejects.toThrow('Missing or invalid requesterId');
    });
  });

  describe('respondToRequest', () => {
    const mockRelationship: FriendRelationshipRecord = {
      id: 'rel123',
      userId: 'user1',
      friendId: 'user2',
      status: 'accepted',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    it('should accept friend request', async () => {
      mockFriendManager.respondToRequest.mockResolvedValue(mockRelationship);

      const result = await friendService.respondToRequest('rel123', 'accept');

      expect(mockFriendManager.respondToRequest).toHaveBeenCalledWith('rel123', true);
      expect(result).toEqual(mockRelationship);
    });

    it('should decline friend request', async () => {
      const declinedRelationship = { ...mockRelationship, status: 'declined' as const };
      mockFriendManager.respondToRequest.mockResolvedValue(declinedRelationship);

      const result = await friendService.respondToRequest('rel123', 'decline');

      expect(mockFriendManager.respondToRequest).toHaveBeenCalledWith('rel123', false);
      expect(result).toEqual(declinedRelationship);
    });

    it('should throw error for empty id', async () => {
      await expect(friendService.respondToRequest('', 'accept'))
        .rejects.toThrow('Missing or invalid id');
    });
  });

  describe('listFriends', () => {
    const mockResponse: Paginated<FriendRelationshipRecord> = {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0
    };

    it('should list friends with default pagination', async () => {
      mockFriendManager.listFriends.mockResolvedValue(mockResponse);

      const result = await friendService.listFriends('user1');

      expect(mockFriendManager.listFriends).toHaveBeenCalledWith('user1', 1, 20);
      expect(result).toEqual(mockResponse);
    });

    it('should list friends with custom pagination', async () => {
      mockFriendManager.listFriends.mockResolvedValue(mockResponse);

      const result = await friendService.listFriends('user1', 2, 10);

      expect(mockFriendManager.listFriends).toHaveBeenCalledWith('user1', 2, 10);
      expect(result).toEqual(mockResponse);
    });

    it('should normalize invalid page to 1', async () => {
      mockFriendManager.listFriends.mockResolvedValue(mockResponse);

      await friendService.listFriends('user1', -1, 10);

      expect(mockFriendManager.listFriends).toHaveBeenCalledWith('user1', 1, 10);
    });

    it('should normalize invalid limit to 20', async () => {
      mockFriendManager.listFriends.mockResolvedValue(mockResponse);

      await friendService.listFriends('user1', 1, -1);

      expect(mockFriendManager.listFriends).toHaveBeenCalledWith('user1', 1, 20);
    });

    it('should cap limit at 100', async () => {
      mockFriendManager.listFriends.mockResolvedValue(mockResponse);

      await friendService.listFriends('user1', 1, 150);

      expect(mockFriendManager.listFriends).toHaveBeenCalledWith('user1', 1, 20);
    });
  });

  describe('listPending', () => {
    const mockResponse: Paginated<FriendRelationshipRecord> = {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0
    };

    it('should list pending requests', async () => {
      mockFriendManager.listPending.mockResolvedValue(mockResponse);

      const result = await friendService.listPending('user1');

      expect(mockFriendManager.listPending).toHaveBeenCalledWith('user1', 1, 20);
      expect(result).toEqual(mockResponse);
    });

    it('should throw error for invalid userId', async () => {
      await expect(friendService.listPending(''))
        .rejects.toThrow('Missing or invalid userId');
    });
  });

  describe('unfriend', () => {
    it('should unfriend users', async () => {
      mockFriendManager.unfriend.mockResolvedValue();

      await friendService.unfriend('user1', 'user2');

      expect(mockFriendManager.unfriend).toHaveBeenCalledWith('user1', 'user2');
    });

    it('should throw error for invalid first user id', async () => {
      await expect(friendService.unfriend('', 'user2'))
        .rejects.toThrow('Missing or invalid a');
    });

    it('should throw error for invalid second user id', async () => {
      await expect(friendService.unfriend('user1', ''))
        .rejects.toThrow('Missing or invalid b');
    });
  });

  describe('block', () => {
    const mockBlockRecord: BlockRecord = {
      id: 'block123',
      userId: 'user1',
      blockedId: 'user2',
      reason: 'harassment',
      createdAt: new Date()
    };

    it('should block user with reason', async () => {
      mockFriendManager.block.mockResolvedValue(mockBlockRecord);

      const result = await friendService.block('user1', 'user2', 'harassment');

      expect(mockFriendManager.block).toHaveBeenCalledWith('user1', 'user2', 'harassment');
      expect(result).toEqual(mockBlockRecord);
    });

    it('should block user without reason', async () => {
      const blockWithoutReason = { ...mockBlockRecord, reason: undefined };
      mockFriendManager.block.mockResolvedValue(blockWithoutReason);

      const result = await friendService.block('user1', 'user2');

      expect(mockFriendManager.block).toHaveBeenCalledWith('user1', 'user2', undefined);
      expect(result).toEqual(blockWithoutReason);
    });

    it('should throw error for invalid userId', async () => {
      await expect(friendService.block('', 'user2'))
        .rejects.toThrow('Missing or invalid userId');
    });

    it('should throw error for invalid blockedId', async () => {
      await expect(friendService.block('user1', ''))
        .rejects.toThrow('Missing or invalid blockedId');
    });
  });

  describe('unblock', () => {
    it('should unblock user', async () => {
      mockFriendManager.unblock.mockResolvedValue();

      await friendService.unblock('user1', 'user2');

      expect(mockFriendManager.unblock).toHaveBeenCalledWith('user1', 'user2');
    });

    it('should throw error for invalid userId', async () => {
      await expect(friendService.unblock('', 'user2'))
        .rejects.toThrow('Missing or invalid userId');
    });

    it('should throw error for invalid blockedId', async () => {
      await expect(friendService.unblock('user1', ''))
        .rejects.toThrow('Missing or invalid blockedId');
    });
  });

  describe('relationshipStatus', () => {
    const mockStatus: FriendRelationshipStatus = {
      status: 'accepted',
      direction: null
    };

    it('should get relationship status', async () => {
      mockFriendManager.getRelationshipStatus.mockResolvedValue(mockStatus);

      const result = await friendService.relationshipStatus('user1', 'user2');

      expect(mockFriendManager.getRelationshipStatus).toHaveBeenCalledWith('user1', 'user2');
      expect(result).toBe(mockStatus);
    });

    it('should throw error for invalid first user id', async () => {
      await expect(friendService.relationshipStatus('', 'user2'))
        .rejects.toThrow('Missing or invalid a');
    });

    it('should throw error for invalid second user id', async () => {
      await expect(friendService.relationshipStatus('user1', ''))
        .rejects.toThrow('Missing or invalid b');
    });
  });

  describe('inviteToGame', () => {
    const mockInvite: FriendInviteRecord = {
      id: 'invite123',
      inviterId: 'user1',
      inviteeId: 'user2',
      roomId: 'room123',
      status: 'pending',
      createdAt: new Date(),
      respondedAt: null
    };

    it('should create game invite', async () => {
      mockFriendManager.createGameInvite.mockResolvedValue(mockInvite);

      const result = await friendService.inviteToGame('user1', 'user2', 'room123');

      expect(mockFriendManager.createGameInvite).toHaveBeenCalledWith('user1', 'user2', 'room123');
      expect(result).toEqual(mockInvite);
    });

    it('should throw error for invalid inviterId', async () => {
      await expect(friendService.inviteToGame('', 'user2', 'room123'))
        .rejects.toThrow('Missing or invalid inviterId');
    });

    it('should throw error for invalid inviteeId', async () => {
      await expect(friendService.inviteToGame('user1', '', 'room123'))
        .rejects.toThrow('Missing or invalid inviteeId');
    });

    it('should throw error for invalid roomId', async () => {
      await expect(friendService.inviteToGame('user1', 'user2', ''))
        .rejects.toThrow('Missing or invalid roomId');
    });
  });

  describe('respondToInvite', () => {
    const mockInvite: FriendInviteRecord = {
      id: 'invite123',
      inviterId: 'user1',
      inviteeId: 'user2',
      roomId: 'room123',
      status: 'accepted',
      createdAt: new Date(),
      respondedAt: new Date()
    };

    it('should accept game invite', async () => {
      mockFriendManager.respondToGameInvite.mockResolvedValue(mockInvite);

      const result = await friendService.respondToInvite('invite123', 'accept');

      expect(mockFriendManager.respondToGameInvite).toHaveBeenCalledWith('invite123', true);
      expect(result).toEqual(mockInvite);
    });

    it('should decline game invite', async () => {
      const declinedInvite = { ...mockInvite, status: 'declined' as const };
      mockFriendManager.respondToGameInvite.mockResolvedValue(declinedInvite);

      const result = await friendService.respondToInvite('invite123', 'decline');

      expect(mockFriendManager.respondToGameInvite).toHaveBeenCalledWith('invite123', false);
      expect(result).toEqual(declinedInvite);
    });

    it('should throw error for invalid id', async () => {
      await expect(friendService.respondToInvite('', 'accept'))
        .rejects.toThrow('Missing or invalid id');
    });
  });

  describe('listInvites', () => {
    const mockResponse: Paginated<FriendInviteRecord> = {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0
    };

    it('should list incoming invites by default', async () => {
      mockFriendManager.listInvites.mockResolvedValue(mockResponse);

      const result = await friendService.listInvites('user1');

      expect(mockFriendManager.listInvites).toHaveBeenCalledWith('user1', 'incoming', 1, 20);
      expect(result).toEqual(mockResponse);
    });

    it('should list outgoing invites', async () => {
      mockFriendManager.listInvites.mockResolvedValue(mockResponse);

      const result = await friendService.listInvites('user1', 'outgoing');

      expect(mockFriendManager.listInvites).toHaveBeenCalledWith('user1', 'outgoing', 1, 20);
      expect(result).toEqual(mockResponse);
    });

    it('should throw error for invalid userId', async () => {
      await expect(friendService.listInvites(''))
        .rejects.toThrow('Missing or invalid userId');
    });
  });

  describe('headToHead', () => {
    const mockSummary: HeadToHeadSummary = {
      gamesPlayed: 10,
      lastPlayed: new Date()
    };

    it('should get head-to-head summary', async () => {
      mockFriendManager.getHeadToHeadSummary.mockResolvedValue(mockSummary);

      const result = await friendService.headToHead('user1', 'user2');

      expect(mockFriendManager.getHeadToHeadSummary).toHaveBeenCalledWith('user1', 'user2');
      expect(result).toEqual(mockSummary);
    });

    it('should throw error for invalid first user id', async () => {
      await expect(friendService.headToHead('', 'user2'))
        .rejects.toThrow('Missing or invalid a');
    });

    it('should throw error for invalid second user id', async () => {
      await expect(friendService.headToHead('user1', ''))
        .rejects.toThrow('Missing or invalid b');
    });
  });

  describe('Validation helpers', () => {
    it('should validate non-string values', async () => {
      await expect(friendService.sendRequest(123 as any, 'user2'))
        .rejects.toThrow('Missing or invalid requesterId');
    });

    it('should validate null values', async () => {
      await expect(friendService.sendRequest(null as any, 'user2'))
        .rejects.toThrow('Missing or invalid requesterId');
    });
  });

  describe('Pagination normalization', () => {
    it('should handle NaN page values', async () => {
      mockFriendManager.listFriends.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0
      });

      await friendService.listFriends('user1', NaN, 20);
      expect(mockFriendManager.listFriends).toHaveBeenCalledWith('user1', 1, 20);
    });

    it('should handle non-finite limit values', async () => {
      mockFriendManager.listFriends.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0
      });

      await friendService.listFriends('user1', 1, Infinity);
      expect(mockFriendManager.listFriends).toHaveBeenCalledWith('user1', 1, 20);
    });
  });
});