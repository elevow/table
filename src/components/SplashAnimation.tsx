import React, { useEffect, useMemo, useRef, useState } from 'react';

type Splash = { playerId: string; amount: number; at: number; ageMs?: number };

interface Props {
  splash?: Splash | null;
  playerName?: string | null;
  formatAmount?: (n: number) => string;
}

// A splash older than this (e.g. when the page reloads mid-hand) shows its chips already landed,
// without the fall or the announcement
const FRESH_MS = 8_000;
const SHOW_MS = 2_800;
const CHIP_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#111827', '#f59e0b', '#7c3aed'];

/**
 * The splash to show on the table: one made in the hand being played. Its chips stay on the felt
 * until the hand ends. Both times come from the server, so every viewer agrees.
 */
export function splashInPlay(
  state: { lastSplash?: Splash; handStartedAt?: number; stage?: string } | null | undefined
): Splash | null {
  const splash = state?.lastSplash;
  if (!splash || typeof state?.handStartedAt !== 'number') return null;
  if (splash.at < state.handStartedAt || state.stage === 'showdown') return null;
  return splash;
}

/**
 * Chips raining onto the table when a player splashes the pot. They stay where they land, under
 * the cards, until the hand is over. Players who prefer reduced motion see the chips without the fall.
 */
export default function SplashAnimation({ splash, playerName, formatAmount }: Props) {
  const [announcing, setAnnouncing] = useState<Splash | null>(null);
  const [falling, setFalling] = useState(false);
  const seenAt = useRef<number | null>(null);

  const at = splash?.at ?? null;
  useEffect(() => {
    if (!splash || seenAt.current === splash.at) return;
    seenAt.current = splash.at;
    // The server says how long ago the splash was; a state without that falls back to this clock
    const age = typeof splash.ageMs === 'number' ? splash.ageMs : Date.now() - splash.at;
    if (age > FRESH_MS) {
      setFalling(false);
      return;
    }
    setFalling(true);
    setAnnouncing(splash);
    const timer = setTimeout(() => setAnnouncing(null), SHOW_MS);
    return () => clearTimeout(timer);
    // Runs once per splash, however often the same state arrives again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);

  // Scatter the same way for one splash, differently for the next
  const chips = useMemo(() => {
    const seed = at ?? 0;
    const rand = (i: number, k: number) => {
      const x = Math.sin(seed / 1000 + i * 12.9898 + k * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    return Array.from({ length: 36 }, (_, i) => ({
      left: 15 + rand(i, 1) * 70,
      delay: rand(i, 2) * 0.6,
      drift: (rand(i, 3) - 0.5) * 60,
      spin: (rand(i, 4) - 0.5) * 720,
      land: 40 + rand(i, 5) * 25,
      color: CHIP_COLORS[i % CHIP_COLORS.length],
    }));
  }, [at]);

  if (!splash) return null;
  const banner = announcing && announcing.at === splash.at ? announcing : null;
  const who = playerName || 'A player';
  const amount = banner ? (formatAmount ? formatAmount(banner.amount) : `$${banner.amount}`) : '';

  return (
    <>
      <style>{`
        @keyframes splash-fall {
          0% { transform: translate(0, -120%) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
        }
        @keyframes splash-pop {
          0% { transform: translate(-50%, -50%) scale(0.6); opacity: 0; }
          15% { transform: translate(-50%, -50%) scale(1.08); opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
        }
        .splash-chip { transform: translate(var(--drift), var(--land)) rotate(var(--spin)); opacity: 0.9; }
        .splash-chip.splash-falling { animation: splash-fall 1.6s cubic-bezier(.3,.7,.4,1) both; }
        .splash-text { animation: splash-pop ${SHOW_MS}ms ease-out forwards; }
        @media (prefers-reduced-motion: reduce) {
          .splash-chip.splash-falling { animation: none; }
          .splash-text { animation: none; }
        }
      `}</style>
      {/* No z-index: the chips sit on the felt, under the cards and seats drawn after them */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full" aria-hidden="true" data-testid="splash-chips">
        {chips.map((c, i) => (
          <span
            key={i}
            className={`splash-chip absolute top-0 h-6 w-6 rounded-full border-[3px] border-dashed border-white/80 shadow-md ${falling ? 'splash-falling' : ''}`}
            style={{
              left: `${c.left}%`,
              backgroundColor: c.color,
              animationDelay: `${c.delay}s`,
              ['--drift' as string]: `${c.drift}px`,
              ['--land' as string]: `${c.land * 4}px`,
              ['--spin' as string]: `${c.spin}deg`,
            }}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 z-30" role="status" aria-live="polite">
        {banner && (
          <div className="splash-text absolute left-1/2 top-1/2 whitespace-nowrap rounded-full bg-black/75 px-4 py-2 text-base font-bold text-amber-300 shadow-lg">
            {who} splashes the pot! {amount}
          </div>
        )}
      </div>
    </>
  );
}
