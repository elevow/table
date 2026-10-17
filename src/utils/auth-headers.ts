/**
 * The signed-in user's session token from localStorage, or null when signed out.
 */
export function getStoredAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = localStorage.getItem('auth_token');
    return token && token !== 'null' ? token : null;
  } catch {
    return null;
  }
}

/**
 * Authorization header for the signed-in user's session token, or {} when signed out.
 */
export function authHeaders(): Record<string, string> {
  const token = getStoredAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
