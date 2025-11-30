import { createClient } from '@supabase/supabase-js';

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function publishSeatClaimed(tableId: string, payload: any) {
  const supa = getSupabaseServer();
  if (!supa) return;
  await supa.channel(`table:${tableId}`).send({ type: 'broadcast', event: 'seat_claimed', payload });
}

export async function publishSeatVacated(tableId: string, payload: any) {
  const supa = getSupabaseServer();
  if (!supa) return;
  await supa.channel(`table:${tableId}`).send({ type: 'broadcast', event: 'seat_vacated', payload });
}

export async function publishSeatState(tableId: string, payload: any) {
  const supa = getSupabaseServer();
  if (!supa) return;
  await supa.channel(`table:${tableId}`).send({ type: 'broadcast', event: 'seat_state', payload });
}

export async function publishGameStateUpdate(tableId: string, payload: any) {
  const supa = getSupabaseServer();
  if (!supa) return;
  await supa.channel(`table:${tableId}`).send({ type: 'broadcast', event: 'game_state_update', payload });
}

export async function publishAwaitingDealerChoice(tableId: string, payload: any) {
  const supa = getSupabaseServer();
  if (!supa) return;
  await supa.channel(`table:${tableId}`).send({ type: 'broadcast', event: 'awaiting_dealer_choice', payload });
}

export async function publishRebuyPrompt(tableId: string, payload: any) {
  const supa = getSupabaseServer();
  if (!supa) return;
  await supa.channel(`table:${tableId}`).send({ type: 'broadcast', event: 'rebuy_prompt', payload });
}

export async function publishRebuyResult(tableId: string, payload: any) {
  const supa = getSupabaseServer();
  if (!supa) return;
  await supa.channel(`table:${tableId}`).send({ type: 'broadcast', event: 'rebuy_result', payload });
}

// Chat events - use a dedicated chat channel per room
export async function publishChatMessage(roomId: string, payload: { message: any }) {
  const supa = getSupabaseServer();
  if (!supa) return;
  await supa.channel(`chat:${roomId}`).send({ type: 'broadcast', event: 'chat_new_message', payload });
}

export async function publishChatReaction(roomId: string, payload: { messageId: string; emoji: string; userId: string }) {
  const supa = getSupabaseServer();
  if (!supa) return;
  await supa.channel(`chat:${roomId}`).send({ type: 'broadcast', event: 'chat_reaction', payload });
}

export async function publishChatReactionRemoved(roomId: string, payload: { messageId: string; emoji: string; userId: string }) {
  const supa = getSupabaseServer();
  if (!supa) return;
  await supa.channel(`chat:${roomId}`).send({ type: 'broadcast', event: 'chat_reaction_removed', payload });
}

export async function publishChatModerated(roomId: string, payload: { messageId: string; hidden: boolean; moderatorId: string }) {
  const supa = getSupabaseServer();
  if (!supa) return;
  await supa.channel(`chat:${roomId}`).send({ type: 'broadcast', event: 'chat_moderated', payload });
}

/**
 * Broadcasts a chat message deletion event to all users in a room via Supabase Realtime.
 * @param roomId - The ID of the room where the message was deleted
 * @param payload - Object containing the deleted messageId and the userId who deleted it
 */
export async function publishChatDeleted(roomId: string, payload: { messageId: string; deletedBy: string }) {
  const supa = getSupabaseServer();
  if (!supa) return;
  await supa.channel(`chat:${roomId}`).send({ type: 'broadcast', event: 'chat_deleted', payload });
}
