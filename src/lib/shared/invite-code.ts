// Invite codes for private tables and tournaments: 10 characters, uppercase without 0/O, 1/I and
// L, so never mistaken for an 8-character room id. Stored without the dash, shown with one.
import { customAlphabet } from 'nanoid';

const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const INVITE_LENGTH = 10;
const generateInviteCode = customAlphabet(INVITE_ALPHABET, INVITE_LENGTH);

export function newInviteCode(): string {
  return generateInviteCode();
}

/** "K7QM2XPAHR" -> "K7QM2-XPAHR" */
export function formatInviteCode(code: string): string {
  return code.length === INVITE_LENGTH ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

/** What someone typed or pasted, as a stored code, or null if it can't be one. */
export function normalizeInviteCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== INVITE_LENGTH) return null;
  return [...code].every(c => INVITE_ALPHABET.includes(c)) ? code : null;
}
