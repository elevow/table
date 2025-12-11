import { test, expect } from '@playwright/test';

/**
 * Smoke tests for the homepage (login/registration)
 * Tests basic UI functionality and page load
 */

test.describe('Homepage Smoke Tests', () => {
  test('should load the homepage successfully', async ({ page }) => {
    await page.goto('/');
    
    // Check that the page loaded
    await expect(page).toHaveTitle(/Table/i);
    
    // Check that the main form is visible
    await expect(page.locator('form')).toBeVisible();
  });

  test('should display login form by default', async ({ page }) => {
    await page.goto('/');
    
    // Check for email and password inputs
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    
    // Check for submit button
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should toggle between login and register forms', async ({ page }) => {
    await page.goto('/');
    
    // Initially should be in login mode (no username field)
    const usernameField = page.locator('input[type="text"]').first();
    
    // Try to find a toggle/switch link
    const toggleLink = page.locator('text=/sign up|register|create account/i').first();
    
    if (await toggleLink.isVisible()) {
      await toggleLink.click();
      
      // After clicking, username field should appear for registration
      await expect(usernameField).toBeVisible({ timeout: 5000 });
    }
  });

  test('should show error message on empty login submission', async ({ page }) => {
    await page.goto('/');
    
    // Submit empty form
    await page.locator('button[type="submit"]').click();
    
    // Browser validation should prevent submission
    // Check for HTML5 validation or custom error
    const emailInput = page.locator('input[type="email"]');
    
    // Email input should be marked as invalid or have validation message
    const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('should have guest access option if available', async ({ page }) => {
    await page.goto('/');
    
    // Look for guest access button/link
    const guestButton = page.locator('text=/guest|continue as guest|skip/i').first();
    
    // This is optional - some apps may have guest access
    if (await guestButton.isVisible()) {
      await expect(guestButton).toBeEnabled();
    }
  });

  test('should validate email format', async ({ page }) => {
    await page.goto('/');
    
    const emailInput = page.locator('input[type="email"]');
    const submitButton = page.locator('button[type="submit"]');
    
    // Enter invalid email
    await emailInput.fill('invalid-email');
    await submitButton.click();
    
    // Should show HTML5 validation error
    const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('should have working links to password reset if available', async ({ page }) => {
    await page.goto('/');
    
    // Look for forgot password link
    const forgotPasswordLink = page.locator('text=/forgot password|reset password/i').first();
    
    if (await forgotPasswordLink.isVisible()) {
      await expect(forgotPasswordLink).toBeEnabled();
      
      // Click and verify navigation
      await forgotPasswordLink.click();
      await expect(page).toHaveURL(/forgot-password|reset-password/i);
    }
  });
});
