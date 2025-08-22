import { getCacheManager } from '../cache-manager';

describe('Tag Invalidation Debugging', () => {
  let cacheManager: ReturnType<typeof getCacheManager>;
  
  beforeEach(() => {
    // Create a fresh instance for each test
    cacheManager = getCacheManager();
  });
  
  test('invalidate by tag works correctly', async () => {
    // Set up test items
    console.log('Setting up test item with tag1...');
    await cacheManager.set('test', 'item1', { id: 1 }, { 
      tags: ['tag1'],
      skipStorage: ['redis', 'indexeddb', 'local']
    });
    
    // Verify item is cached
    const beforeInvalidate = await cacheManager.get('test', 'item1');
    console.log('Before invalidate:', beforeInvalidate);
    expect(beforeInvalidate).not.toBeNull();
    
    // Add debug logging to check memory cache entries
    // @ts-ignore - Accessing private property for debugging
    const memoryCache = (cacheManager as any).memoryCache;
    console.log('Memory cache entries before invalidation:');
    for (const [key, entry] of memoryCache.entries()) {
      console.log('Key:', key);
      console.log('Entry key:', entry.key);
      console.log('Entry tags:', JSON.stringify(entry.tags));
      console.log('Entry data:', JSON.stringify(entry.data));
      console.log('---------------------------');
    }
    
    // Directly inspect the hasMatchingTags method
    // @ts-ignore - Accessing private method for debugging
    const hasMatchingTags = (cacheManager as any).hasMatchingTags.bind(cacheManager);
    const entryFromMap = memoryCache.get('test:item1');
    console.log('Entry from map:', entryFromMap);
    if (entryFromMap) {
      const tagsMatch = hasMatchingTags(entryFromMap.tags, ['tag1']);
      console.log('Do tags match? (manual check):', tagsMatch);
    }
    
    // Perform invalidation
    console.log('Invalidating items with tag1...');
    await cacheManager.invalidate('test', undefined, { 
      tags: ['tag1'],
      onlyFrom: ['memory']
    });
    
    // Check memory cache after invalidation
    console.log('Memory cache entries after invalidation:');
    for (const [key, entry] of memoryCache.entries()) {
      console.log('Key:', key);
      console.log('Entry key:', entry.key);
      console.log('Entry tags:', JSON.stringify(entry.tags));
      console.log('Entry data:', JSON.stringify(entry.data));
      console.log('---------------------------');
    }
    
    // Check after invalidation
    const afterInvalidate = await cacheManager.get('test', 'item1');
    console.log('After invalidate:', afterInvalidate);
    expect(afterInvalidate).toBeNull();
  });
});
