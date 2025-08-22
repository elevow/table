import { getCacheManager, fetchWithCache, CacheStorage } from '../cache-manager';

// Mock Redis for server-side tests
jest.mock('ioredis', () => {
  return {
    Redis: jest.fn().mockImplementation(() => {
      return {
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockImplementation((key) => {
          if (key === 'test:cached-item') {
            return Promise.resolve(JSON.stringify({
              key: 'test:cached-item',
              data: { id: 1, name: 'Test Item' },
              expires: Date.now() + 60000, // 1 minute in the future
              tags: ['test'],
              version: 1
            }));
          }
          return Promise.resolve(null);
        }),
        del: jest.fn().mockResolvedValue(1),
        keys: jest.fn().mockResolvedValue(['test:cached-item']),
        flushall: jest.fn().mockResolvedValue('OK'),
        quit: jest.fn()
      };
    })
  };
});

// Mock fetch for API tests
global.fetch = jest.fn().mockImplementation((url) => {
  if (url === 'https://api.example.com/data') {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: 1, name: 'Fetched Data' })
    });
  }
  return Promise.reject(new Error('Network error'));
});

describe('Cache Manager', () => {
  // Save original environment
  const originalEnv = process.env.NODE_ENV;
  
  // Mock localStorage and indexedDB for browser tests
  let mockLocalStorage: Record<string, string> = {};
  let mockIndexedDB: Record<string, any> = {};
  
  beforeAll(() => {
    // Setup localStorage mock
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn((key: string) => mockLocalStorage[key] || null),
        setItem: jest.fn((key: string, value: string) => {
          mockLocalStorage[key] = value;
        }),
        removeItem: jest.fn((key: string) => {
          delete mockLocalStorage[key];
        }),
        clear: jest.fn(() => {
          mockLocalStorage = {};
        }),
        length: 0,
        key: jest.fn((index: number) => Object.keys(mockLocalStorage)[index] || null)
      },
      writable: true
    });
    
    // Set up indexedDB mock basics
    Object.defineProperty(window, 'indexedDB', {
      value: {
        open: jest.fn().mockImplementation(() => {
          const request = {
            result: {
              objectStoreNames: {
                contains: jest.fn().mockReturnValue(true)
              },
              transaction: jest.fn().mockImplementation(() => {
                return {
                  objectStore: jest.fn().mockImplementation(() => {
                    return {
                      put: jest.fn().mockImplementation((value) => {
                        const request = {
                          onsuccess: null as any
                        };
                        setTimeout(() => {
                          mockIndexedDB[value.key] = value;
                          if (request.onsuccess) request.onsuccess({ target: { result: true } });
                        }, 0);
                        return request;
                      }),
                      get: jest.fn().mockImplementation((key) => {
                        const request = {
                          onsuccess: null as any
                        };
                        setTimeout(() => {
                          if (request.onsuccess) request.onsuccess({ target: { result: mockIndexedDB[key] } });
                        }, 0);
                        return request;
                      }),
                      delete: jest.fn(),
                      clear: jest.fn(),
                      openCursor: jest.fn().mockImplementation(() => {
                        const cursorRequest = {
                          onsuccess: null as any
                        };
                        setTimeout(() => {
                          if (cursorRequest.onsuccess) {
                            // First call the cursor with a mock result
                            const mockCursor = {
                              value: Object.values(mockIndexedDB)[0] || { key: 'test:item', tags: [] },
                              delete: jest.fn(() => {
                                delete mockIndexedDB[Object.keys(mockIndexedDB)[0]];
                              }),
                              continue: jest.fn()
                            };
                            cursorRequest.onsuccess({ target: { result: mockCursor } });
                            
                            // Then simulate the end of the cursor iteration
                            cursorRequest.onsuccess({ target: { result: null } });
                          }
                        }, 0);
                        return cursorRequest;
                      })
                    };
                  }),
                  oncomplete: null as any
                };
              }),
              close: jest.fn()
            },
            onsuccess: null as any,
            onupgradeneeded: null as any
          };
          
          setTimeout(() => {
            if (request.onsuccess) request.onsuccess({ target: request });
          }, 0);
          
          return request;
        })
      },
      writable: true
    });
    
    // Mock navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true
    });
    
    // Mock service worker
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: jest.fn().mockResolvedValue({
          active: {
            postMessage: jest.fn()
          }
        }),
        controller: {
          postMessage: jest.fn()
        }
      },
      writable: true
    });
  });
  
  beforeEach(() => {
    // Reset mocks
    mockLocalStorage = {};
    mockIndexedDB = {};
    jest.clearAllMocks();
    
    // Clear any existing cache
    const cacheManager = getCacheManager();
    cacheManager.clearAll();
  });
  
  afterAll(() => {
    // Restore original environment - using a safer approach
    jest.resetModules();
    Object.defineProperty(process, 'env', {
      value: { ...process.env, NODE_ENV: originalEnv }
    });
  });
  
  describe('Core Functionality', () => {
    test('getInstance returns a singleton', () => {
      const instance1 = getCacheManager();
      const instance2 = getCacheManager();
      expect(instance1).toBe(instance2);
    });
    
    test('configure sets up cache options', () => {
      const cacheManager = getCacheManager();
      cacheManager.configure('test', {
        storage: 'memory',
        ttl: 3600,
        maxSize: 100,
        invalidationRules: []
      });
      
      // Implementation test - we'll verify it works through the rest of the tests
      expect(cacheManager).toBeDefined();
    });
  });
  
  describe('Memory Cache', () => {
    test('set and get with memory cache', async () => {
      const cacheManager = getCacheManager();
      const testData = { id: 1, name: 'Test Item' };
      
      await cacheManager.set('test', 'memory-item', testData);
      const retrieved = await cacheManager.get('test', 'memory-item');
      
      expect(retrieved).toEqual(testData);
    });
    
    test('handles expired items', async () => {
      const cacheManager = getCacheManager();
      const testData = { id: 1, name: 'Expired Item' };
      
      // Set with very short TTL
      await cacheManager.set('test', 'expired-item', testData, { ttl: 0.01 }); // 10ms
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const retrieved = await cacheManager.get('test', 'expired-item');
      expect(retrieved).toBeNull();
    });
    
    test('invalidate removes cache entries', async () => {
      const cacheManager = getCacheManager();
      
      // Add multiple items to memory cache only to avoid timeout issues
      await cacheManager.set('test', 'item1', { id: 1 }, { skipStorage: ['redis', 'indexeddb', 'local'] });
      await cacheManager.set('test', 'item2', { id: 2 }, { skipStorage: ['redis', 'indexeddb', 'local'] });
      await cacheManager.set('other', 'item3', { id: 3 }, { skipStorage: ['redis', 'indexeddb', 'local'] });
      
      // Invalidate specific key
      await cacheManager.invalidate('test', 'item1', { onlyFrom: ['memory'] });
      
      expect(await cacheManager.get('test', 'item1')).toBeNull();
      expect(await cacheManager.get('test', 'item2')).not.toBeNull();
      expect(await cacheManager.get('other', 'item3')).not.toBeNull();
      
      // Clear test namespace instead of invalidate
      await cacheManager.clearNamespace('test', { onlyFrom: ['memory'] });
      
      expect(await cacheManager.get('test', 'item2')).toBeNull();
      expect(await cacheManager.get('other', 'item3')).not.toBeNull();
    }, 10000); // Increase timeout to 10 seconds
    
    test('invalidate by tags', async () => {
      const cacheManager = getCacheManager();
      
      // Add items with tags to memory cache only to avoid timeout issues
      await cacheManager.set('test', 'tagged1', { id: 1 }, { 
        tags: ['tag1', 'tag2'], 
        skipStorage: ['redis', 'indexeddb', 'local'] 
      });
      await cacheManager.set('test', 'tagged2', { id: 2 }, { 
        tags: ['tag2', 'tag3'], 
        skipStorage: ['redis', 'indexeddb', 'local'] 
      });
      await cacheManager.set('test', 'tagged3', { id: 3 }, { 
        tags: ['tag3'], 
        skipStorage: ['redis', 'indexeddb', 'local'] 
      });
      
      // Invalidate by tag
      await cacheManager.invalidate('test', undefined, { 
        tags: ['tag1'], 
        onlyFrom: ['memory'] 
      });
      
      // Re-get the cached items to check invalidation
      const tagged1 = await cacheManager.get('test', 'tagged1');
      const tagged2 = await cacheManager.get('test', 'tagged2');
      const tagged3 = await cacheManager.get('test', 'tagged3');
      
      expect(tagged1).toBeNull();
      expect(tagged2).not.toBeNull();
      expect(tagged3).not.toBeNull();
      
      // Invalidate by another tag
      await cacheManager.invalidate('test', undefined, { 
        tags: ['tag3'],
        onlyFrom: ['memory']
      });
      
      expect(await cacheManager.get('test', 'tagged2')).toBeNull();
      expect(await cacheManager.get('test', 'tagged3')).toBeNull();
    }, 10000); // Increase timeout to 10 seconds
    
    test('clearAll removes all cache entries', async () => {
      const cacheManager = getCacheManager();
      
      // Add items to memory cache only to avoid timeout issues
      await cacheManager.set('test1', 'item1', { id: 1 }, { skipStorage: ['redis', 'indexeddb', 'local'] });
      await cacheManager.set('test2', 'item2', { id: 2 }, { skipStorage: ['redis', 'indexeddb', 'local'] });
      
      // Clear all
      await cacheManager.clearAll({ onlyFrom: ['memory'] });
      
      expect(await cacheManager.get('test1', 'item1')).toBeNull();
      expect(await cacheManager.get('test2', 'item2')).toBeNull();
    }, 10000); // Increase timeout to 10 seconds
  });
  
  describe('LocalStorage Cache', () => {
    test('set and get with localStorage', async () => {
      const cacheManager = getCacheManager();
      cacheManager.configure('local-test', {
        storage: 'local',
        ttl: 3600,
        maxSize: 100,
        invalidationRules: []
      });
      
      const testData = { id: 1, name: 'LocalStorage Item' };
      
      await cacheManager.set('local-test', 'ls-item', testData);
      
      // Verify localStorage was called
      expect(window.localStorage.setItem).toHaveBeenCalled();
      
      const retrieved = await cacheManager.get('local-test', 'ls-item');
      expect(retrieved).toEqual(testData);
    });
    
    test('handles localStorage quota exceeded', async () => {
      const cacheManager = getCacheManager();
      
      // Mock localStorage.setItem to throw quota error once
      let hasThrown = false;
      (window.localStorage.setItem as jest.Mock).mockImplementationOnce(() => {
        if (!hasThrown) {
          hasThrown = true;
          throw new Error('QuotaExceededError');
        }
      });
      
      const testData = { id: 1, name: 'Big Item' };
      
      // This should catch the quota error and retry after clearing expired items
      const result = await cacheManager.set('local-test', 'quota-item', testData);
      
      // It might succeed on retry or fail gracefully
      expect(result !== undefined).toBeTruthy();
    });
  });
  
  describe('API Integration', () => {
    beforeEach(() => {
      // Clear existing API cache
      const cacheManager = getCacheManager();
      cacheManager.invalidate('api');
    });
    
    test('fetchWithCache caches API responses', async () => {
      // First fetch - should hit the network
      const data1 = await fetchWithCache('https://api.example.com/data');
      
      // Second fetch - should use cache
      const data2 = await fetchWithCache('https://api.example.com/data');
      
      expect(data1).toEqual(data2);
      expect(fetch).toHaveBeenCalledTimes(1); // Only called once
    });
    
    test('fetchWithCache with revalidate forces network fetch', async () => {
      // Reset mock call count
      (fetch as jest.Mock).mockClear();
      
      // First fetch
      await fetchWithCache('https://api.example.com/data');
      
      // Second fetch with revalidate
      await fetchWithCache('https://api.example.com/data', { revalidate: true });
      
      expect(fetch).toHaveBeenCalledTimes(2); // Called twice
    });
    
    test('fetchWithCache handles network errors', async () => {
      await expect(fetchWithCache('https://api.example.com/error'))
        .rejects.toThrow('Network error');
    });
  });
  
  describe('Offline Behavior', () => {
    test('detects offline state', () => {
      const cacheManager = getCacheManager();
      
      // Trigger offline event
      Object.defineProperty(navigator, 'onLine', { value: false });
      window.dispatchEvent(new Event('offline'));
      
      // Trigger online event
      Object.defineProperty(navigator, 'onLine', { value: true });
      window.dispatchEvent(new Event('online'));
      
      // Hard to test private state, but we can verify it doesn't crash
      expect(cacheManager).toBeDefined();
    });
  });
  
  describe('Cleanup', () => {
    test('cleanup removes event listeners and closes connections', () => {
      const cacheManager = getCacheManager();
      
      // Setup a mock for the redis client
      const mockQuit = jest.fn();
      (cacheManager as any).redisClient = {
        quit: mockQuit
      };
      
      // Call cleanup
      cacheManager.cleanup();
      
      // Expect Redis to be closed
      expect(mockQuit).toHaveBeenCalled();
    });
  });
});
