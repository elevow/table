import React from 'react';
import { formatBlinds, formatClock } from '../../lib/tournament/format';
import type { TournamentView } from '../../lib/tournament/tournament-view';

/** The tournament clock: current blinds and time left, or the break countdown. */
export default function TournamentClock({ view, levelLeft, breakLeft }: {
  view: TournamentView;
  levelLeft: number | null;
  breakLeft: number | null;
}) {
  return (
    <section aria-label="Clock" className="rounded-lg bg-gray-50 dark:bg-gray-800 p-4 text-center">
      {view.status === 'setup' && <p className="text-lg">Waiting to start. First level: {view.nextLevel && formatBlinds(view.nextLevel)}</p>}
      {view.onBreak && breakLeft !== null && (
        <>
          <p className="text-sm uppercase tracking-wide text-amber-700 dark:text-amber-300">Break{view.status === 'paused' ? ' (paused)' : ''}</p>
          <p className="text-5xl font-bold tabular-nums my-2">{formatClock(breakLeft)}</p>
          {view.directorControlsLevels && breakLeft <= 0 && view.status !== 'paused' && (
            <p className="text-sm text-amber-700 dark:text-amber-300">Break time is up. Play resumes when the director ends the break.</p>
          )}
          {view.level && <p>Back with level {view.level.number}: {formatBlinds(view.level)}</p>}
        </>
      )}
      {!view.onBreak && view.level && view.status !== 'setup' && (
        <>
          <p className="text-sm uppercase tracking-wide text-gray-600 dark:text-gray-400">
            Level {view.level.number}{view.status === 'paused' ? ' (paused)' : ''}
          </p>
          <p className="text-3xl font-semibold my-1">{formatBlinds(view.level)}</p>
          {levelLeft !== null && view.status !== 'completed' && (
            <p className="text-5xl font-bold tabular-nums my-2">{view.nextLevel ? formatClock(levelLeft) : 'Final level'}</p>
          )}
          {view.directorControlsLevels && view.nextLevel && levelLeft !== null && levelLeft <= 0 && view.status === 'running' && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Time is up. The {view.breakAfterLevelMinutes ? 'break' : 'next level'} starts when the director moves on.
            </p>
          )}
          {view.nextLevel && view.status !== 'completed' && (
            <p className="text-gray-600 dark:text-gray-400">Next: {formatBlinds(view.nextLevel)}</p>
          )}
          {view.handForHandRound !== null && (
            <p className="mt-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
              Hand for hand (hand {view.handForHandRound}): each table waits for the others to finish before dealing again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
