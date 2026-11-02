import type { TournamentState } from '../../types/tournament-management';

/*
 * The level clock. While a level runs, currentLevelStartedAt marks when the current stretch of play
 * began and levelElapsedMs holds the level time played before it, so pausing banks the time played
 * and resuming starts a new stretch. During a break the level clock is stopped and breakEndsAt says
 * when play resumes; pausing a break banks what's left of it in breakRemainingMs.
 *
 * Nothing runs in the background: catchUpClock works out from these times what should have happened
 * by now, and the manager calls it whenever a tournament is read or changed.
 */

const MINUTE = 60_000;

function levelLengthMs(t: TournamentState): number {
  return t.config.blindLevels[t.currentLevelIndex].durationMinutes * MINUTE;
}

function levelElapsedMs(t: TournamentState, now: number): number {
  return (t.levelElapsedMs ?? 0) + (t.currentLevelStartedAt != null ? now - t.currentLevelStartedAt : 0);
}

function startLevel(t: TournamentState, at: number): void {
  t.currentLevelStartedAt = at;
  t.levelElapsedMs = 0;
}

export function isLastLevel(t: TournamentState): boolean {
  return t.currentLevelIndex + 1 >= t.config.blindLevels.length;
}

/** Start the first level. */
export function startClock(t: TournamentState, at: number): void {
  t.status = 'running';
  t.currentLevelIndex = 0;
  startLevel(t, at);
}

/** Move to the next level at `at`, going on the break scheduled after the level just finished, if any. */
export function enterNextLevel(t: TournamentState, at: number): void {
  if (isLastLevel(t)) throw new Error('Already at the last blind level');
  const finished = t.config.blindLevels[t.currentLevelIndex];
  t.currentLevelIndex += 1;
  const brk = t.config.breaks.find(b => b.afterLevel === finished.level);
  if (brk) {
    t.status = 'on-break';
    t.onBreak = true;
    t.breakEndsAt = at + brk.durationMinutes * MINUTE;
    t.currentBreakAfterLevel = finished.level;
    // The next level's clock starts when the break ends
    t.currentLevelStartedAt = null;
    t.levelElapsedMs = 0;
  } else {
    startLevel(t, at);
  }
}

/** End the current break at `at`; the next level starts then, or on resume if the break was paused. */
export function endBreak(t: TournamentState, at: number): void {
  t.onBreak = false;
  t.breakEndsAt = null;
  t.breakRemainingMs = null;
  t.currentBreakAfterLevel = null;
  if (t.status === 'on-break') {
    t.status = 'running';
    startLevel(t, at);
  } else if (t.status === 'paused') {
    t.pausedFrom = 'running';
    t.currentLevelStartedAt = null;
    t.levelElapsedMs = 0;
  }
}

export function pauseClock(t: TournamentState, at: number): void {
  if (t.status === 'running') {
    t.levelElapsedMs = levelElapsedMs(t, at);
    t.currentLevelStartedAt = null;
    t.pausedFrom = 'running';
  } else if (t.status === 'on-break') {
    t.breakRemainingMs = Math.max(0, (t.breakEndsAt ?? at) - at);
    t.breakEndsAt = null;
    t.pausedFrom = 'on-break';
  } else {
    throw new Error('Only running tournaments can be paused');
  }
  t.status = 'paused';
}

export function resumeClock(t: TournamentState, at: number): void {
  if (t.status !== 'paused') throw new Error('Only paused tournaments can be resumed');
  if (t.pausedFrom === 'on-break') {
    t.status = 'on-break';
    t.breakEndsAt = at + (t.breakRemainingMs ?? 0);
    t.breakRemainingMs = null;
  } else {
    t.status = 'running';
    t.currentLevelStartedAt = at;
  }
  t.pausedFrom = null;
}

/** Stop both clocks, for a finished tournament. */
export function stopClock(t: TournamentState): void {
  t.onBreak = false;
  t.breakEndsAt = null;
  t.breakRemainingMs = null;
  t.currentBreakAfterLevel = null;
  t.currentLevelStartedAt = null;
  t.pausedFrom = null;
}

/**
 * Bring the clock up to `now`: move on from every level whose time ran out and end every break
 * that's over, each at the moment it was due, so catching up after a quiet spell gives the same
 * result as watching the whole time. The last level never ends on its own; it plays until there's
 * a winner. Returns whether anything changed.
 */
export function catchUpClock(t: TournamentState, now: number): boolean {
  let changed = false;
  for (;;) {
    if (t.status === 'running' && t.currentLevelStartedAt != null && !isLastLevel(t)) {
      const endsAt = t.currentLevelStartedAt + levelLengthMs(t) - (t.levelElapsedMs ?? 0);
      if (now >= endsAt) {
        enterNextLevel(t, endsAt);
        changed = true;
        continue;
      }
    }
    if (t.status === 'on-break' && t.breakEndsAt != null && now >= t.breakEndsAt) {
      endBreak(t, t.breakEndsAt);
      changed = true;
      continue;
    }
    return changed;
  }
}

/** Time left in the current level, or null when no level is in play (before the start, on a break, after the end). */
export function levelTimeRemainingMs(t: TournamentState, now: number): number | null {
  if (t.status !== 'running' && !(t.status === 'paused' && t.pausedFrom !== 'on-break')) return null;
  return Math.max(0, levelLengthMs(t) - levelElapsedMs(t, now));
}

/** Time left on the current break, or null when not on one. */
export function breakTimeRemainingMs(t: TournamentState, now: number): number | null {
  if (!t.onBreak) return null;
  if (t.breakEndsAt != null) return Math.max(0, t.breakEndsAt - now);
  return t.breakRemainingMs ?? null;
}
