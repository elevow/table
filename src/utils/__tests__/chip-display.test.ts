/**
 * Tests for chip display utilities
 */

import { formatChipsAsBB, formatChips } from '../chip-display';

describe('formatChipsAsBB', () => {
  it('should format chips as Big Blinds with 1 decimal by default', () => {
    expect(formatChipsAsBB(1000, 10)).toBe('100.0 BB');
  });

  it('should format chips as Big Blinds with specified decimals', () => {
    expect(formatChipsAsBB(1250, 100, 2)).toBe('12.50 BB');
    expect(formatChipsAsBB(1250, 100, 0)).toBe('13 BB'); // rounds to 13
  });

  it('should handle fractional Big Blinds', () => {
    expect(formatChipsAsBB(550, 100)).toBe('5.5 BB');
    expect(formatChipsAsBB(75, 100)).toBe('0.8 BB');
  });

  it('should handle large stacks', () => {
    expect(formatChipsAsBB(100000, 100)).toBe('1000.0 BB');
  });

  it('should handle small stacks', () => {
    expect(formatChipsAsBB(25, 100)).toBe('0.3 BB'); // rounds to 0.3 with 1 decimal
  });

  it('should fall back to chip count if big blind is zero', () => {
    expect(formatChipsAsBB(1000, 0)).toBe('1,000');
  });

  it('should fall back to chip count if big blind is negative', () => {
    expect(formatChipsAsBB(1000, -10)).toBe('1,000');
  });
});

describe('formatChips', () => {
  it('should format as BB when showAsBB is true and bigBlind is valid', () => {
    expect(formatChips(1000, 10, true)).toBe('100.0 BB');
  });

  it('should format as chips when showAsBB is false', () => {
    expect(formatChips(1000, 10, false)).toBe('1,000');
  });

  it('should format as chips when bigBlind is null', () => {
    expect(formatChips(1000, null, true)).toBe('1,000');
  });

  it('should format as chips when bigBlind is zero', () => {
    expect(formatChips(1000, 0, true)).toBe('1,000');
  });

  it('should format as chips when bigBlind is negative', () => {
    expect(formatChips(1000, -10, true)).toBe('1,000');
  });

  it('should handle large numbers with locale formatting', () => {
    expect(formatChips(1000000, 100, false)).toBe('1,000,000');
  });
});
