/**
 * @jest-environment node
 */
// A Node environment, so initRedis sees a server (jsdom always has a window)
// Shaped like the real package: the client class is both the default and the named export
jest.mock('ioredis', () => { const Redis = jest.fn().mockImplementation(() => ({})); return { __esModule: true, default: Redis, Redis }; });

import { getCacheManager } from '../cache-manager';

describe('CacheManager Redis client', () => {
  test('keeps the old Redis protocol (RESP2) that ioredis 5 used', async () => {
    const { Redis } = jest.requireMock('ioredis') as { Redis: jest.Mock };
    await getCacheManager().initRedis({ host: 'localhost', port: 6379 });
    expect(Redis).toHaveBeenCalledWith({ host: 'localhost', port: 6379, protocol: 2 });
  });
});
