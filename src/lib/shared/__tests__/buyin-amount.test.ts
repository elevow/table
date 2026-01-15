import { normalizeBuyIn, primeRoomBuyIn, clearRoomBuyIn, fetchRoomBuyIn, resetServiceCache } from '../buyin-amount';
import { GameService } from '../../services/game-service';

// Mock the pool and GameService
jest.mock('../../database/pool', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../services/game-service');

describe('buyin-amount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the cached service instance
    resetServiceCache();
    // Clear cache between tests for all possible test rooms
    ['test-room', 'test-room-1', 'test-room-2', 'test-room-3', 'test-room-4'].forEach(room => clearRoomBuyIn(room));
  });

  afterEach(() => {
    // Additional cleanup
    resetServiceCache();
    ['test-room', 'test-room-1', 'test-room-2', 'test-room-3', 'test-room-4'].forEach(room => clearRoomBuyIn(room));
  });

  describe('normalizeBuyIn', () => {
    it('should return the number if it is positive', () => {
      expect(normalizeBuyIn(1000)).toBe(1000);
      expect(normalizeBuyIn(500)).toBe(500);
      expect(normalizeBuyIn(1)).toBe(1);
    });

    it('should return 1000 for invalid values', () => {
      expect(normalizeBuyIn(0)).toBe(1000);
      expect(normalizeBuyIn(-100)).toBe(1000);
      expect(normalizeBuyIn('invalid')).toBe(1000);
      expect(normalizeBuyIn(null)).toBe(1000);
      expect(normalizeBuyIn(undefined)).toBe(1000);
    });
  });

  describe('primeRoomBuyIn', () => {
    it('should cache the buy-in value', async () => {
      primeRoomBuyIn('test-room', 2000);
      
      // Mock GameService to verify cache is used
      const mockGetRoomById = jest.fn();
      (GameService as jest.MockedClass<typeof GameService>).prototype.getRoomById = mockGetRoomById;

      const buyIn = await fetchRoomBuyIn('test-room');
      
      expect(buyIn).toBe(2000);
      expect(mockGetRoomById).not.toHaveBeenCalled(); // Should use cache
    });
  });

  describe('fetchRoomBuyIn', () => {
    it('should fetch buy-in from room configuration', async () => {
      const mockGetRoomById = jest.fn().mockResolvedValue({
        configuration: { buyIn: 1500 },
      });
      (GameService as jest.MockedClass<typeof GameService>).prototype.getRoomById = mockGetRoomById;

      const buyIn = await fetchRoomBuyIn('test-room-1');

      expect(buyIn).toBe(1500);
      expect(mockGetRoomById).toHaveBeenCalledWith('test-room-1');
    });

    it('should return default 1000 if configuration is missing', async () => {
      const mockGetRoomById = jest.fn().mockResolvedValue({
        configuration: {},
      });
      (GameService as jest.MockedClass<typeof GameService>).prototype.getRoomById = mockGetRoomById;

      const buyIn = await fetchRoomBuyIn('test-room-2');

      expect(buyIn).toBe(1000);
    });

    it('should return default 1000 if room is not found', async () => {
      const mockGetRoomById = jest.fn().mockResolvedValue(null);
      (GameService as jest.MockedClass<typeof GameService>).prototype.getRoomById = mockGetRoomById;

      const buyIn = await fetchRoomBuyIn('test-room-3');

      expect(buyIn).toBe(1000);
    });

    it('should handle errors gracefully', async () => {
      const mockGetRoomById = jest.fn().mockRejectedValue(new Error('Database error'));
      (GameService as jest.MockedClass<typeof GameService>).prototype.getRoomById = mockGetRoomById;

      const buyIn = await fetchRoomBuyIn('test-room-4');

      expect(buyIn).toBe(1000); // Should return default on error
    });
  });
});
