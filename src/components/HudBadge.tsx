import React from 'react';
import { authHeaders } from '../utils/auth-headers';
import { formatAf, formatPct, type HudStats } from '../lib/shared/hud-stats';

export type HudMap = Record<string, HudStats>;

/** HUD numbers for these players, from hands you played with them. */
export async function fetchHudStats(subjectIds: string[]): Promise<HudMap> {
  if (subjectIds.length === 0) return {};
  const resp = await fetch(`/api/stats/hud?subjects=${encodeURIComponent(subjectIds.join(','))}`, { headers: authHeaders() });
  if (!resp.ok) return {};
  const data = await resp.json().catch(() => ({}));
  return data.stats || {};
}

export function hudSummary(s: HudStats): string {
  return `VPIP ${formatPct(s.vpip)}%, PFR ${formatPct(s.pfr)}%, 3-bet ${formatPct(s.threeBet)}%, ` +
    `aggression ${formatAf(s)}, over ${s.hands} hand${s.hands === 1 ? '' : 's'} you played together`;
}

/** Compact "VPIP/PFR · n" tag; the full numbers are in the tooltip. */
export default function HudBadge({ stats }: { stats?: HudStats }) {
  if (!stats || stats.hands === 0) return null;
  const summary = hudSummary(stats);
  return (
    <span
      title={summary}
      aria-label={summary}
      className="shrink-0 ml-auto px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[11px] tabular-nums text-gray-700 dark:text-gray-200"
    >
      {formatPct(stats.vpip)}/{formatPct(stats.pfr)} · {stats.hands}
    </span>
  );
}
