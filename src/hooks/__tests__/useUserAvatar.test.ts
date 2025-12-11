import { renderHook, act } from '@testing-library/react';
import { useUserAvatar } from '../useUserAvatar';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    })
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// Mock console methods to avoid noise in tests
const consoleMock = {
  warn: jest.fn(),
  error: jest.fn()
};

beforeEach(() => {
  // Clear all mocks before each test
  mockFetch.mockClear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear();
  consoleMock.warn.mockClear();
  consoleMock.error.mockClear();
  
  // Reset localStorage store
  localStorageMock.clear();
  
  // Mock console methods
  jest.spyOn(console, 'warn').mockImplementation(consoleMock.warn);
  jest.spyOn(console, 'error').mockImplementation(consoleMock.error);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useUserAvatar', () => {
  const mockUserId = 'user-123';
  const mockAvatarData = {
    id: 'avatar-1',
    url: 'https://example.com/avatar.jpg',
    thumbnails: { small: 'https://example.com/thumb.jpg' },
    status: 'active'
  };

  describe('initialization', () => {
    it('should return initial state with loading=true when userId provided', async () => {
      // Mock fetch to prevent actual API call during initialization
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAvatarData
      });

      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      expect(result.current.avatarData).toBeNull();
      expect(result.current.loading).toBe(true); // Should be true initially
      expect(result.current.error).toBeNull();
      expect(typeof result.current.refreshAvatar).toBe('function');
      expect(typeof result.current.updateAvatarData).toBe('function');
      
      // Wait for effect to complete
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      
      expect(result.current.loading).toBe(false);
    });

    it('should not fetch when userId is empty', () => {
      renderHook(() => useUserAvatar(''));
      
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('localStorage integration', () => {
    it('should load avatar data from localStorage if available', () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify(mockAvatarData));
      
      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      expect(localStorageMock.getItem).toHaveBeenCalledWith('user_avatar_data_user-123');
      expect(result.current.avatarData).toEqual(mockAvatarData);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle malformed localStorage data gracefully', () => {
      localStorageMock.getItem.mockReturnValue('invalid json');
      
      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      expect(consoleMock.warn).toHaveBeenCalledWith('Failed to load avatar from storage:', expect.any(Error));
      expect(result.current.avatarData).toBeNull();
    });

    it('should save avatar data to localStorage after successful fetch', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAvatarData
      });

      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      // Wait for the effect to complete
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'user_avatar_data_user-123', 
        JSON.stringify(mockAvatarData)
      );
    });

    it('should handle localStorage save errors gracefully', async () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });
      
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAvatarData
      });

      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(consoleMock.warn).toHaveBeenCalledWith('Failed to save avatar to storage:', expect.any(Error));
      expect(result.current.avatarData).toEqual(mockAvatarData);
    });

    it('should not cache data for alias-based requests like "me"', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAvatarData
      });

      renderHook(() => useUserAvatar('me'));
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // Should fetch from API since aliases are not cached
      expect(mockFetch).toHaveBeenCalled();
      // Should not try to save to localStorage for alias
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });
  });

  describe('API integration', () => {
    it('should fetch avatar data from API when not in localStorage', async () => {
      // Ensure no cached data and no auth token
      localStorageMock.getItem.mockReturnValue(null);
      
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAvatarData
      });

      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      expect(result.current.loading).toBe(true);
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/avatars/user/user-123', { headers: {} });
      expect(result.current.avatarData).toEqual(mockAvatarData);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should include authorization header when auth token is available', async () => {
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'auth_token') return 'test-token-123';
        return null;
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAvatarData
      });

      renderHook(() => useUserAvatar(mockUserId));
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/avatars/user/user-123', {
        headers: { Authorization: 'Bearer test-token-123' }
      });
    });

    it('should include authorization header for alias "me" when auth token is available', async () => {
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'auth_token') return 'test-token-456';
        return null;
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAvatarData
      });

      renderHook(() => useUserAvatar('me'));
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/avatars/user/me', {
        headers: { Authorization: 'Bearer test-token-456' }
      });
    });

    it('should handle 404 response gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(result.current.avatarData).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should handle 401 response gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const { result } = renderHook(() => useUserAvatar('me'));
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(result.current.avatarData).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(result.current.avatarData).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe('Failed to fetch avatar: Internal Server Error');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(result.current.avatarData).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe('Network error');
      expect(consoleMock.error).toHaveBeenCalledWith('Error fetching avatar:', expect.any(Error));
    });
  });

  describe('updateAvatarData', () => {
    it('should update avatar data and save to localStorage', () => {
      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      act(() => {
        result.current.updateAvatarData(mockAvatarData);
      });

      expect(result.current.avatarData).toEqual(mockAvatarData);
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'user_avatar_data_user-123', 
        JSON.stringify(mockAvatarData)
      );
    });
  });

  describe('refreshAvatar', () => {
    it('should clear localStorage and fetch fresh data', async () => {
      // Setup initial state with cached data
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'auth_token') return null;
        if (key === 'user_avatar_data_user-123') return JSON.stringify(mockAvatarData);
        return null;
      });
      
      const updatedAvatarData = { ...mockAvatarData, status: 'updated' };
      
      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      // Initial load from localStorage - no fetch should happen initially
      expect(result.current.avatarData).toEqual(mockAvatarData);
      expect(mockFetch).not.toHaveBeenCalled();
      
      // Setup localStorage to return null after removeItem is called (refresh clears cache)
      localStorageMock.getItem.mockReturnValue(null);
      
      // Setup mock for refresh call
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => updatedAvatarData
      });
      
      // Call refresh - this should clear localStorage and fetch
      await act(async () => {
        result.current.refreshAvatar();
        // Allow async operations to complete
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('user_avatar_data_user-123');
      expect(mockFetch).toHaveBeenCalledWith('/api/avatars/user/user-123', { headers: {} });
      expect(result.current.avatarData).toEqual(updatedAvatarData);
    });

    it('should handle localStorage clear errors gracefully', async () => {
      localStorageMock.removeItem.mockImplementation(() => {
        throw new Error('Cannot clear storage');
      });

      // Start with no cached data so it will fetch initially
      localStorageMock.getItem.mockReturnValue(null);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAvatarData
      });

      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      // Wait for initial fetch to complete
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      // Clear the mock and test refresh
      mockFetch.mockClear();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAvatarData
      });
      
      await act(async () => {
        result.current.refreshAvatar();
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      expect(consoleMock.warn).toHaveBeenCalledWith('Failed to clear avatar storage:', expect.any(Error));
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('loading states', () => {
    it('should set loading to true during fetch when no localStorage data', async () => {
      // Ensure no localStorage data
      localStorageMock.getItem.mockReturnValue(null);

      let resolvePromise: (value: any) => void;
      const fetchPromise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      mockFetch.mockReturnValue(fetchPromise);

      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      // Should be loading initially since there's no localStorage data and fetch is pending
      expect(result.current.loading).toBe(true);
      
      await act(async () => {
        resolvePromise!({
          ok: true,
          status: 200,
          json: async () => mockAvatarData
        });
        await fetchPromise;
      });

      expect(result.current.loading).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle userId changes', async () => {
      // Ensure no localStorage data so fetch will be called
      localStorageMock.getItem.mockReturnValue(null);
      
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAvatarData
      });

      const { result, rerender } = renderHook(
        ({ userId }) => useUserAvatar(userId),
        { initialProps: { userId: 'user-1' } }
      );
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/avatars/user/user-1', { headers: {} });
      
      // Clear previous calls
      mockFetch.mockClear();
      
      // Change userId
      rerender({ userId: 'user-2' });
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/avatars/user/user-2', { headers: {} });
    });

    it('should handle non-Error exceptions', async () => {
      // Ensure no localStorage data
      localStorageMock.getItem.mockReturnValue(null);
      
      mockFetch.mockRejectedValue('String error');

      const { result } = renderHook(() => useUserAvatar(mockUserId));
      
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      expect(result.current.error).toBe('Failed to fetch avatar');
    });
  });
});