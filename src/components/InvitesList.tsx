import React, { useEffect, useMemo, useState } from 'react';
import { FriendInviteRecord, Paginated } from '../types/friend';
import { fetchInvites, respondToInvite } from '../services/friends-ui';

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

  // Poll for updates periodically (Socket.IO has been removed)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await fetchInvites(userId, kind, page, limit);
        setData(data);
      } catch (e) {
        // Silently ignore polling errors
      }
    }, 10000); // Poll every 10 seconds
    
    return () => clearInterval(interval);
  }, [userId, kind, page, limit]);

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
