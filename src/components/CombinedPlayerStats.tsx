/**
 * The signed-in player's lifetime statistics for the lobby, from the server, so they match the
 * leaderboard on every device.
 */
import { useEffect, useState, memo } from 'react';
import type { StatsSummary } from '../../pages/api/stats/summary';
import { authHeaders } from '../utils/auth-headers';
import { formatDuration } from '../lib/shared/profit-sessions';
import { formatAf, formatPct } from '../lib/shared/hud-stats';

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`;

function StatCard({ label, value, color = 'text-gray-900 dark:text-gray-100' }: { label: string; value: string; color?: string }) {
  return (
    <div className="surface-muted px-4 py-3">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function CombinedPlayerStats() {
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    fetch('/api/stats/summary', { headers: authHeaders() })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as StatsSummary;
        if (alive) {
          setStats(data);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (alive) setStatus('error');
      });
    return () => { alive = false; };
  }, []);

  return (
    <div className="surface p-6">
      <h3 className="section-title mb-4">Your statistics</h3>

      {status === 'loading' && (
        <div className="animate-pulse" aria-label="Loading your statistics">
          <div className="h-4 bg-gray-200 dark:bg-white/6 rounded-sm w-3/4 mb-2"></div>
          <div className="h-4 bg-gray-200 dark:bg-white/6 rounded-sm w-1/2"></div>
        </div>
      )}

      {status === 'error' && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Your statistics could not be loaded. Try again in a moment.</p>
      )}

      {status === 'ready' && stats && stats.handsPlayed === 0 && (
        <div className="text-center py-4">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">No hands yet</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Play a few hands and your numbers will show up here.</p>
        </div>
      )}

      {status === 'ready' && stats && stats.handsPlayed > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <StatCard label="Hands played" value={stats.handsPlayed.toLocaleString()} />
            <StatCard label="Pots won" value={stats.handsWon.toLocaleString()} />
            <StatCard label="Win rate" value={`${Math.round((stats.handsWon / stats.handsPlayed) * 100)}%`} />
            <StatCard
              label="Profit"
              value={money(stats.profit)}
              color={stats.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
            />
            <StatCard label="Total won" value={money(stats.winnings)} color="text-emerald-600 dark:text-emerald-400" />
            <StatCard label="Total lost" value={money(stats.losses)} color="text-red-600 dark:text-red-400" />
            <StatCard label="Biggest pot" value={money(stats.biggestPot)} />
            <StatCard label="Sessions" value={stats.sessions.toLocaleString()} />
            <StatCard label="Time played" value={stats.timePlayedMs > 0 ? formatDuration(stats.timePlayedMs) : '0m'} />
          </div>
          {stats.hud && stats.hud.hands > 0 && (
            <>
              <h4 className="mt-6 mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">How you play</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="VPIP" value={stats.hud.vpip == null ? '–' : `${formatPct(stats.hud.vpip)}%`} />
                <StatCard label="PFR" value={stats.hud.pfr == null ? '–' : `${formatPct(stats.hud.pfr)}%`} />
                <StatCard label="3-bet" value={stats.hud.threeBet == null ? '–' : `${formatPct(stats.hud.threeBet)}%`} />
                <StatCard label="Aggression" value={formatAf(stats.hud)} />
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                Over your last {stats.hud.hands.toLocaleString()} hand{stats.hud.hands === 1 ? '' : 's'}. VPIP is how often you put money in voluntarily, PFR how often you raise first, and aggression your bets and raises for each call after the first round.
              </p>
            </>
          )}
          <p className="mt-4 text-xs text-gray-500 dark:text-gray-500">
            Every hand you&apos;ve played, on any device. Hands, pots won, profit and biggest pot match the leaderboard.
          </p>
        </>
      )}
    </div>
  );
}

export default memo(CombinedPlayerStats);
