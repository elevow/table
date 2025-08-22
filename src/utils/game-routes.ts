/**
 * Utility for game-related route information
 * This is dynamically imported to reduce initial bundle size
 */
import { getCacheManager } from './cache-manager';

interface GameRoute {
  id: string;
  path: string;
  components: string[];
  priority: 'high' | 'medium' | 'low';
  offlineSupport?: boolean;
}

export const gameRoutes: GameRoute[] = [
  { 
    id: 'poker-texas-holdem',
    path: '/game/poker-texas-holdem',
    components: ['GameBoard', 'PlayerStats', 'ChatPanel'],
    priority: 'high',
    offlineSupport: true
  },
  { 
    id: 'poker-omaha',
    path: '/game/poker-omaha',
    components: ['GameBoard', 'PlayerStats', 'ChatPanel'],
    priority: 'medium',
    offlineSupport: true
  },
  {
    id: 'tournament',
    path: '/game/tournament',
    components: ['GameBoard', 'PlayerStats', 'ChatPanel', 'TournamentBracket'],
    priority: 'medium',
    offlineSupport: false
  }
];

/**
 * Get recommended routes based on user history
 */
export const getRecommendedRoutes = (): GameRoute[] => {
  if (typeof window === 'undefined') return [];
  
  try {
    // Get user's game history from localStorage
    const gameHistory = JSON.parse(localStorage.getItem('game_history') || '[]');
    
    // Count game types played
    const gameCounts: Record<string, number> = {};
    gameHistory.forEach((game: any) => {
      const gameType = game.type;
      gameCounts[gameType] = (gameCounts[gameType] || 0) + 1;
    });
    
    // Sort by frequency
    const sortedGames = Object.entries(gameCounts)
      .sort(([, countA], [, countB]) => (countB as number) - (countA as number))
      .map(([gameType]) => gameType);
    
    // Return routes in order of user preference
    return gameRoutes
      .filter(route => sortedGames.some(game => route.id.includes(game)))
      .concat(gameRoutes.filter(route => !sortedGames.some(game => route.id.includes(game))));
  } catch (error) {
    console.error('Error getting recommended routes:', error);
    return gameRoutes;
  }
};

/**
 * Prefetch components for a specific game type
 */
export const prefetchGameComponents = async (gameType: string): Promise<void> => {
  const route = gameRoutes.find(r => r.id === gameType);
  if (!route) return;
  
  // In a real implementation, this would use dynamic imports to prefetch components
  console.log(`Prefetching components for ${gameType}:`, route.components);
  
  // Example of how you would actually prefetch each component
  if (route.components.includes('GameBoard')) {
    // This is just a mock implementation - in real code you would use:
    // await import('../components/GameBoard')
    console.log('Prefetched GameBoard');
  }
  
  if (route.components.includes('TournamentBracket')) {
    // await import('../components/TournamentBracket')
    console.log('Prefetched TournamentBracket');
  }
};

/**
 * Cache game data for offline support
 */
export const cacheGameData = async (gameType: string): Promise<boolean> => {
  const route = gameRoutes.find(r => r.id === gameType);
  if (!route || !route.offlineSupport) {
    console.log(`Caching not available for ${gameType}`);
    return false;
  }
  
  try {
    const cacheManager = getCacheManager();
    
    // Cache static game assets
    const gameAssets = [
      `/assets/games/${gameType}/board.svg`,
      `/assets/games/${gameType}/cards.svg`,
      `/assets/games/${gameType}/chips.svg`,
      `/assets/games/${gameType}/config.json`
    ];
    
    // Cache API responses for game rules
    const gameRulesUrl = `/api/games/${gameType}/rules`;
    const gameRules = await fetch(gameRulesUrl).then(res => res.json());
    await cacheManager.set('gameData', `${gameType}-rules`, gameRules, {
      ttl: 86400, // 24 hours
      tags: ['gameRules', gameType]
    });
    
    // Notify service worker to cache game assets
    if (typeof navigator !== 'undefined' && 
        'serviceWorker' in navigator && 
        navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_GAME_ASSETS',
        payload: {
          gameType,
          urls: gameAssets
        }
      });
    }
    
    console.log(`Cached game data for ${gameType}`);
    return true;
  } catch (error) {
    console.error(`Failed to cache game data for ${gameType}:`, error);
    return false;
  }
};

/**
 * Get offline-supported game routes
 */
export const getOfflineSupportedRoutes = (): GameRoute[] => {
  return gameRoutes.filter(route => route.offlineSupport);
};
