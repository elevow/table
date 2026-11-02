import { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '../../utils/auth-headers';
import type { TournamentView } from './tournament-view';

const POLL_MS = 5000;

/**
 * A tournament's view, refreshed every few seconds, with the level and break time left counted
 * down locally between refreshes (a paused clock stands still).
 */
export function useTournamentView(id: string | null) {
  const [view, setView] = useState<TournamentView | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/tournaments/view?tournamentId=${encodeURIComponent(id)}`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Could not load the tournament (${res.status})`);
      const at = Date.now();
      setView(body);
      setFetchedAt(at);
      setNow(at);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load the tournament');
    }
  }, [id]);

  useEffect(() => {
    reload();
    const poll = setInterval(reload, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [reload]);

  const elapsed = view && view.status !== 'paused' ? Math.max(0, now - fetchedAt) : 0;
  const levelLeft = view?.levelRemainingMs != null ? view.levelRemainingMs - (view.status === 'running' ? elapsed : 0) : null;
  const breakLeft = view?.breakRemainingMs != null ? view.breakRemainingMs - (view.status === 'on-break' ? elapsed : 0) : null;
  return { view, error, reload, levelLeft, breakLeft };
}
