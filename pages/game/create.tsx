import { useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { tournamentPresets } from '../../src/lib/tournament/tournament-utils';
import type { TournamentConfig } from '../../src/types/tournament';

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
  const [enableTournament, setEnableTournament] = useState(false);
  const [presetKey, setPresetKey] = useState<string>('freezeout_default');
  const presetOptions = useMemo(() => Object.entries(tournamentPresets), []);
  const selectedTournamentConfig: TournamentConfig | null = useMemo(() => enableTournament ? tournamentPresets[presetKey]?.build() : null, [enableTournament, presetKey]);

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
    tournament: enableTournament ? { preset: presetKey, config: selectedTournamentConfig } : undefined,
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
          <input
            className="border border-gray-300 dark:border-gray-600 rounded p-2 w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium">Max players</label>
            <input
              type="number"
              className="border border-gray-300 dark:border-gray-600 rounded p-2 w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              min={2}
              max={9}
              value={maxPlayers}
              onChange={e => setMaxPlayers(parseInt(e.target.value || '0', 10))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Small blind</label>
            <input
              type="number"
              className="border border-gray-300 dark:border-gray-600 rounded p-2 w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              min={1}
              value={smallBlind}
              onChange={e => setSmallBlind(parseInt(e.target.value || '0', 10))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Big blind</label>
            <input
              type="number"
              className="border border-gray-300 dark:border-gray-600 rounded p-2 w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              min={2}
              value={bigBlind}
              onChange={e => setBigBlind(parseInt(e.target.value || '0', 10))}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium">Variant</label>
            <select
              className="border border-gray-300 dark:border-gray-600 rounded p-2 w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={variant}
              onChange={e => setVariant(e.target.value as Variant)}
            >
              <option value="texas-holdem">Texas Hold&apos;em</option>
              <option value="omaha">Omaha</option>
              <option value="omaha-hi-lo">Omaha Hi-Lo (8 or Better)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium">Betting mode</label>
            <select
              className="border border-gray-300 dark:border-gray-600 rounded p-2 w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={bettingMode}
              onChange={e => setBettingMode(e.target.value as BettingMode)}
            >
              <option value="no-limit">No Limit</option>
              <option value="pot-limit">Pot Limit</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center space-x-2">
              <input
                type="checkbox"
                className="w-4 h-4 accent-blue-600 dark:accent-blue-500"
                checked={requireRitUnanimous}
                onChange={e => setRequireRitUnanimous(e.target.checked)}
              />
              <span className="text-sm">Require unanimous RIT consent</span>
            </label>
          </div>
        </div>
        <div className="border-t pt-4 space-y-3">
          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              className="w-4 h-4 accent-blue-600 dark:accent-blue-500"
              checked={enableTournament}
              onChange={e => setEnableTournament(e.target.checked)}
            />
            <span className="text-sm font-medium">Enable tournament structure</span>
          </label>
          {enableTournament && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium">Preset</label>
                <select
                  className="border border-gray-300 dark:border-gray-600 rounded p-2 w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={presetKey}
                  onChange={e => setPresetKey(e.target.value)}
                >
                  {presetOptions.map(([key, p]) => (
                    <option key={key} value={key}>{p.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-600 mt-1">{tournamentPresets[presetKey]?.description}</p>
              </div>
              <div className="bg-gray-50 rounded p-3 text-sm">
                <div className="font-semibold mb-1">Preview</div>
                {selectedTournamentConfig ? (
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Type: {selectedTournamentConfig.type}</li>
                    <li>Starting stack: {selectedTournamentConfig.startingStack.toLocaleString()}</li>
                    <li>Levels: {selectedTournamentConfig.blindLevels.length} ({selectedTournamentConfig.blindLevels[0].durationMinutes} min)</li>
                    <li>Late reg: {selectedTournamentConfig.lateRegistration.enabled ? `until L${selectedTournamentConfig.lateRegistration.endLevel}` : 'disabled'}</li>
                    {selectedTournamentConfig.rebuys?.enabled && (
                      <li>Rebuys: up to {selectedTournamentConfig.rebuys.maxPerPlayer ?? '∞'} until L{selectedTournamentConfig.rebuys.availableUntilLevel}</li>
                    )}
                    {selectedTournamentConfig.addOn?.enabled && (
                      <li>Add-on at break after L{selectedTournamentConfig.addOn.availableAtBreakAfterLevel}</li>
                    )}
                  </ul>
                ) : (
                  <p className="text-gray-600">Select a preset to preview configuration.</p>
                )}
              </div>
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium">Created by (user id)</label>
          <input
            className="border border-gray-300 dark:border-gray-600 rounded p-2 w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={createdBy}
            onChange={e => setCreatedBy(e.target.value)}
          />
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create room'}
        </button>
      </form>
    </div>
  );
}
