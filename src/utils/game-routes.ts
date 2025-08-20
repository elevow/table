/**
 * Utility for game-related route information
 * This is dynamically imported to reduce initial bundle size
 */

interface GameRoute {
  id: string;
  path: string;
  components: string[];
  priority: 'high' | 'medium' | 'low';
}

export const gameRoutes: GameRoute[] = [
  { 
    id: 'poker-texas-holdem',
    path: '/game/poker-texas-holdem',
    components: ['GameBoard', 'PlayerStats', 'ChatPanel'],
    priority: 'high'
  },
  { 
    id: 'poker-omaha',
    path: '/game/poker-omaha',
    components: ['GameBoard', 'PlayerStats', 'ChatPanel'],
    priority: 'medium'
  },
  {
    id: 'tournament',
    path: '/game/tournament',
    components: ['GameBoard', 'PlayerStats', 'ChatPanel', 'TournamentBracket'],
    priority: 'medium'
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
