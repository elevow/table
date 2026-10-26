/** One finished hand from the player's point of view. */
export interface ProfitHand {
  handId: string;
  roomId: string;
  startedAt: string | null;
  endedAt: string;
  net: number;
}

export interface ProfitPoint {
  handId: string;
  // Epoch ms the hand ended
  t: number;
  net: number;
  cumulative: number;
}

export interface PlayedSession {
  roomId: string;
  // Epoch ms: start of the first hand, end of the last
  start: number;
  end: number;
  durationMs: number;
  hands: number;
  net: number;
}

// A break longer than this at the same table starts a new session
export const SESSION_GAP_MS = 2 * 60 * 60 * 1000;

const ended = (h: ProfitHand) => Date.parse(h.endedAt);

function byEnd(hands: ProfitHand[]): ProfitHand[] {
  return hands.filter(h => Number.isFinite(ended(h))).sort((a, b) => ended(a) - ended(b));
}

/** Running total of the player's results, oldest hand first. */
export function buildProfitSeries(hands: ProfitHand[]): ProfitPoint[] {
  let cumulative = 0;
  return byEnd(hands).map(h => {
    // Rounded to cents so fractional chips don't drift over thousands of hands
    cumulative = Math.round((cumulative + h.net) * 100) / 100;
    return { handId: h.handId, t: ended(h), net: h.net, cumulative };
  });
}

/**
 * Sessions, newest first. Hands are grouped per table first, so playing two tables at once
 * gives two sessions rather than many short ones, then split wherever the player was away
 * longer than `gapMs`.
 */
export function groupSessions(hands: ProfitHand[], gapMs: number = SESSION_GAP_MS): PlayedSession[] {
  const byRoom = new Map<string, ProfitHand[]>();
  for (const h of byEnd(hands)) {
    const list = byRoom.get(h.roomId);
    if (list) list.push(h);
    else byRoom.set(h.roomId, [h]);
  }

  const sessions: PlayedSession[] = [];
  byRoom.forEach((list, roomId) => {
    let current: PlayedSession | null = null;
    for (const h of list) {
      const end = ended(h);
      const startParsed = h.startedAt ? Date.parse(h.startedAt) : NaN;
      const start = Number.isFinite(startParsed) && startParsed <= end ? startParsed : end;
      if (!current || start - current.end > gapMs) {
        current = { roomId, start, end, durationMs: 0, hands: 0, net: 0 };
        sessions.push(current);
      }
      current.end = Math.max(current.end, end);
      current.hands += 1;
      current.net += h.net;
      current.durationMs = current.end - current.start;
    }
  });
  return sessions.sort((a, b) => b.start - a.start);
}

/** "1h 25m", "40m", "<1m". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '<1m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
