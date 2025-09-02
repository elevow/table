import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

type Variant = 'texas-holdem' | 'omaha' | 'omaha-hi-lo';
type BettingMode = 'no-limit' | 'pot-limit';

export default function CreateGameRoomPage() {
  const router = useRouter();
  const [name, setName] = useState('New Table');
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [smallBlind, setSmallBlind] = useState(1);
  const [bigBlind, setBigBlind] = useState(2);
  const [variant, setVariant] = useState<Variant>('texas-holdem');
  const [bettingMode, setBettingMode] = useState<BettingMode>('no-limit');
  const [requireRitUnanimous, setRequireRitUnanimous] = useState(false);
  const [createdBy, setCreatedBy] = useState('u1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/games/rooms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          gameType: 'poker',
          maxPlayers,
          blindLevels: { sb: smallBlind, bb: bigBlind },
          createdBy,
          configuration: {
            variant,
            bettingMode,
            requireRunItTwiceUnanimous: requireRitUnanimous,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to create room (${res.status})`);
      }
      const room = await res.json();
      // navigate to the dynamic game route; this repo uses /game/[id]
      await router.push(`/game/${room.id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to create room');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto p-6">
      <Head>
        <title>Create Game Room</title>
      </Head>
      <h1 className="text-2xl font-semibold mb-4">Create Game Room</h1>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="block text-sm font-medium">Table name</label>
          <input className="border p-2 w-full" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium">Max players</label>
            <input type="number" className="border p-2 w-full" min={2} max={9} value={maxPlayers} onChange={e => setMaxPlayers(parseInt(e.target.value || '0', 10))} />
          </div>
          <div>
            <label className="block text-sm font-medium">Small blind</label>
            <input type="number" className="border p-2 w-full" min={1} value={smallBlind} onChange={e => setSmallBlind(parseInt(e.target.value || '0', 10))} />
          </div>
          <div>
            <label className="block text-sm font-medium">Big blind</label>
            <input type="number" className="border p-2 w-full" min={2} value={bigBlind} onChange={e => setBigBlind(parseInt(e.target.value || '0', 10))} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium">Variant</label>
            <select className="border p-2 w-full" value={variant} onChange={e => setVariant(e.target.value as Variant)}>
              <option value="texas-holdem">Texas Hold&apos;em</option>
              <option value="omaha">Omaha</option>
              <option value="omaha-hi-lo">Omaha Hi-Lo (8 or Better)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium">Betting mode</label>
            <select className="border p-2 w-full" value={bettingMode} onChange={e => setBettingMode(e.target.value as BettingMode)}>
              <option value="no-limit">No Limit</option>
              <option value="pot-limit">Pot Limit</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center space-x-2">
              <input type="checkbox" checked={requireRitUnanimous} onChange={e => setRequireRitUnanimous(e.target.checked)} />
              <span className="text-sm">Require unanimous RIT consent</span>
            </label>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium">Created by (user id)</label>
          <input className="border p-2 w-full" value={createdBy} onChange={e => setCreatedBy(e.target.value)} />
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create room'}
        </button>
      </form>
    </div>
  );
}
