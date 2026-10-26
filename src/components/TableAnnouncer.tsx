import React, { useEffect, useRef, useState } from 'react';
import {
  buildAnnouncements,
  mergeAnnouncements,
  snapshotFromState,
  type AnnounceSnapshot,
} from '../lib/shared/table-announcements';

interface Props {
  gameState: any;
  viewerId: string;
  nameOf: (playerId: string) => string;
  formatAmount: (amount: number) => string;
}

/** Wait this long after the last change before speaking, so a burst of updates is read once. */
export const ANNOUNCE_DEBOUNCE_MS = 500;
/** ...but never hold messages longer than this while updates keep coming. */
export const ANNOUNCE_MAX_WAIT_MS = 1500;

/**
 * Visually hidden live region that tells screen-reader users what happens at the table:
 * their turn, other players' actions, new board cards and who won.
 */
export default function TableAnnouncer({ gameState, viewerId, nameOf, formatAmount }: Props) {
  const [text, setText] = useState('');
  const baselineRef = useRef<AnnounceSnapshot | null>(null);
  const viewerRef = useRef(viewerId);
  const queueRef = useRef<string[]>([]);
  const firstQueuedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctxRef = useRef({ nameOf, formatAmount });
  ctxRef.current = { nameOf, formatAmount };

  useEffect(() => {
    // A different viewer (signing in, switching seats) starts from a fresh baseline
    if (viewerRef.current !== viewerId) {
      viewerRef.current = viewerId;
      baselineRef.current = null;
    }
    const next = snapshotFromState(gameState, viewerId);
    if (!next) return;
    const { messages, baseline } = buildAnnouncements(baselineRef.current, next, { viewerId, ...ctxRef.current });
    baselineRef.current = baseline;
    if (messages.length === 0) return;

    queueRef.current.push(...messages);
    const now = Date.now();
    if (firstQueuedAtRef.current === null) firstQueuedAtRef.current = now;
    const waited = now - firstQueuedAtRef.current;
    const delay = Math.max(0, Math.min(ANNOUNCE_DEBOUNCE_MS, ANNOUNCE_MAX_WAIT_MS - waited));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const merged = mergeAnnouncements(queueRef.current);
      queueRef.current = [];
      firstQueuedAtRef.current = null;
      timerRef.current = null;
      // Clear first so the same words twice in a row are still read out
      setText('');
      setTimeout(() => setText(merged), 50);
    }, delay);
  }, [gameState, viewerId]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="table-announcer">
      {text}
    </div>
  );
}
