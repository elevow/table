import { nanoid, customAlphabet } from 'nanoid';

// Create a custom alphabet with alphanumeric characters (excluding confusing ones)
// Removing: 0, O, 1, l, I for better readability
const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const generateRoomCode = customAlphabet(alphabet, 8);

/**
 * Generate a unique 8-character alphanumeric room code
 * Uses a custom alphabet that excludes confusing characters like 0/O, 1/l/I
 * @returns {string} 8-character room code (e.g., "A7x2mK9P")
 */
export function generateUniqueRoomCode(): string {
  return generateRoomCode();
}

/**
 * Generate a shorter 6-character room code for testing or special cases
 */
export function generateShortRoomCode(): string {
  const shortGenerator = customAlphabet(alphabet, 6);
  return shortGenerator();
}

/**
 * Validate if a string looks like a valid room code
 * @param code - The code to validate
 * @returns {boolean} True if the code matches the expected format
 */
export function isValidRoomCode(code: string): boolean {
  if (!code || typeof code !== 'string') {
    return false;
  }
  
  // Check if it's 6 or 8 characters and contains only our allowed alphabet
  const validLength = code.length === 6 || code.length === 8;
  const validChars = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz]+$/.test(code);
  
  return validLength && validChars;
}

/**
 * Check if a code looks like a UUID (for backwards compatibility)
 * @param code - The code to check
 * @returns {boolean} True if it looks like a UUID
 */
export function isUuidFormat(code: string): boolean {
  if (!code || typeof code !== 'string') {
    return false;
  }
  
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code);
}
