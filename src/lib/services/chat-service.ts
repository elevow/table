import type { Pool } from 'pg';
import { ChatManager } from '../database/chat-manager';
import type { SendChatInput, ListRoomChatQuery, ListPrivateChatQuery, ChatMessage, AddReactionInput } from '../../types/chat';

export class ChatService {
  private mgr: ChatManager;
  constructor(pool: Pool) {
    this.mgr = new ChatManager(pool);
  }

  async send(input: SendChatInput): Promise<ChatMessage> {
    if (!input || typeof input !== 'object') throw new Error('input required');
    if (typeof input.senderId !== 'string' || input.senderId.length === 0) throw new Error('senderId required');
    if (typeof input.message !== 'string' || input.message.trim().length === 0) throw new Error('message required');
    if (input.isPrivate) {
      if (!input.recipientId) throw new Error('recipientId required for private message');
      if (input.roomId) throw new Error('roomId not allowed for private message');
    } else {
      if (!input.roomId) throw new Error('roomId required');
    }
    // Max length check to avoid abuse in tests too
    if (input.message.length > 2000) throw new Error('message too long');
    return this.mgr.send(input);
  }

  async listRoom(q: ListRoomChatQuery) {
    if (!q?.roomId) throw new Error('roomId required');
    return this.mgr.listRoomMessages(q);
  }

  async listPrivate(q: ListPrivateChatQuery) {
    if (!q?.userAId || !q?.userBId) throw new Error('user ids required');
    return this.mgr.listPrivateMessages(q);
  }

  async moderate(messageId: string, moderatorId: string, hide = true) {
    if (!messageId) throw new Error('messageId required');
    if (!moderatorId) throw new Error('moderatorId required');
    return this.mgr.moderate(messageId, moderatorId, hide);
  }

  /**
   * Retrieves a chat message by its ID.
   * @param messageId - The unique identifier of the message
   * @returns The chat message if found, null otherwise
   * @throws Error if messageId is empty or invalid
   */
  async getMessage(messageId: string) {
    if (!messageId) throw new Error('messageId required');
    return this.mgr.getMessage(messageId);
  }

  /**
   * Deletes a chat message and its associated reactions.
   * Users can delete their own messages, admins can delete any message.
   * @param messageId - The unique identifier of the message to delete
   * @param userId - The ID of the user requesting the deletion
   * @param isAdmin - Whether the requesting user has admin privileges
   * @returns Object indicating whether the deletion was successful
   * @throws Error if messageId or userId is empty, message not found, or user not authorized
   */
  async deleteMessage(messageId: string, userId: string, isAdmin: boolean) {
    if (!messageId) throw new Error('messageId required');
    if (!userId) throw new Error('userId required');
    return this.mgr.deleteMessage(messageId, userId, isAdmin);
  }

  // US-063: Emoji reactions
  async addReaction(input: AddReactionInput) {
    if (!input?.messageId) throw new Error('messageId required');
    if (!input?.userId) throw new Error('userId required');
    if (!input?.emoji) throw new Error('emoji required');
    return this.mgr.addReaction(input);
  }

  async removeReaction(input: AddReactionInput) {
    if (!input?.messageId) throw new Error('messageId required');
    if (!input?.userId) throw new Error('userId required');
    if (!input?.emoji) throw new Error('emoji required');
    return this.mgr.removeReaction(input);
  }

  async listReactions(messageId: string) {
    if (!messageId) throw new Error('messageId required');
    return this.mgr.listReactions({ messageId });
  }
}
