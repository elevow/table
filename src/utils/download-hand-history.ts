import { authHeaders } from './auth-headers';

/**
 * Download hands as a PokerStars-format .txt file. Fetched with the session header and saved
 * from a Blob, because a plain link would not carry the Bearer token.
 */
export async function downloadHandHistory(query: Record<string, string>): Promise<void> {
  const resp = await fetch(`/api/history/export?${new URLSearchParams(query)}`, { headers: authHeaders() });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(resp.status === 401 ? 'Sign in to export hands.' : data?.error || 'Could not export hands');
  }
  const blob = await resp.blob();
  const match = /filename="([^"]+)"/.exec(resp.headers.get('Content-Disposition') || '');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] || 'hands.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before the URL goes away
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
