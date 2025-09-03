import React, { useEffect, useMemo, useState } from 'react';
import { FriendInviteRecord, Paginated } from '../types/friend';
import { fetchInvites, respondToInvite } from '../services/friends-ui';
import { getSocket } from '../lib/clientSocket';

type Props = {
  userId: string;
  kind?: 'incoming' | 'outgoing';
  page?: number;
  limit?: number;
};

export default function InvitesList({ userId, kind = 'incoming', page = 1, limit = 10 }: Props) {
  const [data, setData] = useState<Paginated<FriendInviteRecord> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    fetchInvites(userId, kind, page, limit, ctl.signal)
      .then(setData)
      .catch(e => setError(e?.message || 'Failed to load invites'))
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [userId, kind, page, limit]);

  // Realtime: join personal room and listen for invites updates
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !userId) return;

    const onCreated = ({ invite }: { invite: FriendInviteRecord }) => {
      // Only update if relevant to this list type
      const relevant = kind === 'incoming' ? invite.inviteeId === userId : invite.inviterId === userId;
      if (!relevant) return;
      setData(prev => {
        if (!prev) return prev;
        const exists = prev.items.some(i => i.id === invite.id);
        const items = exists ? prev.items.map(i => (i.id === invite.id ? invite : i)) : [invite, ...prev.items];
        return { ...prev, items };
      });
    };

    const onUpdated = ({ invite }: { invite: FriendInviteRecord }) => {
      const relevant = kind === 'incoming' ? invite.inviteeId === userId : invite.inviterId === userId;
      if (!relevant) return;
      setData(prev => (prev ? { ...prev, items: prev.items.map(i => (i.id === invite.id ? invite : i)) } : prev));
    };

    // Ensure we are in our personal room (server joins on gameplay, but friends page may be standalone)
    socket.emit('join_table', { tableId: `user:${userId}`, playerId: userId });
    socket.on('friends:invite_created', onCreated);
    socket.on('friends:invite_updated', onUpdated);

    return () => {
      socket.off('friends:invite_created', onCreated);
      socket.off('friends:invite_updated', onUpdated);
    };
  }, [userId, kind]);

  const items = useMemo(() => data?.items ?? [], [data]);

  const onRespond = async (id: string, action: 'accept' | 'decline') => {
    try {
      const updated = await respondToInvite(id, action);
      // optimistic local update
      setData(prev => prev ? { ...prev, items: prev.items.map(i => i.id === id ? updated : i) } : prev);
    } catch (e: any) {
      setError(e?.message || `Failed to ${action} invite`);
    }
  };

  if (loading && !data) return <div className="text-sm text-gray-500">Loading invites…</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!items.length) return <div className="text-sm text-gray-500">No {kind} invites.</div>;

  return (
    <div className="space-y-2">
      {items.map(inv => (
        <div key={inv.id} className="flex items-center justify-between rounded border border-gray-200 p-2">
          <div className="text-sm text-gray-800">
            <div>
              <span className="font-medium">Room:</span> {inv.roomId}
            </div>
            <div className="text-xs text-gray-500">
              {kind === 'incoming' ? `From: ${inv.inviterId}` : `To: ${inv.inviteeId}`} · Status: {inv.status}
            </div>
          </div>
          {kind === 'incoming' && inv.status === 'pending' ? (
            <div className="flex gap-2">
              <button onClick={() => onRespond(inv.id, 'accept')} className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700">Accept</button>
              <button onClick={() => onRespond(inv.id, 'decline')} className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-800 hover:bg-gray-300">Decline</button>
            </div>
          ) : (
            <span className="text-xs text-gray-500">{inv.status}</span>
          )}
        </div>
      ))}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>Page {data.page} of {data.totalPages}</span>
        </div>
      )}
    </div>
  );
}
