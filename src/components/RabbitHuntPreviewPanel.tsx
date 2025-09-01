import React, { useCallback, useEffect, useMemo, useState } from 'react';

type Street = 'flop' | 'turn' | 'river';

interface PreviewResult {
  street: Street;
  revealedCards: string[];
  remainingDeck: string[];
}

interface Props {
  roomId: string;
}

/**
 * UI panel to trigger Rabbit Hunt previews against the secured API and render results.
 * Requires a userId (used by the API for auth/permissions) and a target street.
 */
export default function RabbitHuntPreviewPanel({ roomId }: Props) {
  const [userId, setUserId] = useState('');
  const [street, setStreet] = useState<Street>('flop');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);

  // Load a remembered userId if present
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('table.userId');
      if (saved) setUserId(saved);
    } catch {}
  }, []);

  // Persist userId for convenience
  useEffect(() => {
    try {
      if (userId) window.localStorage.setItem('table.userId', userId);
    } catch {}
  }, [userId]);

  const canSubmit = useMemo(() => !!roomId && !!street && !!userId && !loading, [roomId, street, userId, loading]);

  const onPreview = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const qs = new URLSearchParams({ roomId, street, userId }).toString();
      const res = await fetch(`/api/rabbit-hunt/preview?${qs}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      setResult(data as PreviewResult);
    } catch (e: any) {
      setError(e?.message || 'Failed to preview');
    } finally {
      setLoading(false);
    }
  }, [canSubmit, roomId, street, userId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Rabbit Hunt Preview</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex flex-col">
          <label className="text-sm text-gray-600 mb-1" htmlFor="userId">User ID</label>
          <input
            id="userId"
            className="border rounded px-3 py-2 focus:outline-none focus:ring w-full"
            placeholder="enter your user id"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">Used for auth/permissions.</p>
        </div>

        <div className="flex flex-col">
          <label className="text-sm text-gray-600 mb-1" htmlFor="street">Street</label>
          <select
            id="street"
            className="border rounded px-3 py-2 focus:outline-none focus:ring w-full"
            value={street}
            onChange={(e) => setStreet(e.target.value as Street)}
          >
            <option value="flop">Flop</option>
            <option value="turn">Turn</option>
            <option value="river">River</option>
          </select>
        </div>

        <div className="flex items-end">
          <button
            onClick={onPreview}
            disabled={!canSubmit}
            className={`w-full md:w-auto bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {loading ? 'Previewing…' : 'Preview'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-red-600 text-sm">{error}</div>
      )}

      {result && (
        <div className="bg-gray-50 border rounded p-4">
          <div className="mb-3">
            <span className="text-sm text-gray-600">Street:</span>
            <span className="ml-2 font-medium">{result.street}</span>
          </div>
          <div className="mb-3">
            <h3 className="font-semibold mb-1">Revealed Cards</h3>
            {result.revealedCards.length === 0 ? (
              <p className="text-sm text-gray-500">None</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {result.revealedCards.map((c, i) => (
                  <span key={`${c}-${i}`} className="inline-block bg-white border rounded px-2 py-1 text-sm">{c}</span>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="font-semibold mb-1">Remaining Deck</h3>
            {result.remainingDeck.length === 0 ? (
              <p className="text-sm text-gray-500">No cards</p>
            ) : (
              <div className="grid grid-cols-8 gap-1 text-sm">
                {result.remainingDeck.map((c, i) => (
                  <span key={`${c}-${i}`} className="inline-block bg-white border rounded px-2 py-1 text-center">{c}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
