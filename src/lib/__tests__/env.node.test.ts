/**
 * Force Node environment for this file to simulate SSR where window is undefined.
 * @jest-environment node
 */
import { isBrowser } from '../env';

describe('env.ts (node)', () => {
  it('isBrowser returns false when window is undefined', () => {
    // In node test environment, window should be undefined
    expect(typeof (globalThis as any).window).toBe('undefined');
    expect(isBrowser()).toBe(false);
  });
});
