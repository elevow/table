import { useEffect, useMemo, useState, memo, useCallback } from 'react';
import type { ChatMessage } from '../types/chat';
import { useSupabaseChatRealtime } from '../hooks/useSupabaseChatRealtime';
import { authHeaders, getStoredAuthToken } from '../utils/auth-headers';

interface ChatPanelProps {
  gameId: string;
  playerId?: string;
  /**
   * Whether the current user has admin privileges.
  * Admins can delete any message, not just their own.
  * This should be determined server-side to ensure security.
  */
  /**
   * Whether the current user has admin privileges.
   * Admins can delete any message, not just their own.
   * This should be determined server-side to ensure security.
   */
  isAdmin?: boolean;
}

// Players this viewer has muted, by ID with the name they had, kept in this browser for every table
const MUTED_KEY = 'chatMutedPlayers';
function loadMuted(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(MUTED_KEY) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function ChatPanel({ gameId, playerId, isAdmin = false }: ChatPanelProps) {
  const [muted, setMuted] = useState<Record<string, string>>({});
  // The tournament director, if this is a tournament table: always heard, so never mutable
  const [directorId, setDirectorId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reacting, setReacting] = useState<string | null>(null); // messageId currently reacting to
  const [deleting, setDeleting] = useState<string | null>(null); // messageId currently being deleted
  const [reactions, setReactions] = useState<Record<string, Record<string, number>>>({});
  // Track current user's reactions for toggle behavior: myReactions[messageId][emoji] = true
  const [myReactions, setMyReactions] = useState<Record<string, Record<string, boolean>>>({});

  // lightweight emoji set for quick reactions
  const emojis = useMemo(() => ['👍', '❤️', '😂'], []);

  const fetchMessages = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/chat/room/list?roomId=${encodeURIComponent(gameId)}&limit=50`, { headers: authHeaders() });
      const json = await res.json();
      const items = Array.isArray(json.items) ? (json.items as ChatMessage[]) : [];
      setDirectorId(typeof json.directorId === 'string' ? json.directorId : null);
      // messages come newest-first; show oldest-first for chat readability
      setMessages(items.slice().reverse());
      // Preload reactions per message (minimal demo)
      const counts: Record<string, Record<string, number>> = {};
      const mine: Record<string, Record<string, boolean>> = {};
      await Promise.all(
        items.map(async (m) => {
          try {
            const r = await fetch(`/api/chat/reactions/list?messageId=${encodeURIComponent(m.id)}`);
            const rj = await r.json();
            const c: Record<string, number> = {};
            for (const rec of rj.items || []) {
              c[rec.emoji] = (c[rec.emoji] || 0) + 1;
              if (playerId && rec.userId === playerId) {
                if (!mine[m.id]) mine[m.id] = {};
                mine[m.id][rec.emoji] = true;
              }
            }
            if (Object.keys(c).length > 0) counts[m.id] = c;
          } catch {}
        })
      );
      if (Object.keys(counts).length > 0) setReactions(counts);
      if (Object.keys(mine).length > 0) setMyReactions(mine);
    } finally {
      setLoading(false);
    }
  }, [gameId, playerId]);

  // Supabase realtime callbacks for chat events
  const handleSupabaseNewMessage = useCallback((payload: { message: ChatMessage }) => {
    const m = payload?.message;
    if (!m) return;
    // Skip if this is our own message (already handled optimistically in handleSendMessage)
    if (playerId && m.senderId === playerId) return;
    setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]));
  }, [playerId]);

  const handleSupabaseReaction = useCallback((payload: { messageId: string; emoji: string; userId: string }) => {
    if (!payload?.messageId || !payload?.emoji) return;
    // Skip if this is our own reaction (already handled optimistically)
    if (playerId && payload.userId === playerId) return;
    setReactions(prev => {
      const current = { ...(prev[payload.messageId] || {}) };
      current[payload.emoji] = (current[payload.emoji] || 0) + 1;
      return { ...prev, [payload.messageId]: current };
    });
  }, [playerId]);

  const handleSupabaseReactionRemoved = useCallback((payload: { messageId: string; emoji: string; userId: string }) => {
    if (!payload?.messageId || !payload?.emoji) return;
    // Skip if this is our own reaction removal (already handled optimistically)
    if (playerId && payload.userId === playerId) return;
    setReactions(prev => {
      const current = { ...(prev[payload.messageId] || {}) };
      if (current[payload.emoji] && current[payload.emoji] > 0) {
        current[payload.emoji] = current[payload.emoji] - 1;
        if (current[payload.emoji] <= 0) {
          delete current[payload.emoji];
        }
      }
      return { ...prev, [payload.messageId]: current };
    });
  }, [playerId]);

  const handleSupabaseModerated = useCallback((payload: { messageId: string; hidden: boolean; moderatorId: string }) => {
    if (!payload?.messageId) return;
    setMessages(prev => 
      prev.map(m => m.id === payload.messageId 
        ? { ...m, isModerated: payload.hidden, moderatorId: payload.moderatorId } 
        : m
      )
    );
  }, []);

  const handleSupabaseDeleted = useCallback((payload: { messageId: string; deletedBy: string }) => {
    if (!payload?.messageId) return;
    // Skip if this is our own deletion (already handled optimistically)
    if (playerId && payload.deletedBy === playerId) return;
    setMessages(prev => prev.filter(m => m.id !== payload.messageId));
    // Clean up reactions for deleted message
    setReactions(prev => {
      const next = { ...prev };
      delete next[payload.messageId];
      return next;
    });
    setMyReactions(prev => {
      const next = { ...prev };
      delete next[payload.messageId];
      return next;
    });
  }, [playerId]);

  // Subscribe to Supabase realtime chat events
  useSupabaseChatRealtime(
    gameId,
    {
      onNewMessage: handleSupabaseNewMessage,
      onReaction: handleSupabaseReaction,
      onReactionRemoved: handleSupabaseReactionRemoved,
      onModerated: handleSupabaseModerated,
      onDeleted: handleSupabaseDeleted,
    }
  );

  useEffect(() => {
    fetchMessages();
  }, [gameId, fetchMessages]);

  useEffect(() => { setMuted(loadMuted()); }, []);

  const setMutedFor = (senderId: string, name: string | null) => {
    setMuted(prev => {
      const next = { ...prev };
      if (name === null) delete next[senderId];
      else next[senderId] = name;
      try { localStorage.setItem(MUTED_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const canMute = (m: ChatMessage) => !!playerId && m.senderId !== playerId && m.senderId !== directorId;
  const isMuted = (senderId: string) => senderId in muted && senderId !== directorId && senderId !== playerId;
  const visibleMessages = messages.filter(m => !isMuted(m.senderId));
  const hiddenCount = messages.length - visibleMessages.length;
  const mutedHere = Object.entries(muted).filter(([id]) => isMuted(id));

  const handleSendMessage = async () => {
    const text = input.trim();
    if (!text) return;
    try {
      setLoading(true);
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        // The server sends as the signed-in user; senderId only has to match it
        body: JSON.stringify({ roomId: gameId, senderId: playerId || undefined, message: text }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        // A missing permission (for example chat turned off for this user) is shown, not just logged
        if (e?.code === 'PERMISSION_DENIED' || e?.code === 'LIMIT_REACHED') setSendError(e.error);
        throw new Error(e?.error || 'Failed to send');
      }
      const created = await res.json();
      setSendError(null);
      setInput('');
      // Optimistic append
      setMessages(prev => [...prev, created as ChatMessage]);
  // Server API broadcasts to the room; no client emit needed
    } catch (err) {
      // minimal: log only
      // eslint-disable-next-line no-console
      console.error('Send failed', err);
    } finally {
      setLoading(false);
    }
  };

  const reactTo = async (messageId: string, emoji: string) => {
    if (!playerId) return; // require identity for reactions
    setReacting(messageId);
    try {
      const already = !!myReactions[messageId]?.[emoji];
      // Optimistic update
      if (already) {
        setReactions(prev => {
          const current = { ...(prev[messageId] || {}) };
          if (current[emoji] && current[emoji] > 0) {
            current[emoji] = current[emoji] - 1;
            if (current[emoji] <= 0) delete current[emoji];
          }
          return { ...prev, [messageId]: current };
        });
        setMyReactions(prev => {
          const mine = { ...(prev[messageId] || {}) };
          if (mine[emoji]) delete mine[emoji];
          return { ...prev, [messageId]: mine };
        });
        const res = await fetch('/api/chat/reactions/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ messageId, userId: playerId, emoji }),
        });
        if (!res.ok) {
          // Revert on failure by refreshing counts
          const r = await fetch(`/api/chat/reactions/list?messageId=${encodeURIComponent(messageId)}`);
          const rj = await r.json();
          const c: Record<string, number> = {};
          for (const rec of rj.items || []) c[rec.emoji] = (c[rec.emoji] || 0) + 1;
          setReactions(prev => ({ ...prev, [messageId]: c }));
          // Recompute myReactions for this message
          const mine: Record<string, boolean> = {};
          for (const rec of rj.items || []) if (rec.userId === playerId) mine[rec.emoji] = true;
          setMyReactions(prev => ({ ...prev, [messageId]: mine }));
          const e = await res.json().catch(() => ({}));
          throw new Error(e?.error || 'Failed to remove reaction');
        }
      } else {
        setReactions(prev => {
          const current = { ...(prev[messageId] || {}) };
          current[emoji] = (current[emoji] || 0) + 1;
          return { ...prev, [messageId]: current };
        });
        setMyReactions(prev => ({
          ...prev,
          [messageId]: { ...(prev[messageId] || {}), [emoji]: true }
        }));
        const res = await fetch('/api/chat/reactions/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ messageId, userId: playerId, emoji }),
        });
        if (!res.ok) {
          // Revert on failure by refreshing counts
          const r = await fetch(`/api/chat/reactions/list?messageId=${encodeURIComponent(messageId)}`);
          const rj = await r.json();
          const c: Record<string, number> = {};
          for (const rec of rj.items || []) c[rec.emoji] = (c[rec.emoji] || 0) + 1;
          setReactions(prev => ({ ...prev, [messageId]: c }));
          const mine: Record<string, boolean> = {};
          for (const rec of rj.items || []) if (rec.userId === playerId) mine[rec.emoji] = true;
          setMyReactions(prev => ({ ...prev, [messageId]: mine }));
          const e = await res.json().catch(() => ({}));
          throw new Error(e?.error || 'Failed to react');
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Reaction failed', err);
    } finally {
      setReacting(null);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!playerId) return;
    setDeleting(messageId);
    try {
      // Store the original index and message for potential revert
      const originalIndex = messages.findIndex(m => m.id === messageId);
      const messageToDelete = originalIndex >= 0 ? messages[originalIndex] : null;
      
      // Optimistic removal
      setMessages(prev => prev.filter(m => m.id !== messageId));
      setReactions(prev => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      setMyReactions(prev => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });

      // Get auth token for admin authorization check
      const authToken = getStoredAuthToken();
      
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const res = await fetch('/api/chat/delete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ messageId, userId: playerId }),
      });

      if (!res.ok) {
        // Revert on failure - restore at original position
        if (messageToDelete && originalIndex >= 0) {
          setMessages(prev => {
            const restored = [...prev];
            // Insert at original position, clamped to array bounds
            const insertIndex = Math.min(originalIndex, restored.length);
            restored.splice(insertIndex, 0, messageToDelete);
            return restored;
          });
        }
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || 'Failed to delete');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Delete failed', err);
    } finally {
      setDeleting(null);
    }
  };

  // Check if user can delete a message (own message or admin)
  const canDeleteMessage = useCallback((message: ChatMessage): boolean => {
    if (!playerId) return false;
    return message.senderId === playerId || isAdmin;
  }, [playerId, isAdmin]);

  return (
    <div className="chat-panel">
      <h2 className="section-title mb-3">Chat</h2>
      <div className="messages space-y-2 max-h-80 overflow-auto p-1">
        {visibleMessages.map((m) => (
          <div key={m.id} className="message group relative">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-gray-700 dark:text-gray-200">
                {m.senderId === playerId ? 'You' : m.senderName || 'Player'}
              </span>
              {m.senderId === directorId && (
                <span className="rounded-sm bg-indigo-100 px-1 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">Director</span>
              )}
              {canMute(m) && (
                <button
                  type="button"
                  onClick={() => setMutedFor(m.senderId, m.senderName || 'Player')}
                  className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                  title="Hide this player's messages from you"
                >
                  Mute
                </button>
              )}
            </div>
            <div className="text-sm text-gray-900 dark:text-gray-100">{m.message}</div>
            <div className="flex items-center gap-2 mt-1">
        {emojis.map((e) => (
                <button
                  key={e}
                  aria-label={`React ${e}`}
                  disabled={!playerId || reacting === m.id}
                  onClick={() => reactTo(m.id, e)}
          className={`text-base hover:scale-110 transition ${myReactions[m.id]?.[e] ? 'opacity-100' : 'opacity-60'}`}
          title={playerId ? (myReactions[m.id]?.[e] ? `Remove ${e}` : `React ${e}`) : 'Login to react'}
                >
                  {e}
                </button>
              ))}
              {canDeleteMessage(m) && (
                <button
                  aria-label="Delete message"
                  disabled={deleting === m.id}
                  onClick={() => handleDeleteMessage(m.id)}
                  className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
                  title={m.senderId === playerId ? 'Delete your message' : 'Delete message (Admin)'}
                >
                  {deleting === m.id ? '...' : '🗑️'}
                </button>
              )}
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {Object.entries(reactions[m.id] || {}).map(([e, c]) => (
                  <span key={e} className="mr-2">{e} {c}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <div className="flex min-h-[64px] items-center justify-center text-sm text-gray-500 dark:text-gray-400">No messages yet.</div>
        )}
        {hiddenCount > 0 && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {hiddenCount === 1 ? '1 message' : `${hiddenCount} messages`} from muted players hidden
          </div>
        )}
      </div>
      {mutedHere.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300" aria-label="Muted players">
          <span>Muted:</span>
          {mutedHere.map(([id, name]) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-sm bg-gray-100 px-2 py-0.5 dark:bg-gray-700">
              {name}
              <button
                type="button"
                onClick={() => setMutedFor(id, null)}
                className="text-blue-600 hover:underline dark:text-blue-400"
                aria-label={`Unmute ${name}`}
              >
                Unmute
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="chat-input mt-3 flex gap-2">
        <input
          type="text"
          placeholder={playerId ? 'Type a message...' : 'Login to chat'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading || !playerId}
          className="input flex-1"
        />
        <button
          onClick={handleSendMessage}
          disabled={loading || !playerId || !input.trim()}
          className="btn btn-primary"
        >
          Send
        </button>
      </div>
      {sendError && (
        <div className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">{sendError}</div>
      )}
    </div>
  );
}

// Use memo to prevent unnecessary re-renders
export default memo(ChatPanel);
