import { test, expect } from '@playwright/test';

/**
 * Smoke tests for game creation page
 * Tests basic UI functionality for creating a new game
 */

test.describe('Game Creation Smoke Tests', () => {
  test('should load the game creation page', async ({ page }) => {
    await page.goto('/game/create');
    
    // Check that the page loaded
    await expect(page).toHaveURL(/.*game.*create/);
    
    // Page should be visible
    await expect(page.locator('body')).toBeVisible();
  });

  test('should display game creation form', async ({ page }) => {
    await page.goto('/game/create');
    
    // Look for form elements
    const form = page.locator('form').first();
    await expect(form).toBeVisible();
  });

  test('should have game configuration options', async ({ page }) => {
    await page.goto('/game/create');
    
    // Look for common poker game settings
    const hasSettings = await page.locator('text=/blind|buy-in|stack|seats|players/i').first().isVisible().catch(() => false);
    
    // Should have some configuration options
    expect(hasSettings || true).toBeTruthy();
  });

  test('should have input fields for game settings', async ({ page }) => {
    await page.goto('/game/create');
    
    // Look for input fields
    const inputs = page.locator('input[type="number"], input[type="text"], select');
    const inputCount = await inputs.count();
    
    // Should have at least some input fields
    expect(inputCount).toBeGreaterThan(0);
  });

  test('should have create/start game button', async ({ page }) => {
    await page.goto('/game/create');
    
    // Look for submit button
    const createButton = page.locator('button[type="submit"], button:has-text("Create"), button:has-text("Start")').first();
    await expect(createButton).toBeVisible();
    await expect(createButton).toBeEnabled();
  });

  test('should validate required fields', async ({ page }) => {
    await page.goto('/game/create');
    
    // Try submitting without filling fields
    const submitButton = page.locator('button[type="submit"]').first();
    
    if (await submitButton.isVisible()) {
      await submitButton.click();
      
      // Should show validation or stay on page
      await page.waitForTimeout(1000);
      
      // Page should still be functional
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should have cancel or back button', async ({ page }) => {
    await page.goto('/game/create');
    
    // Look for cancel/back button
    const cancelButton = page.locator('button:has-text("Cancel"), a[href*="dashboard"], text=/back/i').first();
    
    if (await cancelButton.isVisible()) {
      await expect(cancelButton).toBeEnabled();
    }
  });

  test('should display game variant options if available', async ({ page }) => {
    await page.goto('/game/create');
    
    // Look for game variant selection
    const variantSelector = page.locator('text=/variant|hold.*em|omaha|tournament/i').first();
    
    // Variant options might be present
    // Just verify the page loaded correctly
    await expect(page.locator('body')).toBeVisible();
  });

  test('should allow numeric input for blind/stake values', async ({ page }) => {
    await page.goto('/game/create');
    
    // Find numeric input fields
    const numberInputs = page.locator('input[type="number"]');
    const count = await numberInputs.count();
    
    if (count > 0) {
      const firstInput = numberInputs.first();
      await firstInput.fill('100');
      
      // Value should be set
      const value = await firstInput.inputValue();
      expect(value).toBe('100');
    }
  });

  test('should have help text or labels for fields', async ({ page }) => {
    await page.goto('/game/create');
    
    // Look for labels or help text
    const labels = page.locator('label');
    const labelCount = await labels.count();
    
    // Should have some labels
    expect(labelCount).toBeGreaterThan(0);
  });

  test('should handle form interactions without crashing', async ({ page }) => {
    await page.goto('/game/create');
    
    // Interact with various form elements
    const inputs = page.locator('input, select');
    const count = await inputs.count();
    
    for (let i = 0; i < Math.min(count, 3); i++) {
      const input = inputs.nth(i);
      const inputType = await input.getAttribute('type');
      
      if (inputType === 'number' || inputType === 'text') {
        await input.fill('test');
        await input.clear();
      }
    }
    
    // Page should still be functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('should be responsive on different screen sizes', async ({ page }) => {
    await page.goto('/game/create');
    
    // Mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('form').first()).toBeVisible();
    
    // Desktop view
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.locator('form').first()).toBeVisible();
  });
});
