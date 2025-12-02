import type { Pool } from 'pg';
import type { TableState } from '../../types/poker';
import { ChatService } from '../services/chat-service';
import { publishChatMessage } from '../realtime/publisher';
import { formatHandResult, SYSTEM_SENDER_ID } from './hand-result-formatter';

/**
 * Posts a hand result as a system message in the chat for a game room.
 * 
 * @param pool - Database connection pool
 * @param tableId - The table/room ID where the game is played
 * @param state - The current table state (should be at showdown stage)
 * @returns The created chat message, or null if no message was posted
 */
export async function postHandResultToChat(
  pool: Pool,
  tableId: string,
  state: TableState
): Promise<any | null> {
  try {
    // Format the hand result
    const result = formatHandResult(state);
    if (!result || !result.message) {
      return null;
    }

    // Create the chat service and send the message
    const chatService = new ChatService(pool);
    const message = await chatService.send({
      roomId: tableId,
      senderId: SYSTEM_SENDER_ID,
      message: result.message,
      isPrivate: false,
    });

    // Broadcast the message via Supabase Realtime
    if (message?.roomId) {
      await publishChatMessage(message.roomId, { message });
    }

    return message;
  } catch (error) {
    // Log the error but don't throw - posting to chat should not break the game flow
    console.warn('Failed to post hand result to chat:', error);
    return null;
  }
}
