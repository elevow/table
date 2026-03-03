// Mock dependencies before importing
jest.mock('../../shared/rebuy-limit', () => ({
  fetchRoomRebuyLimit: jest.fn(),
}));

jest.mock('../../shared/rebuy-tracker', () => ({
  getPlayerRebuyInfo: jest.fn(),
}));

import {
  BASE_REBUY_CHIPS,
  REBUY_TIMEOUT_MS,
  getPendingRebuys,
  setPendingRebuy,
  clearPendingRebuy,
  hasPendingRebuy,
  pendingRebuyCount,
  getRebuyAvailability,
  resetPendingRebuys,
  isRebuyExpired,
  getExpiredRebuys,
  PendingRebuyEntry,
} from '../rebuy-state';
import { fetchRoomRebuyLimit } from '../../shared/rebuy-limit';
import { getPlayerRebuyInfo } from '../../shared/rebuy-tracker';

const mockFetchRoomRebuyLimit = fetchRoomRebuyLimit as jest.MockedFunction<typeof fetchRoomRebuyLimit>;
const mockGetPlayerRebuyInfo = getPlayerRebuyInfo as jest.MockedFunction<typeof getPlayerRebuyInfo>;

describe('rebuy-state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPendingRebuys();
  });

  describe('BASE_REBUY_CHIPS', () => {
    it('should be a positive number', () => {
      expect(typeof BASE_REBUY_CHIPS).toBe('number');
      expect(BASE_REBUY_CHIPS).toBeGreaterThan(0);
    });

    it('should default to 20 when env var is not set', () => {
      // Since env var isn't set in test environment, it should default to 20
      expect(BASE_REBUY_CHIPS).toBe(20);
    });
  });

  describe('setPendingRebuy and getPendingRebuys', () => {
    it('should store a pending rebuy entry for a table and player', () => {
      const tableId = 'table-1';
      const playerId = 'player-1';
      const entry: PendingRebuyEntry = {
        issuedAt: Date.now(),
        rebuysUsed: 1,
        rebuyLimit: 3,
      };

      setPendingRebuy(tableId, playerId, entry);

      const tableRebuys = getPendingRebuys(tableId);
      expect(tableRebuys).toBeDefined();
      expect(tableRebuys?.get(playerId)).toEqual(entry);
    });

    it('should handle multiple players at the same table', () => {
      const tableId = 'table-multi';
      const entry1: PendingRebuyEntry = { issuedAt: 1000, rebuysUsed: 0, rebuyLimit: 'unlimited' };
      const entry2: PendingRebuyEntry = { issuedAt: 2000, rebuysUsed: 2, rebuyLimit: 5 };

      setPendingRebuy(tableId, 'player-a', entry1);
      setPendingRebuy(tableId, 'player-b', entry2);

      const tableRebuys = getPendingRebuys(tableId);
      expect(tableRebuys?.size).toBe(2);
      expect(tableRebuys?.get('player-a')).toEqual(entry1);
      expect(tableRebuys?.get('player-b')).toEqual(entry2);
    });

    it('should handle multiple tables independently', () => {
      const entry1: PendingRebuyEntry = { issuedAt: 1000, rebuysUsed: 1, rebuyLimit: 3 };
      const entry2: PendingRebuyEntry = { issuedAt: 2000, rebuysUsed: 0, rebuyLimit: 'unlimited' };

      setPendingRebuy('table-x', 'player-1', entry1);
      setPendingRebuy('table-y', 'player-2', entry2);

      expect(getPendingRebuys('table-x')?.get('player-1')).toEqual(entry1);
      expect(getPendingRebuys('table-y')?.get('player-2')).toEqual(entry2);
      expect(getPendingRebuys('table-x')?.has('player-2')).toBe(false);
    });

    it('should overwrite existing entry for same player', () => {
      const tableId = 'table-overwrite';
      const playerId = 'player-1';
      const entry1: PendingRebuyEntry = { issuedAt: 1000, rebuysUsed: 0, rebuyLimit: 3 };
      const entry2: PendingRebuyEntry = { issuedAt: 2000, rebuysUsed: 1, rebuyLimit: 3 };

      setPendingRebuy(tableId, playerId, entry1);
      setPendingRebuy(tableId, playerId, entry2);

      const tableRebuys = getPendingRebuys(tableId);
      expect(tableRebuys?.size).toBe(1);
      expect(tableRebuys?.get(playerId)).toEqual(entry2);
    });
  });

  describe('getPendingRebuys', () => {
    it('should return undefined for non-existent table', () => {
      expect(getPendingRebuys('non-existent-table')).toBeUndefined();
    });
  });

  describe('clearPendingRebuy', () => {
    it('should remove a pending rebuy for a specific player', () => {
      const tableId = 'table-clear';
      const entry: PendingRebuyEntry = { issuedAt: 1000, rebuysUsed: 1, rebuyLimit: 5 };

      setPendingRebuy(tableId, 'player-1', entry);
      setPendingRebuy(tableId, 'player-2', entry);

      clearPendingRebuy(tableId, 'player-1');

      const tableRebuys = getPendingRebuys(tableId);
      expect(tableRebuys?.has('player-1')).toBe(false);
      expect(tableRebuys?.has('player-2')).toBe(true);
    });

    it('should remove the table map when last player is cleared', () => {
      const tableId = 'table-remove';
      const entry: PendingRebuyEntry = { issuedAt: 1000, rebuysUsed: 0, rebuyLimit: 'unlimited' };

      setPendingRebuy(tableId, 'only-player', entry);
      clearPendingRebuy(tableId, 'only-player');

      expect(getPendingRebuys(tableId)).toBeUndefined();
    });

    it('should be safe to call on non-existent table', () => {
      expect(() => clearPendingRebuy('no-table', 'no-player')).not.toThrow();
    });

    it('should be safe to call on non-existent player', () => {
      const tableId = 'table-safe';
      const entry: PendingRebuyEntry = { issuedAt: 1000, rebuysUsed: 0, rebuyLimit: 3 };
      setPendingRebuy(tableId, 'player-1', entry);

      expect(() => clearPendingRebuy(tableId, 'non-existent-player')).not.toThrow();
      expect(getPendingRebuys(tableId)?.has('player-1')).toBe(true);
    });
  });

  describe('hasPendingRebuy', () => {
    it('should return true when player has pending rebuy', () => {
      const tableId = 'table-has';
      const entry: PendingRebuyEntry = { issuedAt: 1000, rebuysUsed: 0, rebuyLimit: 3 };
      setPendingRebuy(tableId, 'player-1', entry);

      expect(hasPendingRebuy(tableId, 'player-1')).toBe(true);
    });

    it('should return false when player has no pending rebuy', () => {
      const tableId = 'table-has-not';
      const entry: PendingRebuyEntry = { issuedAt: 1000, rebuysUsed: 0, rebuyLimit: 3 };
      setPendingRebuy(tableId, 'player-1', entry);

      expect(hasPendingRebuy(tableId, 'player-2')).toBe(false);
    });

    it('should return false for non-existent table', () => {
      expect(hasPendingRebuy('no-such-table', 'player-1')).toBe(false);
    });
  });

  describe('pendingRebuyCount', () => {
    it('should return 0 for non-existent table', () => {
      expect(pendingRebuyCount('no-table')).toBe(0);
    });

    it('should return correct count of pending rebuys', () => {
      const tableId = 'table-count';
      const entry: PendingRebuyEntry = { issuedAt: 1000, rebuysUsed: 0, rebuyLimit: 'unlimited' };

      expect(pendingRebuyCount(tableId)).toBe(0);

      setPendingRebuy(tableId, 'player-1', entry);
      expect(pendingRebuyCount(tableId)).toBe(1);

      setPendingRebuy(tableId, 'player-2', entry);
      expect(pendingRebuyCount(tableId)).toBe(2);

      setPendingRebuy(tableId, 'player-3', entry);
      expect(pendingRebuyCount(tableId)).toBe(3);
    });

    it('should decrease count when rebuys are cleared', () => {
      const tableId = 'table-count-decrease';
      const entry: PendingRebuyEntry = { issuedAt: 1000, rebuysUsed: 0, rebuyLimit: 3 };

      setPendingRebuy(tableId, 'player-1', entry);
      setPendingRebuy(tableId, 'player-2', entry);
      expect(pendingRebuyCount(tableId)).toBe(2);

      clearPendingRebuy(tableId, 'player-1');
      expect(pendingRebuyCount(tableId)).toBe(1);
    });
  });

  describe('getRebuyAvailability', () => {
    it('should return canRebuy true when under limit', async () => {
      mockFetchRoomRebuyLimit.mockResolvedValue(3);
      mockGetPlayerRebuyInfo.mockReturnValue({ tableId: 't1', playerId: 'p1', rebuys: 1 });

      const result = await getRebuyAvailability('table-1', 'player-1');

      expect(result.rebuyLimit).toBe(3);
      expect(result.rebuysUsed).toBe(1);
      expect(result.canRebuy).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('should return canRebuy false when at limit', async () => {
      mockFetchRoomRebuyLimit.mockResolvedValue(2);
      mockGetPlayerRebuyInfo.mockReturnValue({ tableId: 't1', playerId: 'p1', rebuys: 2 });

      const result = await getRebuyAvailability('table-1', 'player-1');

      expect(result.rebuyLimit).toBe(2);
      expect(result.rebuysUsed).toBe(2);
      expect(result.canRebuy).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should return canRebuy false when over limit', async () => {
      mockFetchRoomRebuyLimit.mockResolvedValue(1);
      mockGetPlayerRebuyInfo.mockReturnValue({ tableId: 't1', playerId: 'p1', rebuys: 5 });

      const result = await getRebuyAvailability('table-1', 'player-1');

      expect(result.canRebuy).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should handle unlimited rebuys', async () => {
      mockFetchRoomRebuyLimit.mockResolvedValue('unlimited');
      mockGetPlayerRebuyInfo.mockReturnValue({ tableId: 't1', playerId: 'p1', rebuys: 100 });

      const result = await getRebuyAvailability('table-1', 'player-1');

      expect(result.rebuyLimit).toBe('unlimited');
      expect(result.rebuysUsed).toBe(100);
      expect(result.canRebuy).toBe(true);
      expect(result.remaining).toBe('unlimited');
    });

    it('should handle player with no rebuy info (first bust)', async () => {
      mockFetchRoomRebuyLimit.mockResolvedValue(3);
      mockGetPlayerRebuyInfo.mockReturnValue(null);

      const result = await getRebuyAvailability('table-1', 'new-player');

      expect(result.rebuysUsed).toBe(0);
      expect(result.canRebuy).toBe(true);
      expect(result.remaining).toBe(3);
    });

    it('should use limitOverride when provided', async () => {
      mockGetPlayerRebuyInfo.mockReturnValue({ tableId: 't1', playerId: 'p1', rebuys: 1 });

      const result = await getRebuyAvailability('table-1', 'player-1', 5);

      expect(mockFetchRoomRebuyLimit).not.toHaveBeenCalled();
      expect(result.rebuyLimit).toBe(5);
      expect(result.remaining).toBe(4);
    });

    it('should use unlimited limitOverride when provided', async () => {
      mockGetPlayerRebuyInfo.mockReturnValue({ tableId: 't1', playerId: 'p1', rebuys: 50 });

      const result = await getRebuyAvailability('table-1', 'player-1', 'unlimited');

      expect(result.rebuyLimit).toBe('unlimited');
      expect(result.canRebuy).toBe(true);
      expect(result.remaining).toBe('unlimited');
    });

    it('should handle zero rebuy limit', async () => {
      mockFetchRoomRebuyLimit.mockResolvedValue(0);
      mockGetPlayerRebuyInfo.mockReturnValue(null);

      const result = await getRebuyAvailability('table-1', 'player-1');

      expect(result.rebuyLimit).toBe(0);
      expect(result.canRebuy).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe('resetPendingRebuys', () => {
    it('should clear all pending rebuys across all tables', () => {
      const entry: PendingRebuyEntry = { issuedAt: 1000, rebuysUsed: 0, rebuyLimit: 3 };

      setPendingRebuy('table-1', 'player-1', entry);
      setPendingRebuy('table-1', 'player-2', entry);
      setPendingRebuy('table-2', 'player-3', entry);
      setPendingRebuy('table-3', 'player-4', entry);

      expect(pendingRebuyCount('table-1')).toBe(2);
      expect(pendingRebuyCount('table-2')).toBe(1);
      expect(pendingRebuyCount('table-3')).toBe(1);

      resetPendingRebuys();

      expect(pendingRebuyCount('table-1')).toBe(0);
      expect(pendingRebuyCount('table-2')).toBe(0);
      expect(pendingRebuyCount('table-3')).toBe(0);
      expect(getPendingRebuys('table-1')).toBeUndefined();
    });

    it('should be safe to call when no pending rebuys exist', () => {
      expect(() => resetPendingRebuys()).not.toThrow();
    });
  });

  describe('REBUY_TIMEOUT_MS', () => {
    it('should be a positive number', () => {
      expect(typeof REBUY_TIMEOUT_MS).toBe('number');
      expect(REBUY_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('should default to 20000ms (20 seconds) when env var is not set', () => {
      expect(REBUY_TIMEOUT_MS).toBe(20000);
    });
  });

  describe('isRebuyExpired', () => {
    it('should return false for 2-player games regardless of time elapsed', () => {
      const tableId = 'table-2p';
      const playerId = 'player-1';
      const entry: PendingRebuyEntry = {
        issuedAt: Date.now() - REBUY_TIMEOUT_MS - 10000, // Way past timeout
        rebuysUsed: 0,
        rebuyLimit: 3,
      };

      setPendingRebuy(tableId, playerId, entry);

      // For 2 players, rebuy never expires
      expect(isRebuyExpired(tableId, playerId, 2)).toBe(false);
    });

    it('should return false for 1-player games', () => {
      const tableId = 'table-1p';
      const playerId = 'player-1';
      const entry: PendingRebuyEntry = {
        issuedAt: Date.now() - REBUY_TIMEOUT_MS - 10000,
        rebuysUsed: 0,
        rebuyLimit: 3,
      };

      setPendingRebuy(tableId, playerId, entry);

      expect(isRebuyExpired(tableId, playerId, 1)).toBe(false);
    });

    it('should return false for 3+ player games when time has not elapsed', () => {
      const tableId = 'table-3p-not-expired';
      const playerId = 'player-1';
      const entry: PendingRebuyEntry = {
        issuedAt: Date.now() - 1000, // Only 1 second ago
        rebuysUsed: 0,
        rebuyLimit: 3,
      };

      setPendingRebuy(tableId, playerId, entry);

      expect(isRebuyExpired(tableId, playerId, 3)).toBe(false);
    });

    it('should return true for 3+ player games when timeout has elapsed', () => {
      const tableId = 'table-3p-expired';
      const playerId = 'player-1';
      const entry: PendingRebuyEntry = {
        issuedAt: Date.now() - REBUY_TIMEOUT_MS - 1000, // 1 second past timeout
        rebuysUsed: 0,
        rebuyLimit: 3,
      };

      setPendingRebuy(tableId, playerId, entry);

      expect(isRebuyExpired(tableId, playerId, 3)).toBe(true);
    });

    it('should return true for 4+ player games when timeout has elapsed', () => {
      const tableId = 'table-4p';
      const playerId = 'player-1';
      const entry: PendingRebuyEntry = {
        issuedAt: Date.now() - REBUY_TIMEOUT_MS - 5000,
        rebuysUsed: 1,
        rebuyLimit: 'unlimited',
      };

      setPendingRebuy(tableId, playerId, entry);

      expect(isRebuyExpired(tableId, playerId, 4)).toBe(true);
      expect(isRebuyExpired(tableId, playerId, 5)).toBe(true);
      expect(isRebuyExpired(tableId, playerId, 10)).toBe(true);
    });

    it('should return false when player has no pending rebuy', () => {
      expect(isRebuyExpired('no-table', 'no-player', 3)).toBe(false);
    });

    it('should handle exact timeout boundary', () => {
      const tableId = 'table-boundary';
      const playerId = 'player-1';
      const entry: PendingRebuyEntry = {
        issuedAt: Date.now() - REBUY_TIMEOUT_MS, // Exactly at timeout
        rebuysUsed: 0,
        rebuyLimit: 3,
      };

      setPendingRebuy(tableId, playerId, entry);

      // Should be considered expired at exactly the timeout
      expect(isRebuyExpired(tableId, playerId, 3)).toBe(true);
    });
  });

  describe('getExpiredRebuys', () => {
    it('should return empty array for 2-player games', () => {
      const tableId = 'table-2p-expired';
      const entry: PendingRebuyEntry = {
        issuedAt: Date.now() - REBUY_TIMEOUT_MS - 10000,
        rebuysUsed: 0,
        rebuyLimit: 3,
      };

      setPendingRebuy(tableId, 'player-1', entry);
      setPendingRebuy(tableId, 'player-2', entry);

      expect(getExpiredRebuys(tableId, 2)).toEqual([]);
    });

    it('should return empty array for 1-player games', () => {
      const tableId = 'table-1p';
      const entry: PendingRebuyEntry = {
        issuedAt: Date.now() - REBUY_TIMEOUT_MS - 10000,
        rebuysUsed: 0,
        rebuyLimit: 3,
      };

      setPendingRebuy(tableId, 'player-1', entry);

      expect(getExpiredRebuys(tableId, 1)).toEqual([]);
    });

    it('should return empty array when no rebuys are pending', () => {
      expect(getExpiredRebuys('no-table', 3)).toEqual([]);
    });

    it('should return empty array when no rebuys have expired', () => {
      const tableId = 'table-not-expired';
      const entry: PendingRebuyEntry = {
        issuedAt: Date.now() - 1000, // Only 1 second ago
        rebuysUsed: 0,
        rebuyLimit: 3,
      };

      setPendingRebuy(tableId, 'player-1', entry);
      setPendingRebuy(tableId, 'player-2', entry);

      expect(getExpiredRebuys(tableId, 3)).toEqual([]);
    });

    it('should return player IDs of all expired rebuys for 3+ player games', () => {
      const tableId = 'table-mixed';
      const expiredEntry: PendingRebuyEntry = {
        issuedAt: Date.now() - REBUY_TIMEOUT_MS - 1000,
        rebuysUsed: 0,
        rebuyLimit: 3,
      };
      const notExpiredEntry: PendingRebuyEntry = {
        issuedAt: Date.now() - 1000,
        rebuysUsed: 0,
        rebuyLimit: 3,
      };

      setPendingRebuy(tableId, 'player-expired-1', expiredEntry);
      setPendingRebuy(tableId, 'player-not-expired', notExpiredEntry);
      setPendingRebuy(tableId, 'player-expired-2', expiredEntry);

      const expired = getExpiredRebuys(tableId, 3);

      expect(expired).toHaveLength(2);
      expect(expired).toContain('player-expired-1');
      expect(expired).toContain('player-expired-2');
      expect(expired).not.toContain('player-not-expired');
    });

    it('should return all players when all have expired', () => {
      const tableId = 'table-all-expired';
      const entry: PendingRebuyEntry = {
        issuedAt: Date.now() - REBUY_TIMEOUT_MS - 5000,
        rebuysUsed: 0,
        rebuyLimit: 3,
      };

      setPendingRebuy(tableId, 'player-1', entry);
      setPendingRebuy(tableId, 'player-2', entry);
      setPendingRebuy(tableId, 'player-3', entry);

      const expired = getExpiredRebuys(tableId, 4);

      expect(expired).toHaveLength(3);
      expect(expired).toContain('player-1');
      expect(expired).toContain('player-2');
      expect(expired).toContain('player-3');
    });

    it('should handle games with many players', () => {
      const tableId = 'table-many';
      const expiredEntry: PendingRebuyEntry = {
        issuedAt: Date.now() - REBUY_TIMEOUT_MS - 2000,
        rebuysUsed: 0,
        rebuyLimit: 'unlimited',
      };

      setPendingRebuy(tableId, 'player-1', expiredEntry);
      setPendingRebuy(tableId, 'player-2', expiredEntry);

      const expired = getExpiredRebuys(tableId, 8); // 8 player game

      expect(expired).toHaveLength(2);
    });
  });
});
