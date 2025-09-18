import { useEffect, useMemo, useState, memo, useCallback } from 'react';
import type { ChatMessage } from '../types/chat';

interface ChatPanelProps {
  gameId: string;
  playerId?: string;
}

function ChatPanel({ gameId, playerId }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [reacting, setReacting] = useState<string | null>(null); // messageId currently reacting to
  const [reactions, setReactions] = useState<Record<string, Record<string, number>>>({});
  // Track current user's reactions for toggle behavior: myReactions[messageId][emoji] = true
  const [myReactions, setMyReactions] = useState<Record<string, Record<string, boolean>>>({});
  const [socket, setSocket] = useState<any>(null);

  // lightweight emoji set for quick reactions
  const emojis = useMemo(() => ['👍', '❤️', '😂'], []);

  const fetchMessages = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/chat/room/list?roomId=${encodeURIComponent(gameId)}&limit=50`);
      const json = await res.json();
      const items = Array.isArray(json.items) ? (json.items as ChatMessage[]) : [];
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

  useEffect(() => {
    // Initialize socket connection (non-blocking)
    const initSocket = async () => {
      try {
        const { getSocket } = await import('../lib/clientSocket');
        const socketInstance = await getSocket();
        setSocket(socketInstance);
      } catch (error) {
        console.warn('Chat socket initialization failed, continuing without real-time chat:', error);
      }
    };
    
    // Don't block page load for socket initialization
    setTimeout(() => {
      initSocket();
    }, 200);
    
    fetchMessages();
  }, [gameId, fetchMessages]);

  useEffect(() => {
    if (!socket) return;
    
    const onNew = (payload: { message: ChatMessage }) => {
      // If this message belongs to this room, append if not already present
      const m = payload?.message;
      if (!m) return;
      setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]));
    };
    const onReact = (payload: { messageId: string; emoji: string; userId: string }) => {
      if (!payload?.messageId || !payload?.emoji) return;
      setReactions(prev => {
        const current = { ...(prev[payload.messageId] || {}) };
        current[payload.emoji] = (current[payload.emoji] || 0) + 1;
        return { ...prev, [payload.messageId]: current };
      });
      if (playerId && payload.userId === playerId) {
        setMyReactions(prev => ({
          ...prev,
          [payload.messageId]: { ...(prev[payload.messageId] || {}), [payload.emoji]: true }
        }));
      }
    };
    const onReactRemoved = (payload: { messageId: string; emoji: string; userId: string }) => {
      if (!payload?.messageId || !payload?.emoji) return;
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
      if (playerId && payload.userId === playerId) {
        setMyReactions(prev => {
          const mine = { ...(prev[payload.messageId] || {}) };
          if (mine[payload.emoji]) delete mine[payload.emoji];
          return { ...prev, [payload.messageId]: mine };
        });
      }
    };
    socket.on('chat:new_message', onNew);
    socket.on('chat:reaction', onReact);
    socket.on('chat:reaction_removed', onReactRemoved);
    return () => {
      socket.off('chat:new_message', onNew);
      socket.off('chat:reaction', onReact);
      socket.off('chat:reaction_removed', onReactRemoved);
    };
  }, [socket, playerId]);

  const handleSendMessage = async () => {
    const text = input.trim();
    if (!text) return;
    try {
      setLoading(true);
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: gameId, senderId: playerId || 'anon', message: text }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || 'Failed to send');
      }
      const created = await res.json();
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
          headers: { 'Content-Type': 'application/json' },
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
          headers: { 'Content-Type': 'application/json' },
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

  return (
    <div className="chat-panel">
      <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">Chat</h2>
      <div className="messages space-y-2 max-h-80 overflow-auto p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700">
        {messages.map((m) => (
          <div key={m.id} className="message">
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
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {Object.entries(reactions[m.id] || {}).map(([e, c]) => (
                  <span key={e} className="mr-2">{e} {c}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <div className="text-sm text-gray-500 dark:text-gray-400">No messages yet.</div>
        )}
      </div>
      <div className="chat-input mt-3 flex gap-2">
        <input
          type="text"
          placeholder={playerId ? 'Type a message...' : 'Login to chat'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading || !playerId}
          className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400"
        />
        <button
          onClick={handleSendMessage}
          disabled={loading || !playerId || !input.trim()}
          className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white px-3 py-1 rounded"
        >
          Send
        </button>
      </div>
    </div>
  );
}

// Use memo to prevent unnecessary re-renders
export default memo(ChatPanel);
