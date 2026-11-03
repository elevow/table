import type { NextApiResponse } from 'next';

/**
 * Answer a failed tournament request. The tournament rules refuse with a plain Error whose message
 * is meant for the user (400). Anything else, such as a database or network failure, carries an
 * error code; it's logged and answered with a generic 500 so internal details don't leak.
 */
export function sendTournamentError(res: NextApiResponse, err: unknown): void {
  if (err instanceof Error && (err as { code?: unknown }).code === undefined) {
    res.status(400).json({ error: err.message || 'Bad request' });
    return;
  }
  console.error('[tournaments] Request failed:', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
