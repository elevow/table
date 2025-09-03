import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { InvitesList, RelationshipBadge } from '../src/components';
import { fetchRelationshipStatus } from '../src/services/friends-ui';
import { FriendRelationshipStatus } from '../src/types/friend';

export default function FriendsDemo() {
  // For demo purposes we use hard-coded IDs; wire to your auth/user context as needed
  const [me] = useState<string>('u-1');
  const [peer, setPeer] = useState<string>('u-2');
  const [status, setStatus] = useState<FriendRelationshipStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    setError(null);
    fetchRelationshipStatus(me, peer, ctl.signal)
      .then(setStatus)
      .catch(e => setError(e?.message || 'Failed to load status'));
    return () => ctl.abort();
  }, [me, peer]);

  return (
    <>
      <Head>
        <title>Friends & Invites</title>
      </Head>
      <main className="mx-auto max-w-3xl p-4">
        <h1 className="mb-4 text-xl font-semibold">Friends & Invites</h1>
        <section className="mb-6 rounded border p-4">
          <h2 className="mb-2 text-lg font-medium">Relationship</h2>
          <div className="flex items-center gap-3">
            <input value={peer} onChange={e => setPeer(e.target.value)} placeholder="Peer userId" className="rounded border px-2 py-1 text-sm" />
            <RelationshipBadge status={status || undefined} />
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        </section>
        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded border p-4">
            <h2 className="mb-2 text-lg font-medium">Incoming invites</h2>
            <InvitesList userId={me} kind="incoming" />
          </div>
          <div className="rounded border p-4">
            <h2 className="mb-2 text-lg font-medium">Outgoing invites</h2>
            <InvitesList userId={me} kind="outgoing" />
          </div>
        </section>
      </main>
    </>
  );
}
