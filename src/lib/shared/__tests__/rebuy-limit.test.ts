// Mock database layer so 'pg' is never loaded in Jest
const mockGetPool = jest.fn(() => ({}));
jest.mock('../../database/pool', () => ({
  getPool: () => mockGetPool(),
}));

const mockGetRoomById = jest.fn();
const MockGameService = jest.fn().mockImplementation(() => ({
  getRoomById: mockGetRoomById,
}));
jest.mock('../../services/game-service', () => ({
  GameService: function(...args: any[]) { return MockGameService(...args); },
}));

import {
  normalizeRebuyLimit,
  primeRoomRebuyLimit,
  clearRoomRebuyLimit,
  fetchRoomRebuyLimit,
  fetchRoomRebuyAmount,
} from '../rebuy-limit';

describe('rebuy-limit helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the cache between tests by clearing known room IDs
    clearRoomRebuyLimit('room-test');
    clearRoomRebuyLimit('room-cached');
    clearRoomRebuyLimit('room-fetch');
    clearRoomRebuyLimit('room-unlimited');
    clearRoomRebuyLimit('room-numeric');
    clearRoomRebuyLimit('room-error');
    clearRoomRebuyLimit('room-no-config');
    clearRoomRebuyLimit('room-null');
  });

  describe('normalizeRebuyLimit', () => {
    it('returns 0 for input 0', () => {
      expect(normalizeRebuyLimit(0)).toBe(0);
    });

    it('returns positive numbers as-is', () => {
      expect(normalizeRebuyLimit(1)).toBe(1);
      expect(normalizeRebuyLimit(5)).toBe(5);
      expect(normalizeRebuyLimit(100)).toBe(100);
    });

    it('returns "unlimited" for string "unlimited" (case insensitive)', () => {
      expect(normalizeRebuyLimit('unlimited')).toBe('unlimited');
      expect(normalizeRebuyLimit('Unlimited')).toBe('unlimited');
      expect(normalizeRebuyLimit('UNLIMITED')).toBe('unlimited');
    });

    it('returns "unlimited" for negative numbers', () => {
      expect(normalizeRebuyLimit(-1)).toBe('unlimited');
      expect(normalizeRebuyLimit(-100)).toBe('unlimited');
    });

    it('returns "unlimited" for undefined', () => {
      expect(normalizeRebuyLimit(undefined)).toBe('unlimited');
    });

    it('returns "unlimited" for null', () => {
      expect(normalizeRebuyLimit(null)).toBe('unlimited');
    });

    it('returns "unlimited" for NaN', () => {
      expect(normalizeRebuyLimit(NaN)).toBe('unlimited');
    });

    it('returns "unlimited" for invalid strings', () => {
      expect(normalizeRebuyLimit('invalid')).toBe('unlimited');
      expect(normalizeRebuyLimit('three')).toBe('unlimited');
      expect(normalizeRebuyLimit('')).toBe('unlimited');
    });

    it('returns "unlimited" for objects', () => {
      expect(normalizeRebuyLimit({})).toBe('unlimited');
      expect(normalizeRebuyLimit({ limit: 5 })).toBe('unlimited');
    });

    it('returns "unlimited" for arrays', () => {
      expect(normalizeRebuyLimit([])).toBe('unlimited');
      expect(normalizeRebuyLimit([5])).toBe('unlimited');
    });

    it('returns "unlimited" for boolean values', () => {
      expect(normalizeRebuyLimit(true)).toBe('unlimited');
      expect(normalizeRebuyLimit(false)).toBe('unlimited');
    });
  });

  describe('primeRoomRebuyLimit', () => {
    it('primes cache with numeric limit', async () => {
      primeRoomRebuyLimit('room-numeric', 3);
      const result = await fetchRoomRebuyLimit('room-numeric');
      expect(result).toBe(3);
      // Should not call service when cached
      expect(mockGetRoomById).not.toHaveBeenCalled();
    });

    it('primes cache with unlimited', async () => {
      primeRoomRebuyLimit('room-unlimited', 'unlimited');
      const result = await fetchRoomRebuyLimit('room-unlimited');
      expect(result).toBe('unlimited');
      expect(mockGetRoomById).not.toHaveBeenCalled();
    });

    it('primes cache with zero', async () => {
      primeRoomRebuyLimit('room-test', 0);
      const result = await fetchRoomRebuyLimit('room-test');
      expect(result).toBe(0);
    });

    it('overwrites existing cache entry', async () => {
      primeRoomRebuyLimit('room-test', 5);
      primeRoomRebuyLimit('room-test', 10);
      const result = await fetchRoomRebuyLimit('room-test');
      expect(result).toBe(10);
    });
  });

  describe('clearRoomRebuyLimit', () => {
    it('clears cached limit for a room', async () => {
      primeRoomRebuyLimit('room-cached', 7);
      clearRoomRebuyLimit('room-cached');
      
      // Now it should try to fetch from service
      mockGetRoomById.mockResolvedValueOnce({
        configuration: { numberOfRebuys: 2 },
      });
      
      const result = await fetchRoomRebuyLimit('room-cached');
      expect(mockGetRoomById).toHaveBeenCalledWith('room-cached');
      expect(result).toBe(2);
    });

    it('is safe to call on non-existent room', () => {
      expect(() => clearRoomRebuyLimit('non-existent-room')).not.toThrow();
    });
  });

  describe('fetchRoomRebuyLimit', () => {
    it('returns cached value when available and not expired', async () => {
      primeRoomRebuyLimit('room-fetch', 4);
      
      const result = await fetchRoomRebuyLimit('room-fetch');
      
      expect(result).toBe(4);
      expect(mockGetRoomById).not.toHaveBeenCalled();
    });

    it('fetches from service when cache is empty', async () => {
      mockGetRoomById.mockResolvedValueOnce({
        configuration: { numberOfRebuys: 3 },
      });

      const result = await fetchRoomRebuyLimit('room-fetch');

      expect(mockGetRoomById).toHaveBeenCalledWith('room-fetch');
      expect(result).toBe(3);
    });

    it('fetches from service and normalizes unlimited string', async () => {
      mockGetRoomById.mockResolvedValueOnce({
        configuration: { numberOfRebuys: 'unlimited' },
      });

      const result = await fetchRoomRebuyLimit('room-unlimited');

      expect(result).toBe('unlimited');
    });

    it('returns unlimited when room has no configuration', async () => {
      mockGetRoomById.mockResolvedValueOnce({});

      const result = await fetchRoomRebuyLimit('room-no-config');

      expect(result).toBe('unlimited');
    });

    it('returns unlimited when room is null', async () => {
      mockGetRoomById.mockResolvedValueOnce(null);

      const result = await fetchRoomRebuyLimit('room-null');

      expect(result).toBe('unlimited');
    });

    it('returns unlimited and caches when service throws error', async () => {
      mockGetRoomById.mockRejectedValueOnce(new Error('Database error'));

      const result = await fetchRoomRebuyLimit('room-error');

      expect(result).toBe('unlimited');
      
      // Second call should use cached value (even though it's unlimited)
      mockGetRoomById.mockClear();
      const result2 = await fetchRoomRebuyLimit('room-error');
      expect(result2).toBe('unlimited');
      expect(mockGetRoomById).not.toHaveBeenCalled();
    });

    it('caches fetched value for subsequent calls', async () => {
      mockGetRoomById.mockResolvedValueOnce({
        configuration: { numberOfRebuys: 5 },
      });

      // First call - fetches from service
      const result1 = await fetchRoomRebuyLimit('room-fetch');
      expect(result1).toBe(5);
      expect(mockGetRoomById).toHaveBeenCalledTimes(1);

      // Second call - uses cache
      mockGetRoomById.mockClear();
      const result2 = await fetchRoomRebuyLimit('room-fetch');
      expect(result2).toBe(5);
      expect(mockGetRoomById).not.toHaveBeenCalled();
    });

    it('handles configuration with zero rebuys', async () => {
      mockGetRoomById.mockResolvedValueOnce({
        configuration: { numberOfRebuys: 0 },
      });

      const result = await fetchRoomRebuyLimit('room-fetch');

      expect(result).toBe(0);
    });

    it('handles configuration with negative rebuys (normalizes to unlimited)', async () => {
      mockGetRoomById.mockResolvedValueOnce({
        configuration: { numberOfRebuys: -5 },
      });

      const result = await fetchRoomRebuyLimit('room-fetch');

      expect(result).toBe('unlimited');
    });
  });

  describe('getGameService (internal)', () => {
    it('handles getPool throwing error', async () => {
      mockGetPool.mockImplementationOnce(() => {
        throw new Error('Pool not initialized');
      });

      // Clear any cached service by causing it to fail
      clearRoomRebuyLimit('room-pool-error');
      
      const result = await fetchRoomRebuyLimit('room-pool-error');
      
      // Should return unlimited as fallback
      expect(result).toBe('unlimited');
    });
  });

  describe('fetchRoomRebuyAmount', () => {
    it('returns default amount when room has no configuration', async () => {
      mockGetRoomById.mockResolvedValueOnce({});
      
      const result = await fetchRoomRebuyAmount('room-no-config');
      
      expect(result).toBe(20);
    });

    it('returns configured rebuy amount when available', async () => {
      mockGetRoomById.mockResolvedValueOnce({
        configuration: { rebuyAmount: 50 },
      });

      const result = await fetchRoomRebuyAmount('room-with-amount');

      expect(mockGetRoomById).toHaveBeenCalledWith('room-with-amount');
      expect(result).toBe(50);
    });

    it('returns default amount when rebuyAmount is not set', async () => {
      mockGetRoomById.mockResolvedValueOnce({
        configuration: { numberOfRebuys: 3 },
      });

      const result = await fetchRoomRebuyAmount('room-no-amount');

      expect(result).toBe(20);
    });

    it('returns default amount when rebuyAmount is invalid', async () => {
      mockGetRoomById.mockResolvedValueOnce({
        configuration: { rebuyAmount: -5 },
      });

      const result = await fetchRoomRebuyAmount('room-invalid-amount');

      expect(result).toBe(20);
    });

    it('caches fetched amount for subsequent calls', async () => {
      mockGetRoomById.mockResolvedValueOnce({
        configuration: { rebuyAmount: 100 },
      });

      // First call - fetches from service
      const result1 = await fetchRoomRebuyAmount('room-cache-amount');
      expect(result1).toBe(100);
      expect(mockGetRoomById).toHaveBeenCalledTimes(1);

      // Second call - uses cache
      mockGetRoomById.mockClear();
      const result2 = await fetchRoomRebuyAmount('room-cache-amount');
      expect(result2).toBe(100);
      expect(mockGetRoomById).not.toHaveBeenCalled();
    });

    it('handles service errors gracefully and returns default', async () => {
      mockGetRoomById.mockRejectedValueOnce(new Error('Database error'));

      const result = await fetchRoomRebuyAmount('room-error-amount');

      expect(result).toBe(20);
    });
  });
});
