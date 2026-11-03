import { authHeaders } from '../../utils/auth-headers';

/** POST a tournament action (register, rebuy, pause, ...) as the signed-in user; throws the server's error message. */
export async function postTournamentAction(action: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`/api/tournaments/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

/** The signed-in user's permissions, or null when signed out or they can't be loaded. */
export async function loadPermissions(): Promise<string[] | null> {
  const headers = authHeaders();
  if (!headers.Authorization) return null;
  try {
    const res = await fetch('/api/auth/check-admin', { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.permissions || [];
  } catch {
    return null;
  }
}
