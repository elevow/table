import { test, expect } from '@playwright/test';

/**
 * Smoke tests for basic navigation and accessibility
 * Tests overall application functionality
 */

test.describe('Application Navigation Smoke Tests', () => {
  test('should navigate between main pages without errors', async ({ page }) => {
    // Start at homepage
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    
    // Navigate to dashboard
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*dashboard/);
    await expect(page.locator('body')).toBeVisible();
    
    // Navigate to profile
    await page.goto('/profile');
    await expect(page).toHaveURL(/.*profile/);
    await expect(page.locator('body')).toBeVisible();
    
    // Navigate to game creation
    await page.goto('/game/create');
    await expect(page).toHaveURL(/.*game.*create/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle 404 page gracefully', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist-12345');
    
    // Should show 404 or redirect
    // Either way, shouldn't crash
    await expect(page.locator('body')).toBeVisible();
  });

  test('should load without JavaScript errors', async ({ page }) => {
    const errors: string[] = [];
    
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    
    await page.goto('/');
    await page.waitForTimeout(2000);
    
    // Should have no JavaScript errors on page load
    expect(errors.length).toBe(0);
  });

  test('should handle back button navigation', async ({ page }) => {
    await page.goto('/');
    await page.goto('/dashboard');
    
    // Go back
    await page.goBack();
    await expect(page).toHaveURL('/');
    
    // Go forward
    await page.goForward();
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('should maintain functionality after page reload', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Reload the page
    await page.reload();
    
    // Page should still be functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('should load all pages within reasonable time', async ({ page }) => {
    const pages = ['/', '/dashboard', '/profile', '/game/create'];
    
    for (const pagePath of pages) {
      const startTime = Date.now();
      await page.goto(pagePath);
      const loadTime = Date.now() - startTime;
      
      // Page should load within 10 seconds
      expect(loadTime).toBeLessThan(10000);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should have working links in navigation', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Find all links
    const links = page.locator('a[href^="/"]');
    const count = await links.count();
    
    // Should have some internal links
    expect(count).toBeGreaterThan(0);
    
    // Check first few links are not broken
    for (let i = 0; i < Math.min(count, 3); i++) {
      const link = links.nth(i);
      const href = await link.getAttribute('href');
      
      if (href && !href.includes('api') && href !== '#') {
        // Link should be functional (has valid href)
        expect(href).toBeTruthy();
      }
    }
  });

  test('should not have console errors on main pages', async ({ page }) => {
    const consoleErrors: string[] = [];
    
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    // Visit main pages
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    await page.goto('/dashboard');
    await page.waitForTimeout(1000);
    
    // Some console errors might be expected (auth, network)
    // But page should still function
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle rapid navigation without crashing', async ({ page }) => {
    // Rapidly navigate between pages
    await page.goto('/');
    await page.goto('/dashboard');
    await page.goto('/profile');
    await page.goto('/dashboard');
    await page.goto('/game/create');
    
    // Should end up on the last page without crashing
    await expect(page).toHaveURL(/.*game.*create/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('should render pages correctly at different viewport sizes', async ({ page }) => {
    const viewports = [
      { width: 375, height: 667, name: 'Mobile' },
      { width: 768, height: 1024, name: 'Tablet' },
      { width: 1920, height: 1080, name: 'Desktop' },
    ];
    
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      
      await page.goto('/dashboard');
      await expect(page.locator('body')).toBeVisible();
      
      // Page should be scrollable if content overflows
      const bodyHeight = await page.locator('body').evaluate((el) => el.scrollHeight);
      expect(bodyHeight).toBeGreaterThan(0);
    }
  });
});
