import { getCacheManager, fetchWithCache, CacheStorage } from '../utils/cache-manager';

/**
 * API service for game-related operations
 * This demonstrates integrating the cache manager with API calls
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.example.com';

// Configure cache namespaces for different API endpoints
const cacheManager = getCacheManager();

// Configure game data cache - high priority, longer TTL
cacheManager.configure('gameData', {
  storage: 'memory' as CacheStorage, // Use memory storage
  ttl: 3600, // 1 hour
  maxSize: 50, // Limit to 50 items
  invalidationRules: []
});

// Configure user data cache - medium priority, short TTL
cacheManager.configure('userData', {
  storage: 'memory' as CacheStorage, // Only keep in memory
  ttl: 300, // 5 minutes
  maxSize: 20, // Limit to 20 items
  invalidationRules: []
});

// API functions that use the cache

/**
 * Get game details by ID
 */
export async function getGameById(gameId: string) {
  const cacheKey = `game-${gameId}`;
  
  // Check cache first
  const cached = await cacheManager.get('gameData', cacheKey);
  if (cached) return cached;
  
  // If not in cache, fetch from API
  const response = await fetch(`${API_BASE_URL}/games/${gameId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch game: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // Store in cache
  await cacheManager.set('gameData', cacheKey, data, {
    ttl: 3600,
    tags: ['gameDetails', gameId]
  });
  
  return data;
}

/**
 * Get game rules
 */
export async function getGameRules(gameType: string) {
  const cacheKey = `${gameType}-rules`;
  
  // Check cache first
  const cached = await cacheManager.get('gameData', cacheKey);
  if (cached) return cached;
  
  // If not in cache, fetch from API
  const response = await fetch(`${API_BASE_URL}/games/${gameType}/rules`);
  if (!response.ok) {
    throw new Error(`Failed to fetch game rules: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // Store in cache
  await cacheManager.set('gameData', cacheKey, data, {
    ttl: 86400, // 24 hours
    tags: ['gameRules', gameType]
  });
  
  return data;
}

/**
 * Get user profile
 */
export async function getUserProfile(userId: string) {
  const cacheKey = `user-${userId}`;
  
  // Check cache first
  const cached = await cacheManager.get('userData', cacheKey);
  if (cached) return cached;
  
  // If not in cache, fetch from API
  const response = await fetch(`${API_BASE_URL}/users/${userId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch user profile: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // Store in cache
  await cacheManager.set('userData', cacheKey, data, {
    ttl: 300, // 5 minutes
    tags: ['userProfile', userId]
  });
  
  return data;
}

/**
 * Get user game history
 */
export async function getUserGameHistory(userId: string) {
  const cacheKey = `user-${userId}-history`;
  
  // Check cache first
  const cached = await cacheManager.get('userData', cacheKey);
  if (cached) return cached;
  
  // If not in cache, fetch from API
  const response = await fetch(`${API_BASE_URL}/users/${userId}/history`);
  if (!response.ok) {
    throw new Error(`Failed to fetch user game history: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // Store in cache
  await cacheManager.set('userData', cacheKey, data, {
    ttl: 600, // 10 minutes
    tags: ['userHistory', userId]
  });
  
  return data;
}

/**
 * Submit game action (POST request that invalidates cache)
 */
export async function submitGameAction(gameId: string, action: any) {
  const response = await fetch(`${API_BASE_URL}/games/${gameId}/actions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(action)
  });
  
  if (!response.ok) {
    throw new Error(`Failed to submit game action: ${response.statusText}`);
  }
  
  // Invalidate related cache entries
  await cacheManager.invalidate('gameData', undefined, {
    tags: [gameId]
  });
  
  return response.json();
}

/**
 * Update user profile (POST request that invalidates cache)
 */
export async function updateUserProfile(userId: string, profileData: any) {
  const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(profileData)
  });
  
  if (!response.ok) {
    throw new Error(`Failed to update user profile: ${response.statusText}`);
  }
  
  // Invalidate related cache entries
  await cacheManager.invalidate('userData', undefined, {
    tags: [userId]
  });
  
  return response.json();
}

/**
 * Clear all cached API data
 */
export async function clearApiCache() {
  await cacheManager.clearAll();
  console.log('All API cache cleared');
}
