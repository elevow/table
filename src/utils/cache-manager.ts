/**
 * Comprehensive caching strategy implementation
 * Provides tiered caching for API responses, state data, and static assets
 * Supports memory, Redis, localStorage, and IndexedDB storage
 */

import { Redis } from 'ioredis';

// Types based on the user story requirements
export type CacheStorage = 'memory' | 'redis' | 'local' | 'indexeddb';

export interface InvalidationRule {
  pattern: string | RegExp;
  ttl?: number;
  tags?: string[];
  dependencies?: string[];
}

export interface CacheConfig {
  storage: CacheStorage;
  ttl: number; // Time to live in seconds
  maxSize: number; // Max size in bytes or entries
  invalidationRules: InvalidationRule[];
  namespace?: string;
  compression?: boolean;
}

export interface CacheEntry<T = any> {
  key: string;
  data: T;
  expires: number; // Timestamp when the entry expires
  tags: string[];
  version: number;
  size?: number; // Approximate size in bytes
}

// Cache management singleton
class CacheManager {
  private static instance: CacheManager;
  private memoryCache: Map<string, CacheEntry> = new Map();
  private redisClient: Redis | null = null;
  private config: Record<string, CacheConfig> = {};
  private idbDatabase: IDBDatabase | null = null;
  private isOffline = false;
  private pendingOperations: Array<() => Promise<void>> = [];
  private cacheVersion = 1;
  private cacheSize = 0;
  private serviceWorkerRegistration: ServiceWorkerRegistration | null = null;

  private constructor() {
    if (typeof window !== 'undefined') {
      // Initialize browser-specific caching
      this.initBrowserCache();
      this.setupOfflineDetection();
      this.registerServiceWorker();
    }
  }

  public static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  /**
   * Initialize Redis client for server-side caching
   */
  public initRedis(options: { host: string; port: number; password?: string }): void {
    try {
      if (typeof window === 'undefined') {
        this.redisClient = new Redis(options);
        // console.log('Redis cache initialized');
      }
    } catch (error) {
      console.error('Failed to initialize Redis cache:', error);
    }
  }

  /**
   * Initialize browser-specific caching mechanisms
   */
  private async initBrowserCache(): Promise<void> {
    // Check for IndexedDB support
    if ('indexedDB' in window) {
      try {
        const request = indexedDB.open('AppCache', this.cacheVersion);
        
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          // Create object stores for different cache types
          if (!db.objectStoreNames.contains('apiCache')) {
            db.createObjectStore('apiCache', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('stateCache')) {
            db.createObjectStore('stateCache', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('assetCache')) {
            db.createObjectStore('assetCache', { keyPath: 'key' });
          }
        };
        
        request.onsuccess = (event) => {
          this.idbDatabase = (event.target as IDBOpenDBRequest).result;
          // console.log('IndexedDB cache initialized');
          
          // Process any pending operations
          this.processPendingOperations();
        };
        
        request.onerror = (event) => {
          console.error('Failed to initialize IndexedDB cache:', event);
        };
      } catch (error) {
        console.error('Error setting up IndexedDB:', error);
      }
    }
  }

  /**
   * Configure cache settings for a specific namespace
   */
  public configure(namespace: string, config: CacheConfig): void {
    this.config[namespace] = {
      ...config,
      namespace
    };
    // console.log(`Cache configured for namespace: ${namespace}`);
  }

  /**
   * Store data in the appropriate cache
   */
  public async set<T>(
    namespace: string,
    key: string,
    data: T,
    options?: {
      ttl?: number;
      tags?: string[];
      skipStorage?: CacheStorage[];
    }
  ): Promise<boolean> {
    const config = this.config[namespace] || {
      storage: 'memory',
      ttl: 3600, // 1 hour default
      maxSize: 1000,
      invalidationRules: []
    };

    const ttl = options?.ttl || config.ttl;
    const tags = options?.tags || [];
    const expires = Date.now() + ttl * 1000;
    const skipStorage = options?.skipStorage || [];

    const entry: CacheEntry<T> = {
      key: this.formatKey(namespace, key),
      data,
      expires,
      tags,
      version: this.cacheVersion,
      size: this.estimateSize(data)
    };

    try {
      // Try to store in all configured storages, respecting the skipStorage option
      const storagePromises: Promise<boolean>[] = [];

      // Memory cache (always available)
      if (!skipStorage.includes('memory')) {
        this.setInMemory(entry, config);
        storagePromises.push(Promise.resolve(true));
      }

      // Redis cache (server-side only)
      if (config.storage === 'redis' && !skipStorage.includes('redis') && this.redisClient && typeof window === 'undefined') {
        storagePromises.push(this.setInRedis(entry));
      }

      // LocalStorage (browser-side only)
      if (config.storage === 'local' && !skipStorage.includes('local') && typeof window !== 'undefined') {
        storagePromises.push(this.setInLocalStorage(entry));
      }

      // IndexedDB (browser-side only)
      if (config.storage === 'indexeddb' && !skipStorage.includes('indexeddb') && this.idbDatabase && typeof window !== 'undefined') {
        storagePromises.push(this.setInIndexedDB(entry, namespace));
      }

      // Wait for all storage operations to complete
      const results = await Promise.all(storagePromises);
      return results.some(result => result);
    } catch (error) {
      console.error(`Failed to set cache entry ${key} in namespace ${namespace}:`, error);
      return false;
    }
  }

  /**
   * Retrieve data from cache, trying each storage type in order of speed
   */
  public async get<T>(
    namespace: string,
    key: string,
    options?: {
      forceFresh?: boolean;
      onlyFrom?: CacheStorage[];
    }
  ): Promise<T | null> {
    const formattedKey = this.formatKey(namespace, key);
    const config = this.config[namespace];
    const onlyFrom = options?.onlyFrom || [];
    
    // Skip cache if forceFresh is true
    if (options?.forceFresh) {
      return null;
    }

    try {
      // Try memory cache first (fastest)
      if (this.memoryCache.has(formattedKey) && (onlyFrom.length === 0 || onlyFrom.includes('memory'))) {
        const entry = this.memoryCache.get(formattedKey) as CacheEntry<T>;
        if (entry.expires > Date.now()) {
          return entry.data;
        } else {
          // Remove expired entry
          this.memoryCache.delete(formattedKey);
        }
      }

      // If in browser context, try localStorage
      if (
        typeof window !== 'undefined' &&
        (onlyFrom.length === 0 || onlyFrom.includes('local')) &&
        (config?.storage === 'local' || !config)
      ) {
        const result = await this.getFromLocalStorage<T>(formattedKey);
        if (result) return result;
      }

      // If in browser context and IndexedDB is available, try it
      if (
        typeof window !== 'undefined' &&
        this.idbDatabase &&
        (onlyFrom.length === 0 || onlyFrom.includes('indexeddb')) &&
        (config?.storage === 'indexeddb' || !config)
      ) {
        const result = await this.getFromIndexedDB<T>(formattedKey, namespace);
        if (result) return result;
      }

      // If Redis is available (server-side), try it
      if (
        this.redisClient &&
        typeof window === 'undefined' &&
        (onlyFrom.length === 0 || onlyFrom.includes('redis')) &&
        (config?.storage === 'redis' || !config)
      ) {
        const result = await this.getFromRedis<T>(formattedKey);
        if (result) return result;
      }

      // Not found in any cache
      return null;
    } catch (error) {
      console.error(`Error retrieving cache entry ${key} from namespace ${namespace}:`, error);
      return null;
    }
  }

  /**
   * Remove data from all caches
   */
  public async invalidate(
    namespace: string,
    key?: string,
    options?: {
      tags?: string[];
      onlyFrom?: CacheStorage[];
    }
  ): Promise<boolean> {
    const tags = options?.tags || [];
    const onlyFrom = options?.onlyFrom || [];
    const formattedKey = key ? this.formatKey(namespace, key) : null;

    try {
      // Track which storage types were affected
      const affectedStorages: CacheStorage[] = [];

      // Invalidate from memory cache
      if (onlyFrom.length === 0 || onlyFrom.includes('memory')) {
        if (formattedKey) {
          // Invalidate specific key
          if (this.memoryCache.delete(formattedKey)) {
            affectedStorages.push('memory');
          }
        } else if (tags.length > 0) {
          // Invalidate by tags
          let removed = false;
          
          // Convert Map entries to array for more reliable iteration
          const entries = Array.from(this.memoryCache);
          
          for (let i = 0; i < entries.length; i++) {
            const [entryKey, entry] = entries[i];
            
            if (entry.key.startsWith(`${namespace}:`) && this.hasMatchingTags(entry.tags, tags)) {
              this.memoryCache.delete(entryKey);
              removed = true;
            }
          }
          if (removed) {
            affectedStorages.push('memory');
          }
        } else {
          // Invalidate entire namespace
          let removed = false;
          
          // Convert keys to array for more reliable iteration
          const entries = Array.from(this.memoryCache);
          
          for (let i = 0; i < entries.length; i++) {
            const [entryKey, entry] = entries[i];
            
            if (entryKey.startsWith(`${namespace}:`)) {
              this.memoryCache.delete(entryKey);
              removed = true;
            }
          }
          if (removed) {
            affectedStorages.push('memory');
          }
        }
      }

      // Invalidate from Redis
      if (
        this.redisClient &&
        typeof window === 'undefined' &&
        (onlyFrom.length === 0 || onlyFrom.includes('redis'))
      ) {
        let removed = false;
        if (formattedKey) {
          const result = await this.redisClient.del(formattedKey);
          removed = result > 0;
        } else if (tags.length > 0) {
          // Redis doesn't have native tag support, so we need to scan for keys with the namespace
          // and then check their tags
          const keys = await this.redisClient.keys(`${namespace}:*`);
          for (const key of keys) {
            const rawData = await this.redisClient.get(key);
            if (rawData) {
              try {
                const entry = JSON.parse(rawData) as CacheEntry;
                if (this.hasMatchingTags(entry.tags, tags)) {
                  await this.redisClient.del(key);
                  removed = true;
                }
              } catch (e) {
                // Skip invalid entries
              }
            }
          }
        } else {
          // Invalidate entire namespace
          const keys = await this.redisClient.keys(`${namespace}:*`);
          if (keys.length > 0) {
            await this.redisClient.del(...keys);
            removed = true;
          }
        }

        if (removed) {
          affectedStorages.push('redis');
        }
      }

      // Invalidate from localStorage
      if (
        typeof window !== 'undefined' &&
        (onlyFrom.length === 0 || onlyFrom.includes('local'))
      ) {
        let removed = false;
        if (formattedKey) {
          // Remove specific key
          localStorage.removeItem(formattedKey);
          removed = true;
        } else if (tags.length > 0) {
          // Find and remove entries with matching tags
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(`${namespace}:`)) {
              try {
                const rawData = localStorage.getItem(key);
                if (rawData) {
                  const entry = JSON.parse(rawData) as CacheEntry;
                  if (this.hasMatchingTags(entry.tags, tags)) {
                    localStorage.removeItem(key);
                    removed = true;
                  }
                }
              } catch (e) {
                // Skip invalid entries
              }
            }
          }
        } else {
          // Remove entire namespace
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(`${namespace}:`)) {
              keysToRemove.push(key);
            }
          }
          for (const key of keysToRemove) {
            localStorage.removeItem(key);
          }
          removed = keysToRemove.length > 0;
        }

        if (removed) {
          affectedStorages.push('local');
        }
      }

      // Invalidate from IndexedDB
      if (
        this.idbDatabase &&
        typeof window !== 'undefined' &&
        (onlyFrom.length === 0 || onlyFrom.includes('indexeddb'))
      ) {
        try {
          const stores = ['apiCache', 'stateCache', 'assetCache'];
          let removed = false;

          for (const store of stores) {
            const transaction = this.idbDatabase.transaction(store, 'readwrite');
            const objectStore = transaction.objectStore(store);

            if (formattedKey) {
              // Remove specific key
              objectStore.delete(formattedKey);
              removed = true;
            } else {
              // We need to iterate over all entries to check namespace and tags
              const request = objectStore.openCursor();
              
              request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
                if (cursor) {
                  const entry = cursor.value as CacheEntry;
                  
                  // Check if entry belongs to namespace
                  if (entry.key.startsWith(`${namespace}:`)) {
                    if (tags.length === 0 || this.hasMatchingTags(entry.tags, tags)) {
                      cursor.delete();
                      removed = true;
                    }
                  }
                  
                  cursor.continue();
                }
              };
              
              await new Promise(resolve => {
                transaction.oncomplete = resolve;
              });
            }
          }

          if (removed) {
            affectedStorages.push('indexeddb');
          }
        } catch (error) {
          console.error('Error invalidating IndexedDB cache:', error);
        }
      }

      return affectedStorages.length > 0;
    } catch (error) {
      console.error(`Failed to invalidate cache for namespace ${namespace}:`, error);
      return false;
    }
  }

  /**
   * Clear an entire namespace from all caches
   */
  public async clearNamespace(namespace: string, options?: { onlyFrom?: CacheStorage[] }): Promise<boolean> {
    try {
      const onlyFrom = options?.onlyFrom || [];
      let removed = false;

      // Clear from memory cache
      if (onlyFrom.length === 0 || onlyFrom.includes('memory')) {
        Array.from(this.memoryCache.keys()).forEach(entryKey => {
          if (entryKey.startsWith(`${namespace}:`)) {
            this.memoryCache.delete(entryKey);
            removed = true;
          }
        });
      }

      // Clear from Redis cache if available
      if (this.redisClient && typeof window === 'undefined' && 
          (onlyFrom.length === 0 || onlyFrom.includes('redis'))) {
        const keys = await this.redisClient.keys(`${namespace}:*`);
        if (keys.length > 0) {
          await this.redisClient.del(...keys);
          removed = true;
        }
      }

      // Clear from localStorage if available
      if (typeof window !== 'undefined' && 
          (onlyFrom.length === 0 || onlyFrom.includes('local'))) {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(`${namespace}:`)) {
            keysToRemove.push(key);
          }
        }
        for (const key of keysToRemove) {
          localStorage.removeItem(key);
        }
        removed = removed || keysToRemove.length > 0;
      }

      // Clear from IndexedDB if available
      if (this.idbDatabase && typeof window !== 'undefined' && 
          (onlyFrom.length === 0 || onlyFrom.includes('indexeddb'))) {
        try {
          const stores = ['apiCache', 'stateCache', 'assetCache'];

          for (const store of stores) {
            const transaction = this.idbDatabase.transaction(store, 'readwrite');
            const objectStore = transaction.objectStore(store);

            // We need to iterate over all entries to check namespace
            const request = objectStore.openCursor();
            
            request.onsuccess = (event) => {
              const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
              if (cursor) {
                const entry = cursor.value as CacheEntry;
                
                // Check if entry belongs to namespace
                if (entry.key.startsWith(`${namespace}:`)) {
                  cursor.delete();
                  removed = true;
                }
                
                cursor.continue();
              }
            };
            
            await new Promise(resolve => {
              transaction.oncomplete = resolve;
            });
          }
        } catch (error) {
          console.error('Error clearing namespace from IndexedDB cache:', error);
        }
      }

      return removed;
    } catch (error) {
      console.error(`Failed to clear namespace ${namespace}:`, error);
      return false;
    }
  }

  /**
   * Clear all caches completely
   */
  public async clearAll(options?: { onlyFrom?: CacheStorage[] }): Promise<boolean> {
    try {
      const onlyFrom = options?.onlyFrom || [];

      // Clear memory cache
      if (onlyFrom.length === 0 || onlyFrom.includes('memory')) {
        this.memoryCache.clear();
        this.cacheSize = 0;
      }

      // Clear Redis cache if available
      if (this.redisClient && typeof window === 'undefined' && 
          (onlyFrom.length === 0 || onlyFrom.includes('redis'))) {
        await this.redisClient.flushall();
      }

      // Clear localStorage if available
      if (typeof window !== 'undefined' && 
          (onlyFrom.length === 0 || onlyFrom.includes('local'))) {
        // Only clear our cache-related items, not all localStorage
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && Object.keys(this.config).some(namespace => key.startsWith(`${namespace}:`))) {
            keysToRemove.push(key);
          }
        }
        for (const key of keysToRemove) {
          localStorage.removeItem(key);
        }
      }

      // Clear IndexedDB if available
      if (this.idbDatabase && typeof window !== 'undefined' && 
          (onlyFrom.length === 0 || onlyFrom.includes('indexeddb'))) {
        const stores = ['apiCache', 'stateCache', 'assetCache'];
        
        for (const store of stores) {
          const transaction = this.idbDatabase.transaction(store, 'readwrite');
          const objectStore = transaction.objectStore(store);
          objectStore.clear();
          
          await new Promise(resolve => {
            transaction.oncomplete = resolve;
          });
        }
      }

      return true;
    } catch (error) {
      console.error('Failed to clear all caches:', error);
      return false;
    }
  }

  /**
   * Set up API response caching wrapper
   */
  public async cacheApiResponse<T>(
    url: string,
    fetcher: () => Promise<T>,
    options: {
      ttl?: number;
      tags?: string[];
      namespace?: string;
      revalidate?: boolean;
    } = {}
  ): Promise<T> {
    const namespace = options.namespace || 'api';
    const cacheKey = url;

    // Make sure the namespace is configured
    if (!this.config[namespace]) {
      this.configure(namespace, {
        storage: 'memory',
        ttl: 3600,
        maxSize: 1000,
        invalidationRules: []
      });
    }

    // Try to get from cache first
    const cached = await this.get<T>(namespace, cacheKey, {
      forceFresh: options.revalidate || false
    });

    if (cached !== null) {
      // Return cached data
      return cached;
    }

    try {
      // Fetch fresh data
      const data = await fetcher();
      
      // Store in cache
      await this.set(namespace, cacheKey, data, {
        ttl: options.ttl || 3600,
        tags: options.tags || []
      });
      
      return data;
    } catch (error) {
      console.error(`Error fetching and caching data for ${url}:`, error);
      throw error;
    }
  }

  /**
   * Setup offline detection
   */
  private setupOfflineDetection(): void {
    if (typeof window !== 'undefined') {
      // Initial state
      this.isOffline = !navigator.onLine;
      
      // Listen for connection changes
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  /**
   * Register service worker for asset caching
   */
  private async registerServiceWorker(): Promise<void> {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/service-worker.js');
        this.serviceWorkerRegistration = registration;
        // console.log('Service worker registered successfully');
        
        // Setup message channel for communication with service worker
        const messageChannel = new MessageChannel();
        
        navigator.serviceWorker.controller?.postMessage({
          type: 'INIT_CACHE_CHANNEL'
        }, [messageChannel.port2]);
        
        // Listen for messages from the service worker
        messageChannel.port1.onmessage = (event) => {
          const { type, payload } = event.data;
          
          if (type === 'CACHE_UPDATED') {
            // console.log('Service worker updated cache:', payload);
          }
        };
      } catch (error) {
        console.error('Service worker registration failed:', error);
      }
    }
  }

  /**
   * Handle online event
   */
  private handleOnline = async (): Promise<void> => {
    this.isOffline = false;
    // console.log('App is online. Processing pending operations...');
    
    // Process any pending operations queued while offline
    this.processPendingOperations();
  };

  /**
   * Handle offline event
   */
  private handleOffline = (): void => {
    this.isOffline = true;
    // console.log('App is offline. Operations will be queued.');
  };

  /**
   * Process operations that were queued while offline
   */
  private async processPendingOperations(): Promise<void> {
    if (this.pendingOperations.length === 0) {
      return;
    }
    
    // console.log(`Processing ${this.pendingOperations.length} pending operations`);
    
    const operations = [...this.pendingOperations];
    this.pendingOperations = [];
    
    for (const operation of operations) {
      try {
        await operation();
      } catch (error) {
        console.error('Failed to process pending operation:', error);
        // Re-queue failed operations
        this.pendingOperations.push(operation);
      }
    }
  }

  /**
   * Store an entry in memory cache
   */
  private setInMemory<T>(entry: CacheEntry<T>, config: CacheConfig): boolean {
    // Check if we need to evict entries to make space
    if (config.maxSize && config.maxSize > 0 && this.memoryCache.size >= config.maxSize) {
      this.evictLeastRecentlyUsed(config.maxSize * 0.2); // Evict 20% of max size
    }
    
    this.memoryCache.set(entry.key, entry);
    return true;
  }

  /**
   * Store an entry in Redis
   */
  private async setInRedis<T>(entry: CacheEntry<T>): Promise<boolean> {
    if (!this.redisClient) {
      return false;
    }
    
    try {
      const serialized = JSON.stringify(entry);
      await this.redisClient.set(
        entry.key,
        serialized,
        'EX',
        Math.ceil((entry.expires - Date.now()) / 1000)
      );
      return true;
    } catch (error) {
      console.error('Redis cache set error:', error);
      return false;
    }
  }

  /**
   * Store an entry in localStorage
   */
  private async setInLocalStorage<T>(entry: CacheEntry<T>): Promise<boolean> {
    try {
      const serialized = JSON.stringify(entry);
      
      // Check for quota issues
      try {
        localStorage.setItem(entry.key, serialized);
      } catch (e) {
        // If storage is full, clear expired items and try again
        this.clearExpiredLocalStorageItems();
        localStorage.setItem(entry.key, serialized);
      }
      
      return true;
    } catch (error) {
      console.error('localStorage cache set error:', error);
      return false;
    }
  }

  /**
   * Store an entry in IndexedDB
   */
  private setInIndexedDB<T>(entry: CacheEntry<T>, namespace: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.idbDatabase) {
        if (typeof window !== 'undefined') {
          // Queue for later execution
          this.pendingOperations.push(async () => {
            await this.setInIndexedDB(entry, namespace);
          });
        }
        resolve(false);
        return;
      }
      
      try {
        // Determine which object store to use based on namespace
        let storeName = 'apiCache';
        if (namespace.includes('state')) {
          storeName = 'stateCache';
        } else if (namespace.includes('asset')) {
          storeName = 'assetCache';
        }
        
        const transaction = this.idbDatabase.transaction(storeName, 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        
        const request = objectStore.put(entry);
        
        request.onsuccess = () => {
          resolve(true);
        };
        
        request.onerror = () => {
          console.error('IndexedDB cache set error:', request.error);
          resolve(false);
        };
      } catch (error) {
        console.error('IndexedDB cache set error:', error);
        resolve(false);
      }
    });
  }

  /**
   * Retrieve an entry from localStorage
   */
  private getFromLocalStorage<T>(key: string): T | null {
    try {
      const serialized = localStorage.getItem(key);
      if (!serialized) {
        return null;
      }
      
      const entry = JSON.parse(serialized) as CacheEntry<T>;
      
      // Check if expired
      if (entry.expires < Date.now()) {
        localStorage.removeItem(key);
        return null;
      }
      
      return entry.data;
    } catch (error) {
      console.error('localStorage cache get error:', error);
      return null;
    }
  }

  /**
   * Retrieve an entry from Redis
   */
  private async getFromRedis<T>(key: string): Promise<T | null> {
    if (!this.redisClient) {
      return null;
    }
    
    try {
      const serialized = await this.redisClient.get(key);
      if (!serialized) {
        return null;
      }
      
      const entry = JSON.parse(serialized) as CacheEntry<T>;
      
      // Check if expired (Redis should handle this with EX, but double-check)
      if (entry.expires < Date.now()) {
        await this.redisClient.del(key);
        return null;
      }
      
      return entry.data;
    } catch (error) {
      console.error('Redis cache get error:', error);
      return null;
    }
  }

  /**
   * Retrieve an entry from IndexedDB
   */
  private getFromIndexedDB<T>(key: string, namespace: string): Promise<T | null> {
    return new Promise((resolve) => {
      if (!this.idbDatabase) {
        resolve(null);
        return;
      }
      
      try {
        // Determine which object store to use based on namespace
        let storeName = 'apiCache';
        if (namespace.includes('state')) {
          storeName = 'stateCache';
        } else if (namespace.includes('asset')) {
          storeName = 'assetCache';
        }
        
        const transaction = this.idbDatabase.transaction(storeName, 'readonly');
        const objectStore = transaction.objectStore(storeName);
        
        const request = objectStore.get(key);
        
        request.onsuccess = () => {
          if (!request.result) {
            resolve(null);
            return;
          }
          
          const entry = request.result as CacheEntry<T>;
          
          // Check if expired
          if (entry.expires < Date.now()) {
            // Delete expired entry in a separate transaction
            const deleteTransaction = this.idbDatabase!.transaction(storeName, 'readwrite');
            const deleteStore = deleteTransaction.objectStore(storeName);
            deleteStore.delete(key);
            
            resolve(null);
            return;
          }
          
          resolve(entry.data);
        };
        
        request.onerror = () => {
          console.error('IndexedDB cache get error:', request.error);
          resolve(null);
        };
      } catch (error) {
        console.error('IndexedDB cache get error:', error);
        resolve(null);
      }
    });
  }

  /**
   * Format a cache key to include namespace
   */
  private formatKey(namespace: string, key: string): string {
    return `${namespace}:${key}`;
  }

  /**
   * Check if entry tags match any of the requested tags
   */
  private hasMatchingTags(entryTags: string[], requestedTags: string[]): boolean {
    // If the entry has no tags, it can't match any requested tags
    if (!entryTags || entryTags.length === 0) return false;
    
    // If no tags are requested for invalidation, don't match anything
    if (!requestedTags || requestedTags.length === 0) return false;
    
    // If any of the requested tags match any of the entry tags, return true
    return requestedTags.some(tag => entryTags.includes(tag));
  }

  /**
   * Evict least recently used entries from memory cache
   */
  private evictLeastRecentlyUsed(count: number): void {
    const entries = Array.from(this.memoryCache.entries());
    
    // Sort by expiration (oldest first)
    entries.sort((a, b) => a[1].expires - b[1].expires);
    
    // Remove the oldest entries
    const toRemove = entries.slice(0, Math.ceil(count));
    for (const [key] of toRemove) {
      this.memoryCache.delete(key);
    }
  }

  /**
   * Clear expired items from localStorage
   */
  private clearExpiredLocalStorageItems(): void {
    const now = Date.now();
    const keysToRemove: string[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      
      try {
        const serialized = localStorage.getItem(key);
        if (serialized) {
          const entry = JSON.parse(serialized) as CacheEntry;
          if (entry.expires < now) {
            keysToRemove.push(key);
          }
        }
      } catch (e) {
        // Skip non-cache entries
      }
    }
    
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  }

  /**
   * Estimate size of data in bytes
   */
  private estimateSize(data: any): number {
    if (data === null || data === undefined) {
      return 0;
    }
    
    if (typeof data === 'string') {
      return data.length * 2; // Rough estimate for UTF-16
    }
    
    if (typeof data === 'number') {
      return 8; // 64-bit number
    }
    
    if (typeof data === 'boolean') {
      return 1;
    }
    
    if (Array.isArray(data)) {
      return data.reduce((size, item) => size + this.estimateSize(item), 0);
    }
    
    if (typeof data === 'object') {
      let size = 0;
      for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          size += key.length * 2; // Key name
          size += this.estimateSize(data[key]); // Value
        }
      }
      return size;
    }
    
    return 0;
  }

  /**
   * Cleanup resources when app is unmounted
   */
  public cleanup(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    
    if (this.redisClient) {
      this.redisClient.quit();
      this.redisClient = null;
    }
    
    if (this.idbDatabase) {
      this.idbDatabase.close();
      this.idbDatabase = null;
    }
  }
}

// Singleton instance
export const getCacheManager = (): CacheManager => {
  return CacheManager.getInstance();
};

// API response caching helper
export const fetchWithCache = async <T>(
  url: string,
  options?: RequestInit & {
    ttl?: number;
    tags?: string[];
    revalidate?: boolean;
    namespace?: string;
  }
): Promise<T> => {
  const cacheManager = getCacheManager();
  
  const fetchOptions = { ...options };
  const cacheOptions = {
    ttl: options?.ttl,
    tags: options?.tags,
    namespace: options?.namespace || 'api',
    revalidate: options?.revalidate
  };
  
  // Delete cache-specific options from fetch options
  delete fetchOptions.ttl;
  delete fetchOptions.tags;
  delete fetchOptions.revalidate;
  delete fetchOptions.namespace;
  
  return cacheManager.cacheApiResponse<T>(
    url,
    async () => {
      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    },
    cacheOptions
  );
};

// State persistence helper
export const usePersistedState = <T>(
  key: string,
  initialValue: T,
  options?: {
    ttl?: number;
    namespace?: string;
  }
): [T, (value: T) => void] => {
  const cacheManager = getCacheManager();
  const namespace = options?.namespace || 'state';
  
  // Get initial state from cache or use provided initial value
  const getInitialState = async (): Promise<T> => {
    const cached = await cacheManager.get<T>(namespace, key);
    return cached !== null ? cached : initialValue;
  };
  
  // Setup state
  let state = initialValue;
  let setState: (value: T) => void;
  
  if (typeof window !== 'undefined') {
    // In browser environment, try to load from cache
    getInitialState().then(initialState => {
      state = initialState;
    });
    
    // Setup state setter
    setState = (value: T) => {
      state = value;
      cacheManager.set(namespace, key, value, {
        ttl: options?.ttl || 86400 * 7 // Default 1 week
      });
    };
  } else {
    // In server environment, just use the initial value
    setState = (value: T) => {
      state = value;
    };
  }
  
  return [state, setState];
};

// Asset preloading helper
export const preloadAsset = (url: string): Promise<boolean> => {
  const cacheManager = getCacheManager();
  
  return new Promise((resolve) => {
    // Check if already in cache
    cacheManager.get('asset', url).then(cached => {
      if (cached) {
        resolve(true);
        return;
      }
      
      // Not in cache, preload it
      if (url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
        // Image asset
        const img = new Image();
        img.onload = () => {
          cacheManager.set('asset', url, { url, timestamp: Date.now() }, {
            ttl: 86400 * 7 // 1 week
          });
          resolve(true);
        };
        img.onerror = () => resolve(false);
        img.src = url;
      } else if (url.match(/\.(css)$/i)) {
        // CSS asset
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'style';
        link.href = url;
        link.onload = () => {
          cacheManager.set('asset', url, { url, timestamp: Date.now() }, {
            ttl: 86400 * 7 // 1 week
          });
          resolve(true);
        };
        link.onerror = () => resolve(false);
        document.head.appendChild(link);
      } else if (url.match(/\.(js)$/i)) {
        // JavaScript asset
        const script = document.createElement('link');
        script.rel = 'preload';
        script.as = 'script';
        script.href = url;
        script.onload = () => {
          cacheManager.set('asset', url, { url, timestamp: Date.now() }, {
            ttl: 86400 * 7 // 1 week
          });
          resolve(true);
        };
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
      } else {
        // Other asset types, use fetch
        fetch(url)
          .then(response => {
            if (response.ok) {
              cacheManager.set('asset', url, { url, timestamp: Date.now() }, {
                ttl: 86400 * 7 // 1 week
              });
              resolve(true);
            } else {
              resolve(false);
            }
          })
          .catch(() => resolve(false));
      }
    });
  });
};
