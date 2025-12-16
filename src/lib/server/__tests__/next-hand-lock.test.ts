import { acquireNextHandLock, releaseNextHandLock, hasNextHandLock } from '../next-hand-lock';

describe('next-hand-lock', () => {
  const tableId1 = 'test-table-1';
  const tableId2 = 'test-table-2';

  beforeEach(() => {
    // Clean up any locks from previous tests
    releaseNextHandLock(tableId1);
    releaseNextHandLock(tableId2);
  });

  afterEach(() => {
    // Clean up locks after each test
    releaseNextHandLock(tableId1);
    releaseNextHandLock(tableId2);
  });

  describe('acquireNextHandLock', () => {
    it('should acquire lock for first request', () => {
      const acquired = acquireNextHandLock(tableId1);
      expect(acquired).toBe(true);
      expect(hasNextHandLock(tableId1)).toBe(true);
    });

    it('should reject lock acquisition if already locked', () => {
      acquireNextHandLock(tableId1);
      const acquired = acquireNextHandLock(tableId1);
      expect(acquired).toBe(false);
      expect(hasNextHandLock(tableId1)).toBe(true);
    });

    it('should allow independent locks for different tables', () => {
      const acquired1 = acquireNextHandLock(tableId1);
      const acquired2 = acquireNextHandLock(tableId2);
      
      expect(acquired1).toBe(true);
      expect(acquired2).toBe(true);
      expect(hasNextHandLock(tableId1)).toBe(true);
      expect(hasNextHandLock(tableId2)).toBe(true);
    });
  });

  describe('releaseNextHandLock', () => {
    it('should release an acquired lock', () => {
      acquireNextHandLock(tableId1);
      releaseNextHandLock(tableId1);
      
      expect(hasNextHandLock(tableId1)).toBe(false);
    });

    it('should allow re-acquisition after release', () => {
      acquireNextHandLock(tableId1);
      releaseNextHandLock(tableId1);
      
      const acquired = acquireNextHandLock(tableId1);
      expect(acquired).toBe(true);
      expect(hasNextHandLock(tableId1)).toBe(true);
    });

    it('should be idempotent (safe to call multiple times)', () => {
      acquireNextHandLock(tableId1);
      releaseNextHandLock(tableId1);
      releaseNextHandLock(tableId1); // Second release should not throw
      
      expect(hasNextHandLock(tableId1)).toBe(false);
    });
  });

  describe('hasNextHandLock', () => {
    it('should return false for unlocked table', () => {
      expect(hasNextHandLock(tableId1)).toBe(false);
    });

    it('should return true for locked table', () => {
      acquireNextHandLock(tableId1);
      expect(hasNextHandLock(tableId1)).toBe(true);
    });
  });

  describe('concurrent access simulation', () => {
    it('should prevent race condition between two simultaneous requests', () => {
      // Simulate two endpoints trying to start next hand at the same time
      const endpoint1Acquired = acquireNextHandLock(tableId1);
      const endpoint2Acquired = acquireNextHandLock(tableId1);
      
      // Only one should succeed
      expect(endpoint1Acquired).toBe(true);
      expect(endpoint2Acquired).toBe(false);
      
      // After first endpoint completes
      releaseNextHandLock(tableId1);
      
      // Second endpoint can now proceed
      const endpoint2Retry = acquireNextHandLock(tableId1);
      expect(endpoint2Retry).toBe(true);
    });
  });
});
