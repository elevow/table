import { getCacheManager } from '../../utils/cache-manager';
import * as apiService from '../api-service';

// Mock cache manager
jest.mock('../../utils/cache-manager', () => {
  const mockCacheManager = {
    configure: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
    clearAll: jest.fn(),
    clearNamespace: jest.fn(),
    hasMatchingTags: jest.fn()
  };
  
  return {
    getCacheManager: jest.fn(() => mockCacheManager),
    fetchWithCache: jest.fn()
  };
});

// Mock fetch for API tests
global.fetch = jest.fn();

describe('API Service', () => {
  const mockCacheManager = getCacheManager();
  const originalConsoleLog = // console.log;
  
  beforeAll(() => {
    // Mock // console.log to avoid noise in test output
    // console.log = jest.fn();
  });
  
  afterAll(() => {
    // Restore // console.log
    // console.log = originalConsoleLog;
  });
  
  beforeEach(() => {
    // Clear mocks before each test
    jest.clearAllMocks();
  });
  
  describe('getGameById', () => {
    it('should return cached data when available', async () => {
      // Setup
      const mockGameData = { id: 'game-123', name: 'Test Game' };
      (mockCacheManager.get as jest.Mock).mockResolvedValueOnce(mockGameData);
      
      // Execute
      const result = await apiService.getGameById('game-123');
      
      // Verify
      expect(mockCacheManager.get).toHaveBeenCalledWith('gameData', 'game-game-123');
      expect(fetch).not.toHaveBeenCalled();
      expect(result).toEqual(mockGameData);
    });
    
    it('should fetch data from API when not cached', async () => {
      // Setup
      const mockGameData = { id: 'game-123', name: 'Test Game' };
      (mockCacheManager.get as jest.Mock).mockResolvedValueOnce(null);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockGameData)
      });
      
      // Execute
      const result = await apiService.getGameById('game-123');
      
      // Verify
      expect(mockCacheManager.get).toHaveBeenCalledWith('gameData', 'game-game-123');
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/games/game-123');
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'gameData', 
        'game-game-123', 
        mockGameData, 
        { ttl: 3600, tags: ['gameDetails', 'game-123'] }
      );
      expect(result).toEqual(mockGameData);
    });
    
    it('should throw an error when API fetch fails', async () => {
      // Setup
      (mockCacheManager.get as jest.Mock).mockResolvedValueOnce(null);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found'
      });
      
      // Execute & Verify
      await expect(apiService.getGameById('game-123')).rejects.toThrow('Failed to fetch game: Not Found');
      expect(mockCacheManager.get).toHaveBeenCalledWith('gameData', 'game-game-123');
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/games/game-123');
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });
    
    it('should handle network errors', async () => {
      // Setup
      const networkError = new Error('Network failure');
      (mockCacheManager.get as jest.Mock).mockResolvedValueOnce(null);
      (global.fetch as jest.Mock).mockRejectedValueOnce(networkError);
      
      // Execute & Verify
      await expect(apiService.getGameById('game-123')).rejects.toThrow(networkError);
      expect(mockCacheManager.get).toHaveBeenCalledWith('gameData', 'game-game-123');
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/games/game-123');
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });
  });
  
  describe('getGameRules', () => {
    it('should return cached rules when available', async () => {
      // Setup
      const mockRules = { type: 'poker', rules: ['rule1', 'rule2'] };
      (mockCacheManager.get as jest.Mock).mockResolvedValueOnce(mockRules);
      
      // Execute
      const result = await apiService.getGameRules('poker');
      
      // Verify
      expect(mockCacheManager.get).toHaveBeenCalledWith('gameData', 'poker-rules');
      expect(fetch).not.toHaveBeenCalled();
      expect(result).toEqual(mockRules);
    });
    
    it('should fetch rules from API when not cached', async () => {
      // Setup
      const mockRules = { type: 'poker', rules: ['rule1', 'rule2'] };
      (mockCacheManager.get as jest.Mock).mockResolvedValueOnce(null);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockRules)
      });
      
      // Execute
      const result = await apiService.getGameRules('poker');
      
      // Verify
      expect(mockCacheManager.get).toHaveBeenCalledWith('gameData', 'poker-rules');
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/games/poker/rules');
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'gameData', 
        'poker-rules', 
        mockRules, 
        { ttl: 86400, tags: ['gameRules', 'poker'] }
      );
      expect(result).toEqual(mockRules);
    });

    it('should throw an error when API fetch fails for game rules', async () => {
      // Setup
      (mockCacheManager.get as jest.Mock).mockResolvedValueOnce(null);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found'
      });
      
      // Execute & Verify
      await expect(apiService.getGameRules('poker')).rejects.toThrow('Failed to fetch game rules: Not Found');
      expect(mockCacheManager.get).toHaveBeenCalledWith('gameData', 'poker-rules');
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/games/poker/rules');
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });
  });
  
  describe('getUserProfile', () => {
    it('should return cached profile when available', async () => {
      // Setup
      const mockProfile = { id: 'user-123', name: 'Test User' };
      (mockCacheManager.get as jest.Mock).mockResolvedValueOnce(mockProfile);
      
      // Execute
      const result = await apiService.getUserProfile('user-123');
      
      // Verify
      expect(mockCacheManager.get).toHaveBeenCalledWith('userData', 'user-user-123');
      expect(fetch).not.toHaveBeenCalled();
      expect(result).toEqual(mockProfile);
    });
    
    it('should fetch profile from API when not cached', async () => {
      // Setup
      const mockProfile = { id: 'user-123', name: 'Test User' };
      (mockCacheManager.get as jest.Mock).mockResolvedValueOnce(null);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockProfile)
      });
      
      // Execute
      const result = await apiService.getUserProfile('user-123');
      
      // Verify
      expect(mockCacheManager.get).toHaveBeenCalledWith('userData', 'user-user-123');
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/users/user-123');
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'userData', 
        'user-user-123', 
        mockProfile, 
        { ttl: 300, tags: ['userProfile', 'user-123'] }
      );
      expect(result).toEqual(mockProfile);
    });

    it('should throw an error when API fetch fails for user profile', async () => {
      // Setup
      (mockCacheManager.get as jest.Mock).mockResolvedValueOnce(null);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found'
      });
      
      // Execute & Verify
      await expect(apiService.getUserProfile('user-123')).rejects.toThrow('Failed to fetch user profile: Not Found');
      expect(mockCacheManager.get).toHaveBeenCalledWith('userData', 'user-user-123');
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/users/user-123');
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });
  });
  
  describe('getUserGameHistory', () => {
    it('should return cached history when available', async () => {
      // Setup
      const mockHistory = [{ gameId: 'game-1' }, { gameId: 'game-2' }];
      (mockCacheManager.get as jest.Mock).mockResolvedValueOnce(mockHistory);
      
      // Execute
      const result = await apiService.getUserGameHistory('user-123');
      
      // Verify
      expect(mockCacheManager.get).toHaveBeenCalledWith('userData', 'user-user-123-history');
      expect(fetch).not.toHaveBeenCalled();
      expect(result).toEqual(mockHistory);
    });
    
    it('should fetch history from API when not cached', async () => {
      // Setup
      const mockHistory = [{ gameId: 'game-1' }, { gameId: 'game-2' }];
      (mockCacheManager.get as jest.Mock).mockResolvedValueOnce(null);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockHistory)
      });
      
      // Execute
      const result = await apiService.getUserGameHistory('user-123');
      
      // Verify
      expect(mockCacheManager.get).toHaveBeenCalledWith('userData', 'user-user-123-history');
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/users/user-123/history');
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'userData', 
        'user-user-123-history', 
        mockHistory, 
        { ttl: 600, tags: ['userHistory', 'user-123'] }
      );
      expect(result).toEqual(mockHistory);
    });
    
    it('should throw an error when API fetch fails', async () => {
      // Setup
      (mockCacheManager.get as jest.Mock).mockResolvedValueOnce(null);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found'
      });
      
      // Execute & Verify
      await expect(apiService.getUserGameHistory('user-123')).rejects.toThrow('Failed to fetch user game history: Not Found');
      expect(mockCacheManager.get).toHaveBeenCalledWith('userData', 'user-user-123-history');
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/users/user-123/history');
    });
  });
  
  describe('submitGameAction', () => {
    it('should submit action and invalidate cache', async () => {
      // Setup
      const mockAction = { type: 'move', data: { position: [1, 2] } };
      const mockResponse = { success: true };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockResponse)
      });
      
      // Execute
      const result = await apiService.submitGameAction('game-123', mockAction);
      
      // Verify
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/games/game-123/actions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(mockAction)
      });
      expect(mockCacheManager.invalidate).toHaveBeenCalledWith('gameData', undefined, {
        tags: ['game-123']
      });
      expect(result).toEqual(mockResponse);
    });
    
    it('should throw an error when API request fails', async () => {
      // Setup
      const mockAction = { type: 'move', data: { position: [1, 2] } };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request'
      });
      
      // Execute & Verify
      await expect(apiService.submitGameAction('game-123', mockAction)).rejects.toThrow('Failed to submit game action: Bad Request');
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/games/game-123/actions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(mockAction)
      });
      expect(mockCacheManager.invalidate).not.toHaveBeenCalled();
    });
  });
  
  describe('updateUserProfile', () => {
    it('should update profile and invalidate cache', async () => {
      // Setup
      const mockProfileData = { name: 'Updated Name' };
      const mockResponse = { success: true };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockResponse)
      });
      
      // Execute
      const result = await apiService.updateUserProfile('user-123', mockProfileData);
      
      // Verify
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/users/user-123', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(mockProfileData)
      });
      expect(mockCacheManager.invalidate).toHaveBeenCalledWith('userData', undefined, {
        tags: ['user-123']
      });
      expect(result).toEqual(mockResponse);
    });
    
    it('should throw an error when API request fails', async () => {
      // Setup
      const mockProfileData = { name: 'Updated Name' };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request'
      });
      
      // Execute & Verify
      await expect(apiService.updateUserProfile('user-123', mockProfileData)).rejects.toThrow('Failed to update user profile: Bad Request');
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/users/user-123', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(mockProfileData)
      });
      expect(mockCacheManager.invalidate).not.toHaveBeenCalled();
    });
  });
  
  describe('clearApiCache', () => {
    it('should clear all cache data', async () => {
      // Execute
      await apiService.clearApiCache();
      
      // Verify
      expect(mockCacheManager.clearAll).toHaveBeenCalled();
      expect(// console.log).toHaveBeenCalledWith('All API cache cleared');
    });
  });
});
