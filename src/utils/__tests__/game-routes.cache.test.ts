import type { GameRoute } from '../game-routes';

// Mock the cache manager module before importing the module under test
const mockSet = jest.fn().mockResolvedValue(true);
const mockCacheManager = { set: mockSet } as any;

jest.mock('../cache-manager', () => ({
  getCacheManager: () => mockCacheManager,
}));

// We'll import after mocks are set up
import { cacheGameData, getOfflineSupportedRoutes, gameRoutes } from '../game-routes';

describe('game-routes cache and offline helpers', () => {
  const originalFetch = global.fetch;
  const originalServiceWorker = (navigator as any).serviceWorker;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});

    mockSet.mockClear();

    // Happy-path fetch mock
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rules: 'ok' }),
    } as any);

    // Provide a service worker controller
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: { postMessage: jest.fn() },
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch as any;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: originalServiceWorker,
    });
  });

  test('getOfflineSupportedRoutes filters routes correctly', () => {
    const offline = getOfflineSupportedRoutes();
    const ids = offline.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['poker-texas-holdem', 'poker-omaha']));
    expect(ids).not.toContain('tournament');
  });

  test('cacheGameData returns false for unknown or unsupported routes', async () => {
    await expect(cacheGameData('does-not-exist')).resolves.toBe(false);
    await expect(cacheGameData('tournament')).resolves.toBe(false); // offlineSupport: false
  });

  test('cacheGameData caches assets and posts message when supported', async () => {
    // Ensure route exists and supports offline
    const supported = gameRoutes.find((r: GameRoute) => r.offlineSupport) as GameRoute;
    expect(supported).toBeTruthy();

    const ok = await cacheGameData(supported.id);

    expect(ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(`/api/games/${supported.id}/rules`);
    expect(mockSet).toHaveBeenCalled();

    // service worker controller should have been messaged
    const controller = (navigator as any).serviceWorker.controller;
    expect(controller.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CACHE_GAME_ASSETS' })
    );
  });

  test('cacheGameData handles fetch failure and logs error', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network'));
    const ok = await cacheGameData('poker-texas-holdem');
    expect(ok).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to cache game data for poker-texas-holdem:'),
      expect.any(Error)
    );
  });

  test('cacheGameData works when no service worker controller is present', async () => {
    // Remove controller branch
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: undefined,
    });

    const ok = await cacheGameData('poker-omaha');
    expect(ok).toBe(true);
    // Should not throw; still caches via cache manager
    expect(mockSet).toHaveBeenCalled();
  });
});
