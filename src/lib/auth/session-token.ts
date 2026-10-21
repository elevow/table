import { createHash, randomBytes } from 'crypto';

/**
 * Session tokens are stored only as their SHA-256 hash, so a leaked auth_tokens row
 * cannot be replayed as a login.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * A new random session token: return the token to the client and store hashSessionToken(token).
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}
