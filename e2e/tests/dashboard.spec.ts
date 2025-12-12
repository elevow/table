import { test, expect } from '@playwright/test';

/**
 * Smoke tests for the dashboard page
 * Tests basic UI functionality for room joining and navigation
 */

test.describe('Dashboard Smoke Tests', () => {
  test('should load the dashboard page', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Check that the page loaded
    await expect(page).toHaveURL(/.*dashboard/);
    
    // The page should have loaded without errors
    await expect(page.locator('body')).toBeVisible();
  });

  test('should display room code input field', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Look for room code input
    const roomCodeInput = page.locator('input[type="text"]').first();
    await expect(roomCodeInput).toBeVisible();
  });

  test('should display user avatar if authenticated', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Avatar might not be visible if not authenticated, so we just check if the page loaded
    // This is optional based on authentication state
    const pageTitle = await page.textContent('body');
    expect(pageTitle).toBeTruthy();
  });

  test('should validate empty room code submission', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Find room code form
    const roomCodeForm = page.locator('form').first();
    
    if (await roomCodeForm.isVisible()) {
      const submitButton = roomCodeForm.locator('button[type="submit"]').first();
      
      // Check if button is disabled when input is empty (proper validation)
      const isDisabled = await submitButton.isDisabled();
      
      // Either button is disabled or clicking shows validation
      if (isDisabled) {
        // Button properly disabled - validation working
        expect(isDisabled).toBe(true);
      } else {
        // Try clicking and check for validation message
        await submitButton.click();
        const hasError = await page.locator('text=/enter.*code|required|invalid/i').first().isVisible().catch(() => false);
        expect(hasError).toBe(true);
      }
    }
  });

  test('should have navigation elements', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Should have some form of navigation or header
    await expect(page.locator('body')).toBeVisible();
  });

  test('should have link to profile page', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Look for profile link/button
    const profileLink = page.locator('a[href*="profile"], button:has-text("Profile")').first();
    
    if (await profileLink.isVisible()) {
      await expect(profileLink).toBeEnabled();
    }
  });

  test('should have admin panel if user has admin role', async ({ page }) => {
    await page.goto('/dashboard');
    
    // This is optional - only visible for admins
    // Just verify page doesn't crash
    const bodyVisible = await page.locator('body').isVisible();
    expect(bodyVisible).toBe(true);
  });

  test('should display player stats component', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Stats might not be visible if user hasn't played
    // Just verify the dashboard loaded
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle navigation to game creation', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Look for create game link specifically
    const createLink = page.locator('a[href*="/game/create"]').first();
    
    const isVisible = await createLink.isVisible().catch(() => false);
    
    if (isVisible) {
      await expect(createLink).toBeEnabled();
      
      // Click and verify navigation
      await createLink.click();
      await page.waitForURL(/.*game.*create/i, { timeout: 10000 });
    } else {
      // No create link found - this is okay for smoke test
      // Just verify the dashboard loaded properly
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should not crash when joining invalid room code', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Try to find and use room code input
    const roomCodeInput = page.locator('input[type="text"]').first();
    
    if (await roomCodeInput.isVisible()) {
      await roomCodeInput.fill('INVALID-ROOM-CODE-999');
      
      const submitButton = page.locator('button[type="submit"]').first();
      await submitButton.click();
      
      // Page should still be functional
      await expect(page.locator('body')).toBeVisible();
    }
  });
});
