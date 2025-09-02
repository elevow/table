/**
 * Runs under default jsdom environment per Jest config.
 */
import { isBrowser } from '../env';

describe('env.ts (jsdom)', () => {
  it('isBrowser returns true when window is defined', () => {
    expect(typeof window).toBe('object');
    expect(isBrowser()).toBe(true);
  });
});
