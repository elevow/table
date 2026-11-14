/** Longest address a mail server accepts (RFC 5321). */
export const MAX_EMAIL_LENGTH = 254;

// Dots split the domain into labels that can't contain dots themselves, so there is only one way
// to match any string and a long crafted input can't make the check slow.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** Whether this looks like an email address: something@domain.tld, no spaces, at most 254 characters. */
export function isValidEmail(value: unknown): boolean {
  return typeof value === 'string' && value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}
