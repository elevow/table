import { authHeaders } from './auth-headers';

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; json: () => Promise<any> }>;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The signed-in user's ID according to the server, or null when there is no valid session.
 *
 * Game routes reject requests whose playerId differs from the session user, so the game page
 * must act as exactly this user. /api/auth/me answers 401 both for an expired session and when
 * the session lookup itself fails, so a failed check is retried before giving up.
 */
export async function resolveSessionUserId(options: {
  fetchImpl?: FetchLike;
  retryDelaysMs?: number[];
} = {}): Promise<string | null> {
  const headers = authHeaders();
  if (!headers.Authorization) return null;

  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const retryDelaysMs = options.retryDelaysMs ?? [500, 1500];

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) await wait(retryDelaysMs[attempt - 1]);
    try {
      const response = await fetchImpl('/api/auth/me', { headers });
      if (response.ok) {
        const data = await response.json();
        if (data && typeof data.userId === 'string' && data.userId) return data.userId;
      }
    } catch {
      // Network error; retry
    }
  }
  return null;
}
