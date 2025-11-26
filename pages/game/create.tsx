import { useMemo, useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { tournamentPresets } from '../../src/lib/tournament/tournament-utils';
import type { TournamentConfig } from '../../src/types/tournament';

type Variant = 'texas-holdem' | 'omaha' | 'omaha-hi-lo' | 'seven-card-stud' | 'seven-card-stud-hi-lo' | 'five-card-stud' | 'dealers-choice';
type BettingMode = 'no-limit' | 'pot-limit';

export default function CreateGameRoomPage() {
  const router = useRouter();
  const [name, setName] = useState('New Table');
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [smallBlind, setSmallBlind] = useState(1);
  const [bigBlind, setBigBlind] = useState(2);
  const [variant, setVariant] = useState<Variant>('texas-holdem');
  const [bettingMode, setBettingMode] = useState<BettingMode>('no-limit');
  const [numberOfRebuys, setNumberOfRebuys] = useState<'unlimited' | number>('unlimited');
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enableTournament, setEnableTournament] = useState(false);
  const [presetKey, setPresetKey] = useState<string>('freezeout_default');
  const presetOptions = useMemo(() => Object.entries(tournamentPresets), []);
  const selectedTournamentConfig: TournamentConfig | null = useMemo(() => enableTournament ? tournamentPresets[presetKey]?.build() : null, [enableTournament, presetKey]);

  // On mount, determine if user is authenticated (token present)
  useEffect(() => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      setIsAuthenticated(!!token);
      if (!token) {
        setError('You must sign in to create a room.');
      }
    } catch {}
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    
    try {
      // Basic client-side validation for blinds
      if (!Number.isFinite(smallBlind) || smallBlind < 0.01) {
        setError('Small blind must be at least 0.01');
        setSubmitting(false);
        return;
      }
      if (!Number.isFinite(bigBlind) || bigBlind < Math.max(0.02, smallBlind * 2)) {
        setError(`Big blind must be at least 2× the small blind (${(smallBlind * 2).toFixed(2)})`);
        setSubmitting(false);
        return;
      }

      console.log('Creating game room...');
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      if (!token) {
        throw new Error('You must be signed in to create a room');
      }
      const res = await fetch('/api/games/rooms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          name,
          gameType: 'poker',
          maxPlayers,
          blindLevels: { sb: smallBlind, bb: bigBlind },
          configuration: {
            variant,
            bettingMode,
            numberOfRebuys: numberOfRebuys === 'unlimited' ? 'unlimited' : Number(numberOfRebuys),
            tournament: enableTournament ? { preset: presetKey, config: selectedTournamentConfig } : undefined,
          },
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to create room (${res.status})`);
      }

      const room = await res.json();
      console.log('Room created successfully:', room);
      console.log('Room ID:', room.id);
      console.log('Navigating to:', `/game/${room.id}`);
      
      // Set navigation state for user feedback
      setIsNavigating(true);
      
      // Check if router is available
      if (!router) {
        console.error('Router not available, using window.location');
        if (typeof window !== 'undefined') {
          window.location.href = `/game/${room.id}`;
        }
        return;
      }
      
      // Add a small delay to ensure the room is fully created
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Try multiple navigation approaches
      const navigationTarget = `/game/${room.id}`;
      let navigationSuccessful = false;
      
      // Method 1: Try router.push with timeout
      try {
        console.log('Attempting router.push...');
        
        // Set up a timeout for navigation
        const navigationPromise = router.push(navigationTarget);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Navigation timeout')), 3000);
        });
        
        await Promise.race([navigationPromise, timeoutPromise]);
        
        // Wait a bit to see if navigation actually happened
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Check if navigation was successful
        if (typeof window !== 'undefined') {
          const currentPath = window.location.pathname;
          console.log('Current path after router.push:', currentPath);
          
          if (currentPath === navigationTarget) {
            console.log('✅ Navigation successful via router.push');
            navigationSuccessful = true;
          }
        }
      } catch (navError) {
        console.warn('Router.push failed or timed out:', navError);
      }
      
      // Method 2: Fallback to window.location if router.push didn't work
      if (!navigationSuccessful && typeof window !== 'undefined') {
        console.log('🔄 Using window.location fallback...');
        window.location.href = navigationTarget;
        navigationSuccessful = true;
      }
      
      // Method 3: Final fallback - reload with new URL
      if (!navigationSuccessful && typeof window !== 'undefined') {
        console.log('🔄 Using window.location.replace fallback...');
        window.location.replace(navigationTarget);
      }
    } catch (err: any) {
      console.error('Room creation error:', err);
      setError(err?.message || 'Failed to create room');
    } finally {
      setSubmitting(false);
      setIsNavigating(false);
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
              min={0.01}
              step={0.01}
              value={smallBlind}
              onChange={e => setSmallBlind(parseFloat(e.target.value || '0'))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Big blind</label>
            <input
              type="number"
              className="border border-gray-300 dark:border-gray-600 rounded p-2 w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              min={Math.max(0.02, Number((smallBlind * 2).toFixed(2)))}
              step={0.01}
              value={bigBlind}
              onChange={e => setBigBlind(parseFloat(e.target.value || '0'))}
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
              <option value="seven-card-stud">Seven-Card Stud</option>
              <option value="seven-card-stud-hi-lo">Seven-Card Stud Hi-Lo (8 or Better)</option>
              <option value="five-card-stud">Five-Card Stud</option>
              <option value="dealers-choice">Dealer&apos;s Choice (dealer selects each hand)</option>
            </select>
            {variant === 'dealers-choice' && (
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                The dealer will choose the variant before each hand. Betting mode will adapt to the chosen variant (Omaha variants default to Pot-Limit).
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium">Betting mode</label>
            <select
              className="border border-gray-300 dark:border-gray-600 rounded p-2 w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={bettingMode}
              onChange={e => setBettingMode(e.target.value as BettingMode)}
              disabled={variant === 'dealers-choice'}
            >
              <option value="no-limit">No Limit</option>
              <option value="pot-limit">Pot Limit</option>
            </select>
            {variant === 'dealers-choice' && (
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">Betting mode is determined by the dealer’s selected variant.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium">Number of Rebuys</label>
            <select
              className="border border-gray-300 dark:border-gray-600 rounded p-2 w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={numberOfRebuys === 'unlimited' ? 'unlimited' : String(numberOfRebuys)}
              onChange={(e) => {
                const value = e.target.value;
                setNumberOfRebuys(value === 'unlimited' ? 'unlimited' : parseInt(value, 10));
              }}
            >
              <option value="unlimited">Unlimited</option>
              {Array.from({ length: 11 }).map((_, idx) => (
                <option key={idx} value={idx}>{idx}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">Set 0-10 or leave as Unlimited for cash-style games.</p>
          </div>
          {/* Removed Require unanimous RIT consent checkbox per request */}
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
              <div className="bg-gray-50 dark:bg-gray-700 rounded p-3 text-sm">
                <div className="font-semibold mb-1 text-gray-900 dark:text-gray-100">Preview</div>
                {selectedTournamentConfig ? (
                  <ul className="list-disc pl-5 space-y-1 text-gray-700 dark:text-gray-300">
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
                  <p className="text-gray-600 dark:text-gray-400">Select a preset to preview configuration.</p>
                )}
              </div>
            </div>
          )}
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50" disabled={submitting || isNavigating || !isAuthenticated}>
          {isNavigating ? 'Joining room...' : submitting ? 'Creating…' : 'Create room'}
        </button>
        {!isAuthenticated && (
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">Sign in to create a game room.</p>
        )}
        {isNavigating && (
          <p className="text-blue-600 text-sm mt-2 animate-pulse">
            ✨ Room created successfully! Taking you to the game...
          </p>
        )}
      </form>
    </div>
  );
}
