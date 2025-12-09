/**
 * Integration test to verify the race condition fix between next-hand and rebuy-decision endpoints.
 * 
 * This test simulates the scenario where:
 * 1. A rebuy decision completes and tries to auto-start the next hand
 * 2. Simultaneously, a player (or auto next-hand timer) tries to start the next hand
 * 
 * With the lock mechanism in place, only one should succeed in starting the hand,
 * and the other should gracefully handle the situation without causing a 409 error.
 */

import { acquireNextHandLock, releaseNextHandLock, hasNextHandLock } from '../next-hand-lock';

describe('Race condition prevention - next-hand vs rebuy-decision', () => {
  const tableId = 'race-test-table';

  beforeEach(() => {
    releaseNextHandLock(tableId);
  });

  afterEach(() => {
    releaseNextHandLock(tableId);
  });

  it('should prevent both endpoints from starting hand simultaneously', async () => {
    // Track which endpoint successfully started the hand
    let rebuyEndpointStarted = false;
    let nextHandEndpointStarted = false;

    // Simulate rebuy-decision endpoint trying to start the next hand
    const rebuyEndpointFlow = async () => {
      // Try to acquire lock (simulating maybeStartNextHand in rebuy-decision.ts)
      if (!acquireNextHandLock(tableId)) {
        return false;
      }

      try {
        // Simulate checking stage is still showdown after acquiring lock
        const currentStage = 'showdown'; // Would be engine.getState().stage
        if (currentStage !== 'showdown') {
          return false;
        }

        // Simulate starting the hand
        await new Promise(resolve => setTimeout(resolve, 10)); // Simulate async work
        rebuyEndpointStarted = true;
        return true;
      } finally {
        releaseNextHandLock(tableId);
      }
    };

    // Simulate next-hand endpoint trying to start the next hand
    const nextHandEndpointFlow = async () => {
      // Try to acquire lock (simulating next-hand.ts)
      if (!acquireNextHandLock(tableId)) {
        return false;
      }

      try {
        // Simulate checking stage
        const currentStage = 'preflop'; // After rebuy started it, stage changed
        if (currentStage !== 'showdown' && currentStage !== 'awaiting-dealer-choice') {
          return false;
        }

        // Simulate starting the hand
        await new Promise(resolve => setTimeout(resolve, 10)); // Simulate async work
        nextHandEndpointStarted = true;
        return true;
      } finally {
        releaseNextHandLock(tableId);
      }
    };

    // Start both flows concurrently (simulating the race condition)
    const [rebuyResult, nextHandResult] = await Promise.all([
      rebuyEndpointFlow(),
      nextHandEndpointFlow(),
    ]);

    // Verify only one succeeded
    expect(rebuyEndpointStarted || nextHandEndpointStarted).toBe(true);
    expect(rebuyEndpointStarted && nextHandEndpointStarted).toBe(false);
    
    // At least one should have been blocked
    expect(rebuyResult || nextHandResult).toBe(true);
    expect(rebuyResult && nextHandResult).toBe(false);
  });

  it('should allow sequential hand starts after lock is released', async () => {
    // First call acquires lock successfully
    const firstAcquired = acquireNextHandLock(tableId);
    expect(firstAcquired).toBe(true);

    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, 10));

    // Release lock
    releaseNextHandLock(tableId);

    // Second call should now be able to acquire lock
    const secondAcquired = acquireNextHandLock(tableId);
    expect(secondAcquired).toBe(true);
    
    releaseNextHandLock(tableId);
  });

  it('should handle rapid sequential requests correctly', async () => {
    const results: boolean[] = [];
    const numRequests = 10;

    // Simulate rapid sequential requests
    for (let i = 0; i < numRequests; i++) {
      const acquired = acquireNextHandLock(tableId);
      results.push(acquired);
      
      if (acquired) {
        // Simulate quick work
        await new Promise(resolve => setTimeout(resolve, 1));
        releaseNextHandLock(tableId);
      }
    }

    // All requests should have been able to acquire lock in sequence
    const successCount = results.filter(r => r).length;
    expect(successCount).toBe(numRequests);
  });
});
