import { ChatService } from '../chat-service';
import { ChatManager } from '../../database/chat-manager';
import { Pool } from 'pg';
import {
  SendChatInput,
  ListRoomChatQuery,
  ListPrivateChatQuery,
  ChatMessage,
  AddReactionInput,
  ChatReaction
} from '../../../types/chat';

// Mock the chat manager
jest.mock('../../database/chat-manager');

describe('ChatService', () => {
  let chatService: ChatService;
  let mockPool: jest.Mocked<Pool>;
  let mockChatManager: jest.Mocked<ChatManager>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
    } as any;

    mockChatManager = {
      send: jest.fn(),
      listRoomMessages: jest.fn(),
      listPrivateMessages: jest.fn(),
      moderate: jest.fn(),
      addReaction: jest.fn(),
      removeReaction: jest.fn(),
      listReactions: jest.fn(),
      deleteMessage: jest.fn(),
    } as any;

    (ChatManager as jest.MockedClass<typeof ChatManager>).mockImplementation(() => mockChatManager);
    
    chatService = new ChatService(mockPool);
  });

  describe('Constructor', () => {
    it('should create an instance with ChatManager', () => {
      expect(chatService).toBeInstanceOf(ChatService);
      expect(ChatManager).toHaveBeenCalledWith(mockPool);
    });
  });

  describe('send', () => {
    const validRoomMessage: SendChatInput = {
      senderId: 'user123',
      message: 'Hello world',
      roomId: 'room123',
      isPrivate: false
    };

    const validPrivateMessage: SendChatInput = {
      senderId: 'user123',
      message: 'Hello private',
      recipientId: 'user456',
      isPrivate: true
    };

    const expectedMessage: ChatMessage = {
      id: 'msg123',
      senderId: 'user123',
      message: 'Hello world',
      roomId: 'room123',
      recipientId: null,
      isPrivate: false,
      sentAt: new Date().toISOString(),
      isModerated: false,
      moderatedAt: null,
      moderatorId: null
    };

    it('should send room message successfully', async () => {
      mockChatManager.send.mockResolvedValue(expectedMessage);

      const result = await chatService.send(validRoomMessage);

      expect(mockChatManager.send).toHaveBeenCalledWith(validRoomMessage);
      expect(result).toEqual(expectedMessage);
    });

    it('should send private message successfully', async () => {
      const expectedPrivateMessage: ChatMessage = {
        ...expectedMessage,
        message: 'Hello private',
        roomId: null,
        recipientId: 'user456',
        isPrivate: true
      };

      mockChatManager.send.mockResolvedValue(expectedPrivateMessage);

      const result = await chatService.send(validPrivateMessage);

      expect(mockChatManager.send).toHaveBeenCalledWith(validPrivateMessage);
      expect(result).toEqual(expectedPrivateMessage);
    });

    it('should throw error when input is null', async () => {
      await expect(chatService.send(null as any)).rejects.toThrow('input required');
    });

    it('should throw error when input is not object', async () => {
      await expect(chatService.send('invalid' as any)).rejects.toThrow('input required');
    });

    it('should throw error when senderId is missing', async () => {
      const invalidInput = { ...validRoomMessage, senderId: '' };
      await expect(chatService.send(invalidInput)).rejects.toThrow('senderId required');
    });

    it('should throw error when message is empty', async () => {
      const invalidInput = { ...validRoomMessage, message: '   ' };
      await expect(chatService.send(invalidInput)).rejects.toThrow('message required');
    });

    it('should throw error when message is too long', async () => {
      const longMessage = 'a'.repeat(2001);
      const invalidInput = { ...validRoomMessage, message: longMessage };
      await expect(chatService.send(invalidInput)).rejects.toThrow('message too long');
    });

    it('should throw error for private message without recipientId', async () => {
      const invalidInput = {
        senderId: 'user123',
        message: 'Hello',
        isPrivate: true
      };
      await expect(chatService.send(invalidInput as any)).rejects.toThrow('recipientId required for private message');
    });

    it('should throw error for private message with roomId', async () => {
      const invalidInput = {
        senderId: 'user123',
        message: 'Hello',
        roomId: 'room123',
        recipientId: 'user456',
        isPrivate: true
      };
      await expect(chatService.send(invalidInput)).rejects.toThrow('roomId not allowed for private message');
    });

    it('should throw error for room message without roomId', async () => {
      const invalidInput = {
        senderId: 'user123',
        message: 'Hello',
        isPrivate: false
      };
      await expect(chatService.send(invalidInput as any)).rejects.toThrow('roomId required');
    });
  });

  describe('listRoom', () => {
    it('should list room messages successfully', async () => {
      const query: ListRoomChatQuery = {
        roomId: 'room123',
        limit: 50,
        before: new Date().toISOString()
      };

      const expectedMessages: ChatMessage[] = [
        {
          id: 'msg1',
          senderId: 'user1',
          message: 'Hello',
          roomId: 'room123',
          recipientId: null,
          isPrivate: false,
          sentAt: new Date().toISOString(),
          isModerated: false,
          moderatedAt: null,
          moderatorId: null
        }
      ];

      mockChatManager.listRoomMessages.mockResolvedValue(expectedMessages);

      const result = await chatService.listRoom(query);

      expect(mockChatManager.listRoomMessages).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedMessages);
    });

    it('should throw error when roomId is missing', async () => {
      await expect(chatService.listRoom({} as any)).rejects.toThrow('roomId required');
    });

    it('should throw error when query is null', async () => {
      await expect(chatService.listRoom(null as any)).rejects.toThrow('roomId required');
    });
  });

  describe('listPrivate', () => {
    it('should list private messages successfully', async () => {
      const query: ListPrivateChatQuery = {
        userAId: 'user1',
        userBId: 'user2',
        limit: 50,
        before: new Date().toISOString()
      };

      const expectedMessages: ChatMessage[] = [
        {
          id: 'msg1',
          senderId: 'user1',
          message: 'Private hello',
          roomId: null,
          recipientId: 'user2',
          isPrivate: true,
          sentAt: new Date().toISOString(),
          isModerated: false,
          moderatedAt: null,
          moderatorId: null
        }
      ];

      mockChatManager.listPrivateMessages.mockResolvedValue(expectedMessages);

      const result = await chatService.listPrivate(query);

      expect(mockChatManager.listPrivateMessages).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedMessages);
    });

    it('should throw error when user ids are missing', async () => {
      await expect(chatService.listPrivate({} as any)).rejects.toThrow('user ids required');
    });

    it('should throw error when userAId is missing', async () => {
      await expect(chatService.listPrivate({ userBId: 'user2' } as any)).rejects.toThrow('user ids required');
    });

    it('should throw error when userBId is missing', async () => {
      await expect(chatService.listPrivate({ userAId: 'user1' } as any)).rejects.toThrow('user ids required');
    });
  });

  describe('moderate', () => {
    it('should moderate message by hiding it', async () => {
      const messageId = 'msg123';
      const moderatorId = 'mod123';

      const expectedResult: ChatMessage = {
        id: messageId,
        senderId: 'user123',
        message: 'Some message',
        roomId: 'room123',
        recipientId: null,
        isPrivate: false,
        sentAt: new Date().toISOString(),
        isModerated: true,
        moderatedAt: new Date().toISOString(),
        moderatorId: moderatorId
      };

      mockChatManager.moderate.mockResolvedValue(expectedResult);

      const result = await chatService.moderate(messageId, moderatorId, true);

      expect(mockChatManager.moderate).toHaveBeenCalledWith(messageId, moderatorId, true);
      expect(result).toEqual(expectedResult);
    });

    it('should moderate message by unhiding it', async () => {
      const messageId = 'msg123';
      const moderatorId = 'mod123';

      const expectedResult: ChatMessage = {
        id: messageId,
        senderId: 'user123',
        message: 'Some message',
        roomId: 'room123',
        recipientId: null,
        isPrivate: false,
        sentAt: new Date().toISOString(),
        isModerated: false,
        moderatedAt: null,
        moderatorId: null
      };

      mockChatManager.moderate.mockResolvedValue(expectedResult);

      const result = await chatService.moderate(messageId, moderatorId, false);

      expect(mockChatManager.moderate).toHaveBeenCalledWith(messageId, moderatorId, false);
      expect(result).toEqual(expectedResult);
    });

    it('should default to hiding when no hide parameter provided', async () => {
      const messageId = 'msg123';
      const moderatorId = 'mod123';

      mockChatManager.moderate.mockResolvedValue({} as any);

      await chatService.moderate(messageId, moderatorId);

      expect(mockChatManager.moderate).toHaveBeenCalledWith(messageId, moderatorId, true);
    });

    it('should throw error when messageId is missing', async () => {
      await expect(chatService.moderate('', 'mod123')).rejects.toThrow('messageId required');
    });

    it('should throw error when moderatorId is missing', async () => {
      await expect(chatService.moderate('msg123', '')).rejects.toThrow('moderatorId required');
    });
  });

  describe('addReaction', () => {
    const validReaction: AddReactionInput = {
      messageId: 'msg123',
      userId: 'user123',
      emoji: '👍'
    };

    it('should add reaction successfully', async () => {
      const expectedReaction: ChatReaction = {
        id: 'reaction123',
        messageId: 'msg123',
        userId: 'user123',
        emoji: '👍',
        createdAt: new Date().toISOString()
      };

      mockChatManager.addReaction.mockResolvedValue(expectedReaction);

      const result = await chatService.addReaction(validReaction);

      expect(mockChatManager.addReaction).toHaveBeenCalledWith(validReaction);
      expect(result).toEqual(expectedReaction);
    });

    it('should throw error when messageId is missing', async () => {
      const invalidReaction = { ...validReaction, messageId: '' };
      await expect(chatService.addReaction(invalidReaction)).rejects.toThrow('messageId required');
    });

    it('should throw error when userId is missing', async () => {
      const invalidReaction = { ...validReaction, userId: '' };
      await expect(chatService.addReaction(invalidReaction)).rejects.toThrow('userId required');
    });

    it('should throw error when emoji is missing', async () => {
      const invalidReaction = { ...validReaction, emoji: '' };
      await expect(chatService.addReaction(invalidReaction)).rejects.toThrow('emoji required');
    });

    it('should throw error when input is null', async () => {
      await expect(chatService.addReaction(null as any)).rejects.toThrow('messageId required');
    });
  });

  describe('removeReaction', () => {
    const validReaction: AddReactionInput = {
      messageId: 'msg123',
      userId: 'user123',
      emoji: '👍'
    };

    it('should remove reaction successfully', async () => {
      const expectedResult = { removed: true };

      mockChatManager.removeReaction.mockResolvedValue(expectedResult);

      const result = await chatService.removeReaction(validReaction);

      expect(mockChatManager.removeReaction).toHaveBeenCalledWith(validReaction);
      expect(result).toEqual(expectedResult);
    });

    it('should throw error when messageId is missing', async () => {
      const invalidReaction = { ...validReaction, messageId: '' };
      await expect(chatService.removeReaction(invalidReaction)).rejects.toThrow('messageId required');
    });

    it('should throw error when userId is missing', async () => {
      const invalidReaction = { ...validReaction, userId: '' };
      await expect(chatService.removeReaction(invalidReaction)).rejects.toThrow('userId required');
    });

    it('should throw error when emoji is missing', async () => {
      const invalidReaction = { ...validReaction, emoji: '' };
      await expect(chatService.removeReaction(invalidReaction)).rejects.toThrow('emoji required');
    });
  });

  describe('listReactions', () => {
    it('should list reactions for a message successfully', async () => {
      const messageId = 'msg123';
      const expectedReactions: ChatReaction[] = [
        {
          id: 'reaction1',
          messageId: messageId,
          userId: 'user1',
          emoji: '👍',
          createdAt: new Date().toISOString()
        },
        {
          id: 'reaction2',
          messageId: messageId,
          userId: 'user2',
          emoji: '❤️',
          createdAt: new Date().toISOString()
        }
      ];

      mockChatManager.listReactions.mockResolvedValue(expectedReactions);

      const result = await chatService.listReactions(messageId);

      expect(mockChatManager.listReactions).toHaveBeenCalledWith({ messageId });
      expect(result).toEqual(expectedReactions);
    });

    it('should throw error when messageId is missing', async () => {
      await expect(chatService.listReactions('')).rejects.toThrow('messageId required');
    });
  });

  describe('delete', () => {
    it('should delete message successfully', async () => {
      const input = {
        messageId: 'msg123',
        userId: 'user123',
        isAdmin: false
      };
      const expectedResult = { deleted: true, roomId: 'room123' };

      mockChatManager.deleteMessage.mockResolvedValue(expectedResult);

      const result = await chatService.delete(input);

      expect(mockChatManager.deleteMessage).toHaveBeenCalledWith(input);
      expect(result).toEqual(expectedResult);
    });

    it('should delete message as admin', async () => {
      const input = {
        messageId: 'msg123',
        userId: 'admin123',
        isAdmin: true
      };
      const expectedResult = { deleted: true, roomId: 'room123' };

      mockChatManager.deleteMessage.mockResolvedValue(expectedResult);

      const result = await chatService.delete(input);

      expect(mockChatManager.deleteMessage).toHaveBeenCalledWith(input);
      expect(result).toEqual(expectedResult);
    });

    it('should throw error when messageId is missing', async () => {
      await expect(chatService.delete({ messageId: '', userId: 'user123' }))
        .rejects.toThrow('messageId required');
    });

    it('should throw error when userId is missing', async () => {
      await expect(chatService.delete({ messageId: 'msg123', userId: '' }))
        .rejects.toThrow('userId required');
    });

    it('should throw error when input is null', async () => {
      await expect(chatService.delete(null as any))
        .rejects.toThrow('messageId required');
    });
  });
});