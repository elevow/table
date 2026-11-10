import { useMemo, useState, useEffect } from 'react';
import {
  BASE_TURN_MS, DEFAULT_TIME_BANKS, DEFAULT_TIME_BANK_SECONDS, MAX_TIME_BANKS, MAX_TIME_BANK_SECONDS,
  MAX_TURN_SECONDS, MIN_TIME_BANK_SECONDS, MIN_TURN_SECONDS, clampSetting,
  DEFAULT_HAND_DELAY_SECONDS, MIN_HAND_DELAY_SECONDS, MAX_HAND_DELAY_SECONDS,
} from '../../src/lib/shared/turn-clock';

const DEFAULT_TURN_SECONDS = BASE_TURN_MS / 1000;
import Head from 'next/head';
import Link from 'next/link';
import AppShell, { PageHeader } from '../../src/components/AppShell';
import { useRouter } from 'next/router';
import type { BettingMode, MixedGameEntry } from '../../src/types/poker';
import MixedGameSetup from '../../src/components/MixedGameSetup';
import { defaultBettingModeForVariant } from '../../src/lib/game/variant-mapping';
import { DEFAULT_HANDS_PER_GAME, HORSE_GAMES } from '../../src/lib/poker/variant-rules';

type Variant = 'texas-holdem' | 'omaha' | 'omaha-hi-lo' | 'seven-card-stud' | 'seven-card-stud-hi-lo' | 'five-card-stud' | 'razz' | 'omaha-5' | 'dealers-choice' | 'mixed';

export default function CreateGameRoomPage() {
  const router = useRouter();
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  // Both assumed until permissions load; the API refuses either without the permission anyway
  const [canCreateRoom, setCanCreateRoom] = useState(true);
  const [canCreatePrivate, setCanCreatePrivate] = useState(true);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [smallBlind, setSmallBlind] = useState(1);
  const [bigBlind, setBigBlind] = useState(2);
  const [bigBlindManuallyUpdated, setBigBlindManuallyUpdated] = useState(false);
  const [variant, setVariant] = useState<Variant>('texas-holdem');
  const [bettingMode, setBettingMode] = useState<BettingMode>('no-limit');
  const [numberOfRebuys, setNumberOfRebuys] = useState<'unlimited' | number>('unlimited');
  const [rebuyAmount, setRebuyAmount] = useState(20);
  const [buyIn, setBuyIn] = useState(1000);
  const [allowRunItTwice, setAllowRunItTwice] = useState(false);
  const [showAllAtShowdown, setShowAllAtShowdown] = useState(false);
  const [turnTimeSeconds, setTurnTimeSeconds] = useState(DEFAULT_TURN_SECONDS);
  const [timeBanks, setTimeBanks] = useState(DEFAULT_TIME_BANKS);
  const [timeBankSeconds, setTimeBankSeconds] = useState(DEFAULT_TIME_BANK_SECONDS);
  const [handDelaySeconds, setHandDelaySeconds] = useState(DEFAULT_HAND_DELAY_SECONDS);
  // Table options that are off unless set: antes and the 7-2 bounty, in chips
  const [ante, setAnte] = useState(0);
  const [sevenDeuceBounty, setSevenDeuceBounty] = useState(0);
  // Mixed games: the rotation and how many hands each game lasts
  const [mixedGames, setMixedGames] = useState<MixedGameEntry[]>(HORSE_GAMES.map(g => ({ ...g })));
  const [handsPerGame, setHandsPerGame] = useState(DEFAULT_HANDS_PER_GAME);
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount, determine if user is authenticated (token present)
  useEffect(() => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      setIsAuthenticated(!!token);
      if (!token) {
        setError('You must sign in to create a room.');
        return;
      }
      fetch('/api/auth/check-admin', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (!data) return;
          setCanCreateRoom((data.permissions || []).includes('room.create'));
          const allowed = (data.permissions || []).includes('room.create_private');
          setCanCreatePrivate(allowed);
          if (!allowed) setVisibility('public');
        })
        .catch(() => {});
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

      if (variant === 'mixed' && mixedGames.length < 2) {
        setError('Choose at least two games for the mix');
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
          name: 'New Table',
          visibility,
          gameType: 'poker',
          maxPlayers,
          blindLevels: { sb: smallBlind, bb: bigBlind },
          configuration: {
            variant,
            bettingMode,
            numberOfRebuys: numberOfRebuys === 'unlimited' ? 'unlimited' : Number(numberOfRebuys),
            rebuyAmount: numberOfRebuys !== 0 ? rebuyAmount : undefined,
            buyIn,
            allowRunItTwice,
            showAllAtShowdown,
            turnTimeSeconds: clampSetting(turnTimeSeconds, MIN_TURN_SECONDS, MAX_TURN_SECONDS, DEFAULT_TURN_SECONDS),
            timeBanks: clampSetting(timeBanks, 0, MAX_TIME_BANKS, DEFAULT_TIME_BANKS),
            timeBankSeconds: clampSetting(timeBankSeconds, MIN_TIME_BANK_SECONDS, MAX_TIME_BANK_SECONDS, DEFAULT_TIME_BANK_SECONDS),
            handDelaySeconds: clampSetting(handDelaySeconds, MIN_HAND_DELAY_SECONDS, MAX_HAND_DELAY_SECONDS, DEFAULT_HAND_DELAY_SECONDS),
            ante: ante > 0 ? ante : undefined,
            sevenDeuceBounty: sevenDeuceBounty > 0 ? sevenDeuceBounty : undefined,
            mixedGames: variant === 'mixed' ? mixedGames : undefined,
            handsPerGame: variant === 'mixed' ? handsPerGame : undefined,
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

  // Reached by typing the URL or from an old link: say why instead of showing a form that will be refused
  if (!canCreateRoom) {
    return (
      <AppShell>
      <main className="page-narrow">
        <Head>
          <title>Create a table - Table</title>
        </Head>
        <PageHeader title="Create a table" />
        <div className="surface p-6">
          <p role="alert" className="mb-4 text-gray-700 dark:text-gray-300">
            Your account can&apos;t create rooms. Ask an admin if you&apos;d like to host games.
          </p>
          <Link href="/dashboard" className="link text-sm">
            Back to the dashboard
          </Link>
        </div>
      </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
    <main className="page-narrow">
      <Head>
        <title>Create a table - Table</title>
      </Head>
      <PageHeader title="Create a table" subtitle="Pick the game and stakes. You can invite people once the table is open." />
      <form className="space-y-5" onSubmit={onSubmit}>
        <section className="surface p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="section-title">Who can join</h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Public tables show up in the lobby. Private tables need an invite link.</p>
          </div>
          <fieldset aria-label="Visibility">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${visibility === 'public' ? 'border-emerald-500/60 bg-emerald-50 dark:bg-emerald-400/6' : 'border-gray-200 hover:border-gray-300 dark:border-white/10 dark:hover:border-white/20'}`}>
                <input type="radio" name="visibility" className="radio mt-0.5" checked={visibility === 'public'} onChange={() => setVisibility('public')} />
                <span>
                  <span className="block text-sm font-medium text-gray-900 dark:text-white">Public</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">Listed in the lobby for anyone to join</span>
                </span>
              </label>
              <label className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${canCreatePrivate ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'} ${visibility === 'private' ? 'border-emerald-500/60 bg-emerald-50 dark:bg-emerald-400/6' : 'border-gray-200 hover:border-gray-300 dark:border-white/10 dark:hover:border-white/20'}`}>
                <input
                  type="radio"
                  name="visibility"
                  className="radio mt-0.5"
                  checked={visibility === 'private'}
                  disabled={!canCreatePrivate}
                  onChange={() => setVisibility('private')}
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900 dark:text-white">Private</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">Only people with the invite link</span>
                </span>
              </label>
            </div>
            {!canCreatePrivate && (
              <p className="hint">Your account can&apos;t create private tables.</p>
            )}
          </fieldset>
        </section>
        <section className="surface p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="section-title">Game and stakes</h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">The variant, how betting works, and what everyone sits down with.</p>
          </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Variant</label>
            <select
              className="input"
              value={variant}
              onChange={e => {
                const next = e.target.value as Variant;
                setVariant(next);
                // Start from the usual betting for the game (Omaha pot limit, Razz fixed limit)
                if (next !== 'dealers-choice' && next !== 'mixed') setBettingMode(defaultBettingModeForVariant(next));
              }}
            >
              <option value="texas-holdem">Texas Hold&apos;em</option>
              <option value="omaha">Omaha</option>
              <option value="omaha-hi-lo">Omaha Hi-Lo (8 or Better)</option>
              <option value="seven-card-stud">Seven-Card Stud</option>
              <option value="seven-card-stud-hi-lo">Seven-Card Stud Hi-Lo (8 or Better)</option>
              <option value="five-card-stud">Five-Card Stud</option>
              <option value="razz">Razz (Seven-Card Stud, lowest hand wins)</option>
              <option value="omaha-5">5-Card Omaha</option>
              <option value="dealers-choice">Dealer&apos;s Choice (dealer selects each hand)</option>
              <option value="mixed">Mixed Games (rotate every few hands)</option>
            </select>
            {variant === 'dealers-choice' && (
              <p className="hint">
                The dealer will choose the variant before each hand. Betting mode will adapt to the chosen variant (Omaha variants default to Pot-Limit).
              </p>
            )}
          </div>
          <div>
            <label className="label">Betting mode</label>
            <select
              className="input"
              value={bettingMode}
              onChange={e => setBettingMode(e.target.value as BettingMode)}
              disabled={variant === 'dealers-choice' || variant === 'mixed'}
            >
              <option value="no-limit">No Limit</option>
              <option value="pot-limit">Pot Limit</option>
              <option value="fixed-limit">Fixed Limit</option>
            </select>
            {bettingMode === 'fixed-limit' && variant !== 'dealers-choice' && variant !== 'mixed' && (
              <p className="hint">
                Bets and raises are one big blind early in the hand and two big blinds later, up to four bets per round.
              </p>
            )}
            {variant === 'mixed' && (
              <p className="hint">Each game in the mix sets its own betting.</p>
            )}
            {variant === 'dealers-choice' && (
              <p className="hint">Betting mode is determined by the dealer’s selected variant.</p>
            )}
          </div>
          <div>
            <label className="label">Max players</label>
            <input
              type="number"
              className="input"
              min={2}
              max={9}
              value={maxPlayers}
              onChange={e => setMaxPlayers(parseInt(e.target.value || '0', 10))}
            />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Small blind</label>
            <input
              type="number"
              className="input"
              min={0.01}
              step={0.01}
              value={smallBlind}
              onChange={e => {
                const newSmallBlind = parseFloat(e.target.value || '0');
                setSmallBlind(newSmallBlind);
                if (!bigBlindManuallyUpdated) {
                  setBigBlind(Number((newSmallBlind * 2).toFixed(2)));
                }
              }}
            />
          </div>
          <div>
            <label className="label">Big blind</label>
            <input
              type="number"
              className="input"
              min={Math.max(0.02, Number((smallBlind * 2).toFixed(2)))}
              step={0.01}
              value={bigBlind}
              onChange={e => {
                const newBigBlind = parseFloat(e.target.value || '0');
                if (newBigBlind !== bigBlind) {
                  setBigBlindManuallyUpdated(true);
                }
                setBigBlind(newBigBlind);
              }}
            />
          </div>
          <div>
            <label className="label">Buy-in</label>
            <input
              type="number"
              className="input"
              min={1}
              step={1}
              value={buyIn}
              onChange={e => setBuyIn(Number(e.target.value) || 1000)}
            />
            <p className="hint">Starting chips for each new seat.</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Number of rebuys</label>
            <select
              className="input"
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
            <p className="hint">0–10, or Unlimited for cash games.</p>
          </div>
          {numberOfRebuys !== 0 && (
            <div>
              <label className="label">Rebuy amount (chips)</label>
              <input
                type="number"
                className="input"
                min={1}
                step={1}
                value={rebuyAmount}
                onChange={e => {
                  const value = e.target.value;
                  const parsed = parseInt(value, 10);
                  setRebuyAmount(Number.isFinite(parsed) && parsed > 0 ? parsed : 20);
                }}
              />
              <p className="hint">Chips added on each rebuy.</p>
            </div>
          )}
        </div>
        </section>
        <section className="surface p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="section-title">Clock</h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">How long players get to act, plus a few time banks for tough spots.</p>
          </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="turn-time">Turn time (seconds)</label>
            <input
              id="turn-time"
              type="number"
              min={MIN_TURN_SECONDS}
              max={MAX_TURN_SECONDS}
              className="input"
              value={turnTimeSeconds}
              onChange={e => setTurnTimeSeconds(Number(e.target.value))}
            />
            <p className="hint">Per decision, {MIN_TURN_SECONDS}–{MAX_TURN_SECONDS}s.</p>
          </div>
          <div>
            <label className="label" htmlFor="hand-delay">Time between hands (seconds)</label>
            <input
              id="hand-delay"
              type="number"
              min={MIN_HAND_DELAY_SECONDS}
              max={MAX_HAND_DELAY_SECONDS}
              className="input"
              value={handDelaySeconds}
              onChange={e => setHandDelaySeconds(Number(e.target.value))}
            />
            <p className="hint">Pause to see how a hand ended, {MIN_HAND_DELAY_SECONDS}–{MAX_HAND_DELAY_SECONDS}s.</p>
          </div>
          <div>
            <label className="label" htmlFor="time-banks">Time banks per player</label>
            <input
              id="time-banks"
              type="number"
              min={0}
              max={MAX_TIME_BANKS}
              className="input"
              value={timeBanks}
              onChange={e => setTimeBanks(Number(e.target.value))}
            />
            <p className="hint">Used once the turn clock runs out.</p>
          </div>
          <div>
            <label className="label" htmlFor="time-bank-seconds">Time bank length (seconds)</label>
            <input
              id="time-bank-seconds"
              type="number"
              min={MIN_TIME_BANK_SECONDS}
              max={MAX_TIME_BANK_SECONDS}
              className="input"
              value={timeBankSeconds}
              onChange={e => setTimeBankSeconds(Number(e.target.value))}
            />
            <p className="hint">Extra seconds per time bank.</p>
          </div>
        </div>
        </section>
        {variant === 'mixed' && (
          <MixedGameSetup
            games={mixedGames}
            handsPerGame={handsPerGame}
            onChange={(games, hands) => { setMixedGames(games); setHandsPerGame(hands); }}
          />
        )}
        <section className="surface p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="section-title">Extras</h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Optional rules that add a little action.</p>
          </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Ante (chips)</label>
            <input
              type="number"
              className="input"
              min={0}
              step={0.01}
              value={ante}
              onChange={e => setAnte(Math.max(0, parseFloat(e.target.value || '0') || 0))}
            />
            <p className="hint">Posted by everyone each hand. 0 for none.</p>
          </div>
          <div>
            <label className="label">7-2 bounty (chips)</label>
            <input
              type="number"
              className="input"
              min={0}
              step={0.01}
              value={sevenDeuceBounty}
              onChange={e => setSevenDeuceBounty(Math.max(0, parseFloat(e.target.value || '0') || 0))}
            />
            <p className="hint">Paid to whoever wins with 7-2 offsuit. 0 for off.</p>
          </div>
        </div>
        <div className="mt-5 border-t border-gray-100 pt-5 dark:border-white/6">
          <label className="inline-flex items-center space-x-2 text-sm font-medium text-gray-800 dark:text-gray-200">
            <input
              type="checkbox"
              className="checkbox"
              checked={allowRunItTwice}
              onChange={e => setAllowRunItTwice(e.target.checked)}
            />
            <span>Allow run it twice</span>
          </label>
          <p className="hint">
            After an all-in, the player with the weakest hand can choose to deal the rest of the board more than once and split the pot between the runs. Hold&apos;em and Omaha only.
          </p>
          <label className="mt-4 inline-flex items-center space-x-2 text-sm font-medium text-gray-800 dark:text-gray-200">
            <input
              type="checkbox"
              className="checkbox"
              checked={showAllAtShowdown}
              onChange={e => setShowAllAtShowdown(e.target.checked)}
            />
            <span>Everyone shows at showdown</span>
          </label>
          <p className="hint">
            Everyone still in when a hand reaches showdown shows their cards, winners and losers alike. Players who folded keep theirs hidden.
          </p>
        </div>
        </section>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
        <div className="flex flex-col-reverse gap-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Running a tournament? Set it up from <Link href="/tournaments" className="link">Tournaments</Link>.
          </p>
          <div className="flex gap-2">
            <Link href="/dashboard" className="btn btn-ghost">Cancel</Link>
            <button type="submit" className="btn btn-primary" disabled={submitting || isNavigating || !isAuthenticated}>
              {isNavigating ? 'Joining room...' : submitting ? 'Creating…' : 'Create table'}
            </button>
          </div>
        </div>
        {!isAuthenticated && (
          <p className="hint">Sign in to create a game room.</p>
        )}
        {isNavigating && (
          <p className="text-emerald-600 dark:text-emerald-400 text-sm mt-2 animate-pulse">
            Room created. Taking you to the table…
          </p>
        )}
      </form>
    </main>
    </AppShell>
  );
}
