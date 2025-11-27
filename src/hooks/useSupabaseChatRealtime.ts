import { useEffect, useRef } from 'react';
import { getSupabaseBrowser } from '../lib/realtime/supabaseClient';
import type { ChatMessage } from '../types/chat';

type ChatCallbacks = {
  onNewMessage?: (payload: { message: ChatMessage }) => void;
  onReaction?: (payload: { messageId: string; emoji: string; userId: string }) => void;
  onReactionRemoved?: (payload: { messageId: string; emoji: string; userId: string }) => void;
  onModerated?: (payload: { messageId: string; hidden: boolean; moderatorId: string }) => void;
  onDeleted?: (payload: { messageId: string; deletedBy: string }) => void;
};

/**
 * Hook to subscribe to Supabase realtime chat events for a specific room.
 * Use this when transport mode is 'supabase' to receive chat updates in real-time.
 */
export function useSupabaseChatRealtime(roomId?: string, callbacks?: ChatCallbacks) {
  const cbsRef = useRef<ChatCallbacks | undefined>(callbacks);
  cbsRef.current = callbacks;

  useEffect(() => {
    if (!roomId) return;
    const supa = getSupabaseBrowser();
    if (!supa) return;

    const channel = supa.channel(`chat:${roomId}`);

    channel
      .on('broadcast', { event: 'chat_new_message' }, (p) => cbsRef.current?.onNewMessage?.(p.payload))
      .on('broadcast', { event: 'chat_reaction' }, (p) => cbsRef.current?.onReaction?.(p.payload))
      .on('broadcast', { event: 'chat_reaction_removed' }, (p) => cbsRef.current?.onReactionRemoved?.(p.payload))
      .on('broadcast', { event: 'chat_moderated' }, (p) => cbsRef.current?.onModerated?.(p.payload))
      .on('broadcast', { event: 'chat_deleted' }, (p) => cbsRef.current?.onDeleted?.(p.payload))
      .subscribe();

    return () => {
      try { channel.unsubscribe(); } catch {}
    };
  }, [roomId]);
}
