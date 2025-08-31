import type { Pool } from 'pg';
import type { ChatMessage, ChatMessageRow, SendChatInput, ListRoomChatQuery, ListPrivateChatQuery } from '../../types/chat';

function mapRow(r: ChatMessageRow): ChatMessage {
  return {
    id: r.id,
    roomId: r.room_id,
    senderId: r.sender_id,
    message: r.message,
    isPrivate: r.is_private,
    recipientId: r.recipient_id,
    sentAt: r.sent_at,
    isModerated: r.is_moderated,
    moderatedAt: r.moderated_at,
    moderatorId: r.moderator_id,
  };
}

export class ChatManager {
  constructor(private pool: Pool) {}

  async send(input: SendChatInput): Promise<ChatMessage> {
    const isPrivate = !!input.isPrivate;
    if (!input.senderId) throw new Error('senderId required');
    if (!input.message || !input.message.trim()) throw new Error('message required');
    if (isPrivate) {
      if (!input.recipientId) throw new Error('recipientId required for private message');
    } else {
      if (!input.roomId) throw new Error('roomId required for room message');
    }

    const res = await this.pool.query(
      `INSERT INTO chat_messages (room_id, sender_id, message, is_private, recipient_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.roomId ?? null, input.senderId, input.message, isPrivate, input.recipientId ?? null]
    );
    return mapRow(res.rows[0] as ChatMessageRow);
  }

  async listRoomMessages(q: ListRoomChatQuery): Promise<ChatMessage[]> {
    const limit = Math.max(1, Math.min(200, Number(q.limit ?? 50)));
    const before = q.before ?? null;
    const res = await this.pool.query(
      `SELECT * FROM chat_messages
       WHERE room_id = $1 AND is_private = FALSE
         AND ($2::timestamptz IS NULL OR sent_at < $2::timestamptz)
       ORDER BY sent_at DESC
       LIMIT $3`,
      [q.roomId, before, limit]
    );
    return (res.rows as ChatMessageRow[]).map(mapRow);
  }

  async listPrivateMessages(q: ListPrivateChatQuery): Promise<ChatMessage[]> {
    const limit = Math.max(1, Math.min(200, Number(q.limit ?? 50)));
    const before = q.before ?? null;
    const res = await this.pool.query(
      `SELECT * FROM chat_messages
       WHERE is_private = TRUE
         AND ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
         AND ($3::timestamptz IS NULL OR sent_at < $3::timestamptz)
       ORDER BY sent_at DESC
       LIMIT $4`,
      [q.userAId, q.userBId, before, limit]
    );
    return (res.rows as ChatMessageRow[]).map(mapRow);
  }

  async moderate(messageId: string, moderatorId: string, hide = true): Promise<ChatMessage> {
    const res = await this.pool.query(
      `UPDATE chat_messages
       SET is_moderated = $2, moderated_at = NOW(), moderator_id = $3
       WHERE id = $1
       RETURNING *`,
      [messageId, hide, moderatorId]
    );
    if (!res.rows[0]) throw new Error('message not found');
    return mapRow(res.rows[0] as ChatMessageRow);
  }
}
