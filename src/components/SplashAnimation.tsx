import React, { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  splash?: { playerId: string; amount: number; at: number } | null;
  playerName?: string | null;
  formatAmount?: (n: number) => string;
}

// A splash older than this (e.g. when the page reloads mid-session) isn't replayed
const FRESH_MS = 8_000;
const SHOW_MS = 2_800;
const CHIP_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#111827', '#f59e0b', '#7c3aed'];

/**
 * Chips raining onto the table when a player splashes the pot. Players who prefer reduced motion
 * get the announcement without the chips.
 */
export default function SplashAnimation({ splash, playerName, formatAmount }: Props) {
  const [showing, setShowing] = useState<Props['splash']>(null);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (!splash || shownAt.current === splash.at || Date.now() - splash.at > FRESH_MS) return;
    shownAt.current = splash.at;
    setShowing(splash);
    const timer = setTimeout(() => setShowing(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [splash]);

  // Scatter the same way for one splash, differently for the next
  const chips = useMemo(() => {
    const seed = showing?.at ?? 0;
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
  }, [showing?.at]);

  if (!showing) return null;
  const who = playerName || 'A player';
  const amount = formatAmount ? formatAmount(showing.amount) : `$${showing.amount}`;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-full" role="status" aria-live="polite">
      <style>{`
        @keyframes splash-fall {
          0% { transform: translate(0, -120%) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          80% { opacity: 1; }
          100% { transform: translate(var(--drift), var(--land)) rotate(var(--spin)); opacity: 0.9; }
        }
        @keyframes splash-pop {
          0% { transform: translate(-50%, -50%) scale(0.6); opacity: 0; }
          15% { transform: translate(-50%, -50%) scale(1.08); opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
        }
        .splash-chip { animation: splash-fall 1.6s cubic-bezier(.3,.7,.4,1) forwards; }
        .splash-text { animation: splash-pop ${SHOW_MS}ms ease-out forwards; }
        @media (prefers-reduced-motion: reduce) {
          .splash-chip { display: none; }
          .splash-text { animation: none; }
        }
      `}</style>
      {chips.map((c, i) => (
        <span
          key={i}
          className="splash-chip absolute top-0 h-6 w-6 rounded-full border-[3px] border-dashed border-white/80 shadow-md"
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
      <div className="splash-text absolute left-1/2 top-1/2 whitespace-nowrap rounded-full bg-black/75 px-4 py-2 text-base font-bold text-amber-300 shadow-lg">
        {who} splashes the pot! {amount}
      </div>
    </div>
  );
}
