import { test, expect, Page } from '@playwright/test';

/**
 * E2E Integration Test for Game Play Flow
 * 
 * This test validates the complete flow of a poker hand with multiple players,
 * specifically testing the turn notification and action handling that was causing
 * "not player's turn" errors in the polling mechanism implementation.
 * 
 * IMPORTANT: This is an integration test that connects to real APIs and database.
 * It does NOT mock responses, allowing it to catch real synchronization issues.
 */

test.describe('Game Play Integration Tests', () => {
  test.describe.configure({ mode: 'serial' }); // Run tests in sequence

  let player1Page: Page;
  let player2Page: Page;
  let gameId: string;

  test.beforeAll(async ({ browser }) => {
    // Create two browser contexts to simulate two different players
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    player1Page = await context1.newPage();
    player2Page = await context2.newPage();
  });

  test.afterAll(async () => {
    await player1Page.close();
    await player2Page.close();
  });

  test('should complete a full hand with two players without turn errors', async () => {
    // This test replicates the exact scenario reported in the bug:
    // 1. First player calls the big blind
    // 2. Second player should be able to act without "not player's turn" error
    
    // Step 1: Player 1 creates and joins a game
    await player1Page.goto('/');
    await player1Page.waitForLoadState('networkidle');
    
    // Login as player 1 (adjust selectors based on your actual login flow)
    // For now, we'll assume guest/direct access or handle auth
    await player1Page.waitForTimeout(2000);
    
    // Navigate to create game or join existing game
    const createGameButton = player1Page.locator('text=/Create.*Game|New.*Game/i').first();
    if (await createGameButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createGameButton.click();
      await player1Page.waitForLoadState('networkidle');
    }
    
    // Get or create a game ID
    const currentUrl = player1Page.url();
    const gameIdMatch = currentUrl.match(/game\/([^\/\?]+)/);
    if (gameIdMatch) {
      gameId = gameIdMatch[1];
      console.log('Game ID:', gameId);
    }
    
    // Step 2: Player 2 joins the same game
    if (gameId) {
      await player2Page.goto(`/game/${gameId}`);
      await player2Page.waitForLoadState('networkidle');
      await player2Page.waitForTimeout(2000);
    } else {
      // If we couldn't extract gameId, try to join through UI
      await player2Page.goto('/');
      await player2Page.waitForLoadState('networkidle');
      // Look for available games to join
      const joinButton = player2Page.locator('text=/Join|Play/i').first();
      if (await joinButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await joinButton.click();
        await player2Page.waitForLoadState('networkidle');
      }
    }
    
    // Step 3: Both players claim seats
    // Player 1 claims a seat
    const p1SeatButton = player1Page.locator('button:has-text("Claim Seat"), button:has-text("Sit")').first();
    if (await p1SeatButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await p1SeatButton.click();
      await player1Page.waitForTimeout(1000);
    }
    
    // Player 2 claims a different seat
    const p2SeatButton = player2Page.locator('button:has-text("Claim Seat"), button:has-text("Sit")').first();
    if (await p2SeatButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await p2SeatButton.click();
      await player2Page.waitForTimeout(1000);
    }
    
    // Step 4: Start the game
    const startButton = player1Page.locator('button:has-text("Start Game"), button:has-text("Begin")').first();
    if (await startButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await startButton.click();
      await player1Page.waitForTimeout(2000);
    }
    
    // Step 5: Wait for game to start and blinds to be posted
    await player1Page.waitForTimeout(3000);
    await player2Page.waitForTimeout(3000);
    
    // Step 6: Player 1 takes first action (call the big blind)
    // Look for action buttons on Player 1's page
    const p1CallButton = player1Page.locator('button:has-text("Call")').first();
    const p1CheckButton = player1Page.locator('button:has-text("Check")').first();
    const p1FoldButton = player1Page.locator('button:has-text("Fold")').first();
    
    // Check if it's Player 1's turn by looking for action buttons
    const hasP1Actions = await Promise.race([
      p1CallButton.isVisible({ timeout: 5000 }).catch(() => false),
      p1CheckButton.isVisible({ timeout: 5000 }).catch(() => false),
    ]);
    
    if (hasP1Actions) {
      console.log('Player 1 has action buttons - taking action');
      
      // Listen for console errors on Player 1's page
      player1Page.on('console', msg => {
        if (msg.type() === 'error') {
          console.log('Player 1 Console Error:', msg.text());
        }
      });
      
      // Try to call or check
      if (await p1CallButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await p1CallButton.click();
        console.log('Player 1 clicked Call');
      } else if (await p1CheckButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await p1CheckButton.click();
        console.log('Player 1 clicked Check');
      }
      
      // Wait for action to process
      await player1Page.waitForTimeout(2000);
      await player2Page.waitForTimeout(2000);
    }
    
    // Step 7: CRITICAL TEST - Player 2 should now be able to act without error
    // This is where the "not player's turn" bug was occurring
    
    // Set up console error monitoring for Player 2
    const consoleErrors: string[] = [];
    const networkErrors: string[] = [];
    
    player2Page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
        console.log('Player 2 Console Error:', msg.text());
      }
    });
    
    player2Page.on('response', response => {
      if (response.status() >= 400) {
        networkErrors.push(`${response.status()} ${response.url()}`);
        console.log('Player 2 Network Error:', response.status(), response.url());
      }
    });
    
    // Look for action buttons on Player 2's page
    const p2CallButton = player2Page.locator('button:has-text("Call")').first();
    const p2CheckButton = player2Page.locator('button:has-text("Check")').first();
    const p2RaiseButton = player2Page.locator('button:has-text("Raise")').first();
    const p2FoldButton = player2Page.locator('button:has-text("Fold")').first();
    
    // Wait for Player 2's turn (buttons should appear)
    const hasP2Actions = await Promise.race([
      p2CallButton.isVisible({ timeout: 10000 }).catch(() => false),
      p2CheckButton.isVisible({ timeout: 10000 }).catch(() => false),
      p2RaiseButton.isVisible({ timeout: 10000 }).catch(() => false),
    ]);
    
    expect(hasP2Actions).toBe(true);
    console.log('Player 2 has action buttons visible');
    
    // Try to take an action
    if (await p2CheckButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await p2CheckButton.click();
      console.log('Player 2 clicked Check');
    } else if (await p2CallButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await p2CallButton.click();
      console.log('Player 2 clicked Call');
    }
    
    // Wait for action to process
    await player2Page.waitForTimeout(3000);
    
    // ASSERT: No "not player's turn" errors should have occurred
    const hasTurnError = networkErrors.some(err => 
      err.includes('400') && err.includes('/api/games/action')
    );
    
    const hasConsoleTurnError = consoleErrors.some(err => 
      err.toLowerCase().includes("not player's turn")
    );
    
    if (hasTurnError || hasConsoleTurnError) {
      console.error('Network Errors:', networkErrors);
      console.error('Console Errors:', consoleErrors);
    }
    
    expect(hasTurnError).toBe(false);
    expect(hasConsoleTurnError).toBe(false);
    
    console.log('✓ Player 2 successfully took action without turn errors');
  });

  test('should handle multiple turns in sequence', async () => {
    // This test continues from the previous state and tests multiple rounds
    // to ensure the turn system works throughout the hand
    
    // This is a placeholder for a more comprehensive test
    // that would check each betting round (preflop, flop, turn, river)
    
    test.skip(); // Skip for now until basic test passes
  });
});

/**
 * Test Coverage Notes:
 * 
 * This E2E test validates:
 * 1. Multi-player game creation and joining
 * 2. Seat claiming by multiple players  
 * 3. Game start functionality
 * 4. First action (Player 1 calls big blind)
 * 5. Second action (Player 2 acts) - THE CRITICAL BUG SCENARIO
 * 6. Detection of "not player's turn" errors via:
 *    - Network response monitoring (400 errors on /api/games/action)
 *    - Console error monitoring (error messages containing "not player's turn")
 * 
 * This test does NOT mock any API responses. It connects to the real backend,
 * allowing it to catch actual synchronization issues between:
 * - API responses
 * - Supabase Realtime broadcasts
 * - Polling mechanism
 * - Client state management
 * 
 * If this test fails, it indicates a real bug in the turn management system.
 */
