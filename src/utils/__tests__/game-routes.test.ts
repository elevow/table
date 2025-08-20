import { gameRoutes, getRecommendedRoutes, prefetchGameComponents } from '../game-routes';

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
  };
})();

describe('Game Routes', () => {
  beforeEach(() => {
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true
    });
    
    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Clear localStorage mock before each test
    mockLocalStorage.clear();
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  test('gameRoutes should contain expected game types', () => {
    expect(gameRoutes).toHaveLength(3);
    
    const gameTypes = gameRoutes.map(route => route.id);
    expect(gameTypes).toContain('poker-texas-holdem');
    expect(gameTypes).toContain('poker-omaha');
    expect(gameTypes).toContain('tournament');
    
    // Check structure of each route object
    gameRoutes.forEach(route => {
      expect(route).toHaveProperty('id');
      expect(route).toHaveProperty('path');
      expect(route).toHaveProperty('components');
      expect(route).toHaveProperty('priority');
      expect(['high', 'medium', 'low']).toContain(route.priority);
    });
  });
  
  describe('getRecommendedRoutes', () => {
    test('returns all routes when no game history exists', () => {
      const recommended = getRecommendedRoutes();
      expect(recommended).toEqual(gameRoutes);
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith('game_history');
    });
    
    test('prioritizes routes based on user game history', () => {
      // Let's analyze the actual implementation of getRecommendedRoutes
      // It seems to filter routes containing any game types from history, 
      // then concatenates other routes
      
      // Set up mock game history in localStorage with only one game type
      const gameHistory = [
        { type: 'poker-omaha', date: '2025-08-15' },
        { type: 'poker-omaha', date: '2025-08-16' }
      ];
      mockLocalStorage.setItem('game_history', JSON.stringify(gameHistory));
      
      const recommended = getRecommendedRoutes();
      
      // The Omaha route should appear before other routes
      expect(recommended[0].id).toBe('poker-omaha');
      
      // All routes should still be present
      expect(recommended.map(route => route.id)).toContain('poker-texas-holdem');
      expect(recommended.map(route => route.id)).toContain('tournament');
      expect(recommended).toHaveLength(gameRoutes.length);
    });
    
    test('handles invalid localStorage data gracefully', () => {
      // Set invalid JSON in localStorage
      mockLocalStorage.setItem('game_history', 'invalid json');
      
      const recommended = getRecommendedRoutes();
      
      // Should return default routes
      expect(recommended).toEqual(gameRoutes);
      expect(console.error).toHaveBeenCalledWith(
        'Error getting recommended routes:',
        expect.any(Error)
      );
    });
  });
  
  describe('prefetchGameComponents', () => {
    test('prefetches components for a valid game type', async () => {
      await prefetchGameComponents('poker-texas-holdem');
      
      expect(console.log).toHaveBeenCalledWith(
        'Prefetching components for poker-texas-holdem:',
        expect.arrayContaining(['GameBoard', 'PlayerStats', 'ChatPanel'])
      );
      expect(console.log).toHaveBeenCalledWith('Prefetched GameBoard');
    });
    
    test('handles tournament game type with special components', async () => {
      await prefetchGameComponents('tournament');
      
      expect(console.log).toHaveBeenCalledWith(
        'Prefetching components for tournament:',
        expect.arrayContaining(['GameBoard', 'PlayerStats', 'ChatPanel', 'TournamentBracket'])
      );
      expect(console.log).toHaveBeenCalledWith('Prefetched GameBoard');
      expect(console.log).toHaveBeenCalledWith('Prefetched TournamentBracket');
    });
    
    test('does nothing for invalid game type', async () => {
      await prefetchGameComponents('invalid-game');
      
      // Should not log anything if game type doesn't exist
      expect(console.log).not.toHaveBeenCalled();
    });
  });
});
