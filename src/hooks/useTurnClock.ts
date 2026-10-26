import { useEffect, useRef, useState } from 'react';
import { authHeaders } from '../utils/auth-headers';
import { TIMEOUT_GRACE_MS, bankTimeMs, turnTimeMs } from '../lib/shared/turn-clock';

export interface TurnClock {
  /** Player whose turn is on the clock, or null when nobody is to act. */
  activePlayer: string | null;
  /** Total ms left, including time bank; negative once the turn has run out. Null when no clock. */
  remainingMs: number | null;
  /** Ms left before the time bank starts being used. */
  baseRemainingMs: number | null;
  /** True once the base time is gone and the player is using their time bank. */
  inTimeBank: boolean;
  /** This table's base time per decision, for drawing the countdown. */
  baseMs: number;
}

interface ClockState {
  turnSeq?: number;
  activePlayer?: string;
  stage?: string;
  turnTimeRemainingMs?: number;
  turnTimeMs?: number;
  timeBankSeconds?: number;
  players?: Array<{ id: string; timeBank?: number; timeBanks?: number }>;
}

const NO_CLOCK: TurnClock = { activePlayer: null, remainingMs: null, baseRemainingMs: null, inTimeBank: false, baseMs: 0 };

/**
 * Counts down the current turn from the time left the server reported when it sent the state, so
 * a client whose clock disagrees with the server's still shows the right time.
 *
 * When `enforce` is on (the viewer is a player in the game), the hook also asks the server to act
 * for a player whose time has run out. Every player's client does this, so one stalled player can't
 * hold up the table; the server decides on its own clock whether the turn really has expired.
 */
export function useTurnClock(opts: {
  state: ClockState | null | undefined;
  tableId: string;
  playerId: string;
  enforce: boolean;
  onState?: (gameState: any) => void;
}): TurnClock {
  const { state, tableId, playerId, enforce, onState } = opts;
  const turnKey = state && state.activePlayer && typeof state.turnTimeRemainingMs === 'number'
    ? `${state.turnSeq ?? ''}:${state.activePlayer}:${state.stage ?? ''}`
    : null;

  // Local deadlines for the current turn, fixed when the turn is first seen so later copies of the
  // same state (broadcast, action response, refresh) don't make the countdown jump around
  const turnRef = useRef<{ key: string; deadline: number; baseEnd: number } | null>(null);
  if (!turnKey) {
    turnRef.current = null;
  } else if (turnRef.current?.key !== turnKey) {
    const deadline = Date.now() + (state!.turnTimeRemainingMs as number);
    const bankMs = bankTimeMs(state!.players?.find(p => p.id === state!.activePlayer), state!);
    turnRef.current = { key: turnKey, deadline, baseEnd: deadline - bankMs };
  }

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!turnKey) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [turnKey]);

  const remainingMs = turnRef.current ? turnRef.current.deadline - now : null;
  const expired = remainingMs !== null && remainingMs <= -TIMEOUT_GRACE_MS;

  // Latest values for the request, without restarting it on every render
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const turnSeqRef = useRef(state?.turnSeq);
  turnSeqRef.current = state?.turnSeq;
  const [retryNonce, setRetryNonce] = useState(0);

  // Once the turn has run out, ask the server to enforce it
  useEffect(() => {
    if (!enforce || !turnKey || !expired) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const retryIn = (ms: number) => {
      if (!cancelled) retryTimer = setTimeout(() => setRetryNonce(n => n + 1), ms);
    };
    // Spread the requests from everyone at the table; the first one wins, the rest are refused
    const timer = setTimeout(async () => {
      try {
        const resp = await fetch('/api/games/timeout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ tableId, playerId, expectedTurnSeq: turnSeqRef.current }),
        });
        const data = await resp.json().catch(() => ({}));
        if (cancelled) return;
        if (resp.ok && data?.gameState) {
          onStateRef.current?.(data.gameState);
        } else if (data?.code === 'NOT_TIMED_OUT' && typeof data.remainingMs === 'number') {
          // Our countdown ran ahead of the server's; try again once its deadline passes
          retryIn(data.remainingMs + TIMEOUT_GRACE_MS);
        } else if (data?.code === 'STALE_GAME_STATE') {
          // Someone else's request (or the player) got there first and we missed the update
          const latest = await fetch(`/api/games/state?tableId=${encodeURIComponent(tableId)}`, { headers: authHeaders() });
          const latestData = await latest.json().catch(() => ({}));
          if (!cancelled && latestData?.gameState) onStateRef.current?.(latestData.gameState);
        } else {
          retryIn(5000);
        }
      } catch (err) {
        console.warn('Turn timeout request failed:', err);
        retryIn(5000);
      }
    }, Math.floor(Math.random() * 1000));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [enforce, turnKey, expired, retryNonce, tableId, playerId]);

  if (!turnRef.current || !state?.activePlayer) return NO_CLOCK;
  const baseRemainingMs = Math.max(0, turnRef.current.baseEnd - now);
  return {
    activePlayer: state.activePlayer,
    remainingMs,
    baseRemainingMs,
    inTimeBank: baseRemainingMs === 0 && (remainingMs ?? 0) > 0,
    baseMs: turnTimeMs(state),
  };
}
