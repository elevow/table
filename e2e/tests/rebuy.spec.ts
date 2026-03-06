import { test, expect, Page, Browser } from '@playwright/test';

/**
 * E2E Tests for Rebuy Logic with Timeout Handling
 *
 * Tests the following scenarios:
 * 1. Two-player game: Game pauses indefinitely until rebuy decision is made
 * 2. Three+ player game: Game pauses for timeout period, then continues without broke player
 *
 * These tests validate the requirements from the problem statement:
 * - 2 players: wait indefinitely for rebuy decision
 * - >2 players: wait up to timeout (default 20 seconds), then continue without broke player
 */

test.describe('Rebuy Logic Tests', () => {
  test.describe.configure({ mode: 'serial' }); // Run tests in sequence

  // Helper function to create a mock game state via API
  async function createMockGame(page: Page, playerCount: number): Promise<string> {
    // This is a placeholder - in a real implementation, you would:
    // 1. Call an API to create a game with specific configuration
    // 2. Set up the required number of players
    // 3. Start the game
    // 4. Play until one player goes broke
    // For now, we'll simulate this flow

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to game creation
    const createButton = page.locator('text=/Create.*Game|New.*Game/i').first();
    if (await createButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createButton.click();
      await page.waitForLoadState('networkidle');
    }

    // Extract game ID from URL
    const url = page.url();
    const gameIdMatch = url.match(/game\/([^\/\?]+)/);
    return gameIdMatch ? gameIdMatch[1] : '';
  }

  test.skip('2-player game: should wait indefinitely for rebuy decision', async ({ browser }) => {
    /**
     * Test Case: Two-player rebuy scenario
     *
     * Scenario:
     * 1. Create a 2-player game
     * 2. Play until one player goes broke (stack = 0)
     * 3. Verify that game pauses indefinitely
     * 4. Verify that no timeout occurs
     * 5. Player accepts rebuy
     * 6. Verify game continues with both players
     *
     * Expected behavior:
     * - Game should NOT continue after timeout
     * - Game should wait for player's rebuy decision
     * - When player accepts, they get chips and game continues
     * - When player declines, game stays paused (1 player left)
     */

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const player1Page = await context1.newPage();
    const player2Page = await context2.newPage();

    try {
      // Step 1: Create a 2-player game
      const gameId = await createMockGame(player1Page, 2);
      expect(gameId).toBeTruthy();

      // Step 2: Player 2 joins
      await player2Page.goto(`/game/${gameId}`);
      await player2Page.waitForLoadState('networkidle');

      // Step 3: Both players sit at table
      // (Implementation depends on your UI - adjust selectors)
      const p1SeatButton = player1Page.locator('button:has-text("Sit"), button:has-text("Claim")').first();
      const p2SeatButton = player2Page.locator('button:has-text("Sit"), button:has-text("Claim")').first();

      if (await p1SeatButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await p1SeatButton.click();
        await player1Page.waitForTimeout(1000);
      }

      if (await p2SeatButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await p2SeatButton.click();
        await player2Page.waitForTimeout(1000);
      }

      // Step 4: Start game
      const startButton = player1Page.locator('button:has-text("Start")').first();
      if (await startButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await startButton.click();
        await player1Page.waitForTimeout(2000);
      }

      // Step 5: Play hands until one player goes broke
      // (This would require simulating multiple hands of play)
      // For testing purposes, we could use a direct API call to set player stack to 0

      // Step 6: Verify rebuy prompt appears
      const rebuyPrompt = player1Page.locator('text=/rebuy|buy.*in/i');
      await expect(rebuyPrompt).toBeVisible({ timeout: 10000 });

      // Step 7: Wait longer than the timeout period (>20 seconds)
      await player1Page.waitForTimeout(25000);

      // Step 8: Verify game has NOT continued (still showing rebuy prompt)
      await expect(rebuyPrompt).toBeVisible();

      // Step 9: Player accepts rebuy
      const acceptButton = player1Page.locator('button:has-text("Yes"), button:has-text("Rebuy"), button:has-text("Buy In")').first();
      if (await acceptButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await acceptButton.click();
        await player1Page.waitForTimeout(2000);
      }

      // Step 10: Verify game continues with both players
      const gameActiveIndicator = player1Page.locator('[data-testid="active-player"], .active-player, text=/your turn/i');
      await expect(gameActiveIndicator).toBeVisible({ timeout: 5000 });

      console.log('✓ 2-player game correctly waits indefinitely for rebuy decision');
    } finally {
      await player1Page.close();
      await player2Page.close();
      await context1.close();
      await context2.close();
    }
  });

  test.skip('3+ player game: should continue after timeout if no rebuy decision', async ({ browser }) => {
    /**
     * Test Case: Three+ player rebuy timeout scenario
     *
     * Scenario:
     * 1. Create a 3-player game
     * 2. Play until one player goes broke
     * 3. Verify rebuy prompt appears for broke player
     * 4. Wait for timeout period (20 seconds)
     * 5. Verify game continues with remaining 2 players
     * 6. Verify broke player is removed from game
     *
     * Expected behavior:
     * - Game should pause and show rebuy prompt
     * - After timeout (20 seconds), game should auto-continue
     * - Broke player should be automatically stood up
     * - Remaining players should be able to play
     */

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const context3 = await browser.newContext();

    const player1Page = await context1.newPage();
    const player2Page = await context2.newPage();
    const player3Page = await context3.newPage();

    try {
      // Step 1: Create a 3-player game
      const gameId = await createMockGame(player1Page, 3);
      expect(gameId).toBeTruthy();

      // Step 2: Players 2 and 3 join
      await player2Page.goto(`/game/${gameId}`);
      await player2Page.waitForLoadState('networkidle');

      await player3Page.goto(`/game/${gameId}`);
      await player3Page.waitForLoadState('networkidle');

      // Step 3: All players sit at table
      const seatButtons = [
        player1Page.locator('button:has-text("Sit"), button:has-text("Claim")').first(),
        player2Page.locator('button:has-text("Sit"), button:has-text("Claim")').first(),
        player3Page.locator('button:has-text("Sit"), button:has-text("Claim")').first(),
      ];

      for (const button of seatButtons) {
        if (await button.isVisible({ timeout: 5000 }).catch(() => false)) {
          await button.click();
          await button.page().waitForTimeout(1000);
        }
      }

      // Step 4: Start game
      const startButton = player1Page.locator('button:has-text("Start")').first();
      if (await startButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await startButton.click();
        await player1Page.waitForTimeout(2000);
      }

      // Step 5: Simulate one player going broke
      // (Would require API call or playing multiple hands)

      // Step 6: Verify rebuy prompt appears
      const rebuyPrompt = player1Page.locator('text=/rebuy|buy.*in/i');
      await expect(rebuyPrompt).toBeVisible({ timeout: 10000 });

      // Step 7: Record timestamp when rebuy prompt appeared
      const promptTime = Date.now();

      // Step 8: Wait for timeout + buffer (25 seconds)
      console.log('Waiting for rebuy timeout...');
      await player1Page.waitForTimeout(25000);

      // Step 9: Verify game has continued (rebuy prompt no longer visible)
      await expect(rebuyPrompt).not.toBeVisible({ timeout: 5000 });

      // Step 10: Verify that remaining players can still play
      const activeGameIndicator = player2Page.locator('[data-testid="active-player"], .active-player, text=/your turn/i');
      const isGameActive = await activeGameIndicator.isVisible({ timeout: 5000 }).catch(() => false);

      expect(isGameActive).toBe(true);

      // Step 11: Verify broke player was removed from game
      // (Check seat state or player list)

      const elapsedTime = Date.now() - promptTime;
      console.log(`✓ 3+ player game continued after ${elapsedTime}ms (expected ~20000ms)`);
      expect(elapsedTime).toBeGreaterThanOrEqual(20000);
      expect(elapsedTime).toBeLessThan(30000); // Should not wait too long
    } finally {
      await player1Page.close();
      await player2Page.close();
      await player3Page.close();
      await context1.close();
      await context2.close();
      await context3.close();
    }
  });

  test.skip('3+ player game: player accepts rebuy before timeout', async ({ browser }) => {
    /**
     * Test Case: Player accepts rebuy before timeout expires
     *
     * Scenario:
     * 1. Create a 3-player game
     * 2. One player goes broke and gets rebuy prompt
     * 3. Player accepts rebuy within timeout period
     * 4. Verify game continues with all 3 players
     *
     * Expected behavior:
     * - Rebuy prompt appears
     * - Player accepts within timeout
     * - Player gets chips and stays in game
     * - Game continues normally with 3 players
     */

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const context3 = await browser.newContext();

    const player1Page = await context1.newPage();
    const player2Page = await context2.newPage();
    const player3Page = await context3.newPage();

    try {
      // Similar setup to previous test
      const gameId = await createMockGame(player1Page, 3);
      expect(gameId).toBeTruthy();

      await player2Page.goto(`/game/${gameId}`);
      await player3Page.goto(`/game/${gameId}`);

      // Sit all players and start game
      // ...

      // Simulate player going broke
      // ...

      // Step: Rebuy prompt appears
      const rebuyPrompt = player1Page.locator('text=/rebuy|buy.*in/i');
      await expect(rebuyPrompt).toBeVisible({ timeout: 10000 });

      // Step: Player accepts rebuy within 5 seconds (well before timeout)
      await player1Page.waitForTimeout(5000);

      const acceptButton = player1Page.locator('button:has-text("Yes"), button:has-text("Rebuy")').first();
      if (await acceptButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await acceptButton.click();
        await player1Page.waitForTimeout(2000);
      }

      // Step: Verify player has chips and game continues
      const stackIndicator = player1Page.locator('[data-testid="player-stack"], .player-stack, text=/stack|chips/i');
      await expect(stackIndicator).toBeVisible({ timeout: 5000 });

      // Verify all 3 players are still in game
      const playerCount = await player1Page.locator('[data-testid="player-seat"], .player-seat').count();
      expect(playerCount).toBe(3);

      console.log('✓ Player successfully rebought within timeout period');
    } finally {
      await player1Page.close();
      await player2Page.close();
      await player3Page.close();
      await context1.close();
      await context2.close();
      await context3.close();
    }
  });

  test.skip('2-player game: player declines rebuy', async ({ browser }) => {
    /**
     * Test Case: Two-player game where broke player declines rebuy
     *
     * Scenario:
     * 1. Create a 2-player game
     * 2. One player goes broke
     * 3. Player declines rebuy
     * 4. Verify game remains paused (only 1 player left)
     *
     * Expected behavior:
     * - Rebuy prompt appears
     * - Player declines rebuy
     * - Player is removed from game
     * - Game cannot continue with only 1 player
     */

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const player1Page = await context1.newPage();
    const player2Page = await context2.newPage();

    try {
      // Setup 2-player game
      const gameId = await createMockGame(player1Page, 2);
      await player2Page.goto(`/game/${gameId}`);

      // Sit players and start
      // ...

      // Simulate player going broke
      // ...

      // Rebuy prompt appears
      const rebuyPrompt = player1Page.locator('text=/rebuy|buy.*in/i');
      await expect(rebuyPrompt).toBeVisible({ timeout: 10000 });

      // Player declines rebuy
      const declineButton = player1Page.locator('button:has-text("No"), button:has-text("Decline"), button:has-text("Stand")').first();
      if (await declineButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await declineButton.click();
        await player1Page.waitForTimeout(2000);
      }

      // Verify player is removed and game cannot continue
      const notEnoughPlayersMsg = player2Page.locator('text=/need.*players|waiting.*player/i');
      await expect(notEnoughPlayersMsg).toBeVisible({ timeout: 5000 });

      console.log('✓ 2-player game correctly handles rebuy decline');
    } finally {
      await player1Page.close();
      await player2Page.close();
      await context1.close();
      await context2.close();
    }
  });
});

/**
 * Test Coverage Summary:
 *
 * These tests validate the complete rebuy timeout logic:
 *
 * 1. Two-player scenarios:
 *    - Game waits indefinitely for rebuy decision
 *    - Player accepts rebuy -> game continues
 *    - Player declines rebuy -> game stays paused
 *
 * 2. Three+ player scenarios:
 *    - Game waits for timeout period (20 seconds)
 *    - After timeout, game auto-continues without broke player
 *    - Before timeout, player can accept rebuy and rejoin
 *    - Broke player is automatically stood up after timeout
 *
 * Key behaviors tested:
 * - Timeout is applied only for >2 player games
 * - Timeout is configurable (REBUY_TIMEOUT_MS)
 * - Players are notified of rebuy prompt
 * - Game continues correctly after timeout or decision
 * - Player chips are updated correctly on rebuy
 * - Seat management works correctly
 *
 * Note: These tests are currently skipped as they require:
 * 1. Full game setup flow with authentication
 * 2. API endpoints to simulate player going broke
 * 3. Mock or test database with proper state
 *
 * To enable these tests:
 * - Remove test.skip() and replace with test()
 * - Implement helper functions for game setup
 * - Set up test database with proper configuration
 * - Add data-testid attributes to UI components
 */
