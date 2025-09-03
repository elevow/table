export interface ChatMessageRow {
  id: string;
  room_id: string | null;
  sender_id: string;
  message: string;
  is_private: boolean;
  recipient_id: string | null;
  sent_at: string; // timestamp
  is_moderated: boolean;
  moderated_at: string | null;
  moderator_id: string | null;
}

export interface ChatMessage {
  id: string;
  roomId: string | null;
  senderId: string;
  message: string;
  isPrivate: boolean;
  recipientId: string | null;
  sentAt: string;
  isModerated: boolean;
  moderatedAt: string | null;
  moderatorId: string | null;
}

export interface SendChatInput {
  roomId?: string; // required for room messages
  senderId: string;
  message: string;
  isPrivate?: boolean; // if true, must include recipientId and no roomId
  recipientId?: string;
}

export interface ListRoomChatQuery {
  roomId: string;
  limit?: number;
  before?: string; // ISO timestamp to paginate backwards
}

export interface ListPrivateChatQuery {
  userAId: string;
  userBId: string;
  limit?: number;
  before?: string;
}

// US-063: Emoji Reactions types
export interface ChatReactionRow {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string; // timestamp
}

export interface ChatReaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

export interface AddReactionInput {
  messageId: string;
  userId: string;
  emoji: string; // unicode emoji or shortcode
}

export interface ListReactionsQuery {
  messageId: string;
}
