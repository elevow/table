import type { TableState } from '../../types/poker';
import { publishChatMessage } from '../realtime/publisher';
import { formatHandResult, SYSTEM_SENDER_ID } from './hand-result-formatter';
import { randomUUID } from 'crypto';

/**
 * Posts a hand result as a system message in the chat for a game room.
 * System messages are broadcast via Supabase Realtime but not stored in the database.
 * 
 * @param tableId - The table/room ID where the game is played
 * @param state - The current table state (should be at showdown stage)
 * @returns The broadcast message, or null if no message was posted
 */
export async function postHandResultToChat(
  tableId: string,
  state: TableState
): Promise<any | null> {
  try {
    // Format the hand result
    const result = formatHandResult(state);
    if (!result || !result.message) {
      return null;
    }

    // Create a system message object (not persisted to database)
    const message = {
      id: randomUUID(),
      roomId: tableId,
      senderId: SYSTEM_SENDER_ID,
      message: result.message,
      isPrivate: false,
      recipientId: null,
      sentAt: new Date().toISOString(),
      isModerated: false,
      moderatedAt: null,
      moderatorId: null,
      isSystem: true, // Flag to indicate this is a system message
    };

    // Broadcast the message via Supabase Realtime
    await publishChatMessage(tableId, { message });

    return message;
  } catch (error) {
    // Log the error but don't throw - posting to chat should not break the game flow
    console.warn('Failed to post hand result to chat:', error);
    return null;
  }
}
