# Playwright UI Smoke Tests

This directory contains Playwright end-to-end (E2E) smoke tests for validating basic UI functionality of the Table poker application.

## Overview

The smoke tests are designed to:
- Verify that key pages load without errors
- Test basic user interactions and navigation
- Ensure forms and inputs work correctly
- Validate responsive design across different screen sizes
- Catch JavaScript errors and rendering issues

## Test Structure

```
e2e/
├── tests/
│   ├── homepage.spec.ts       # Login/registration page tests
│   ├── dashboard.spec.ts      # Dashboard functionality tests
│   ├── profile.spec.ts        # Profile page tests
│   ├── game-creation.spec.ts  # Game creation page tests
│   └── navigation.spec.ts     # General navigation and accessibility tests
└── README.md                  # This file
```

## Prerequisites

1. Node.js 18+ installed
2. Dependencies installed: `npm install`
3. Playwright browsers installed: `npx playwright install chromium`

## Running Tests

### Run all smoke tests:
```bash
npm run test:e2e
```

### Run tests with UI mode (interactive):
```bash
npm run test:e2e:ui
```

### Run tests in headed mode (see browser):
```bash
npm run test:e2e:headed
```

### Run tests in debug mode:
```bash
npm run test:e2e:debug
```

### Run a specific test file:
```bash
npx playwright test e2e/tests/homepage.spec.ts
```

### Run tests matching a pattern:
```bash
npx playwright test --grep "should load"
```

## Test Configuration

The test configuration is defined in `playwright.config.ts` at the project root. Key settings:

- **Base URL**: `http://localhost:3000` (configurable via `PLAYWRIGHT_BASE_URL` env var)
- **Browser**: Chromium (Desktop Chrome)
- **Test timeout**: 30 seconds per test
- **Retries**: 2 on CI, 0 locally
- **Screenshots**: Captured on test failure
- **Videos**: Retained on test failure
- **Dev server**: Automatically started before tests

## Environment Variables

- `PLAYWRIGHT_BASE_URL`: Override the base URL for tests (default: `http://localhost:3000`)
- `CI`: When set, enables stricter CI mode with retries and single worker

Example:
```bash
PLAYWRIGHT_BASE_URL=http://localhost:3001 npm run test:e2e
```

## Test Coverage

### Homepage Tests (`homepage.spec.ts`)
- ✅ Page loads successfully
- ✅ Login form displays correctly
- ✅ Toggle between login/register forms
- ✅ Form validation (empty fields, invalid email)
- ✅ Guest access (if available)
- ✅ Password reset link (if available)

### Dashboard Tests (`dashboard.spec.ts`)
- ✅ Page loads successfully
- ✅ Room code input and validation
- ✅ User avatar display
- ✅ Navigation elements
- ✅ Profile page link
- ✅ Admin panel (for admin users)
- ✅ Player stats display
- ✅ Game creation navigation
- ✅ Invalid room code handling

### Profile Tests (`profile.spec.ts`)
- ✅ Page loads successfully
- ✅ Avatar display and upload
- ✅ Theme toggle functionality
- ✅ User information display
- ✅ Navigation to dashboard
- ✅ Account settings
- ✅ Avatar interaction
- ✅ Unauthenticated state handling
- ✅ Responsive layout

### Game Creation Tests (`game-creation.spec.ts`)
- ✅ Page loads successfully
- ✅ Game creation form display
- ✅ Configuration options
- ✅ Input fields for game settings
- ✅ Create/start button
- ✅ Field validation
- ✅ Cancel/back button
- ✅ Game variant options
- ✅ Numeric input handling
- ✅ Form labels and help text
- ✅ Responsive design

### Navigation Tests (`navigation.spec.ts`)
- ✅ Navigation between main pages
- ✅ 404 page handling
- ✅ No JavaScript errors on load
- ✅ Back/forward button navigation
- ✅ Page reload functionality
- ✅ Page load performance
- ✅ Working internal links
- ✅ Console error monitoring
- ✅ Rapid navigation handling
- ✅ Responsive rendering

## Writing New Tests

### Basic Test Structure:
```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test('should do something', async ({ page }) => {
    await page.goto('/your-page');
    
    // Interact with page
    await page.locator('button').click();
    
    // Assert expected behavior
    await expect(page.locator('.result')).toBeVisible();
  });
});
```

### Best Practices:
1. **Use descriptive test names**: Clearly describe what is being tested
2. **Keep tests independent**: Each test should work on its own
3. **Use proper selectors**: Prefer data-testid, text content, or ARIA roles
4. **Handle timing**: Use `await expect()` instead of arbitrary waits
5. **Test resilience**: Don't rely on specific timing or animation completion
6. **Clean assertions**: Test one thing per test when possible

### Common Patterns:
```typescript
// Wait for element to be visible
await expect(page.locator('.element')).toBeVisible();

// Check page URL
await expect(page).toHaveURL(/pattern/);

// Fill form field
await page.locator('input[type="email"]').fill('test@example.com');

// Click button
await page.locator('button[type="submit"]').click();

// Check if element exists (conditional)
const isVisible = await page.locator('.optional').isVisible().catch(() => false);

// Handle navigation
await page.goto('/path');
await page.goBack();
await page.goForward();
await page.reload();
```

## Debugging

### View last test run report:
```bash
npx playwright show-report
```

### Run with verbose output:
```bash
npx playwright test --reporter=list --workers=1
```

### Take a screenshot during test:
```typescript
await page.screenshot({ path: 'screenshot.png' });
```

### Pause execution for debugging:
```typescript
await page.pause();
```

### Use Playwright Inspector:
```bash
PWDEBUG=1 npx playwright test
```

## CI/CD Integration

The tests are configured to run in CI environments. When `CI=true`:
- Tests retry up to 2 times on failure
- Tests run sequentially (1 worker) for stability
- Test reports and artifacts are generated

### GitHub Actions Example:
```yaml
- name: Install dependencies
  run: npm ci

- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium

- name: Run Playwright tests
  run: npm run test:e2e
  env:
    CI: true

- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

## Troubleshooting

### Tests timing out:
- Increase timeout in `playwright.config.ts`
- Check if dev server is starting correctly
- Verify network connectivity

### Browser not launching:
- Run: `npx playwright install chromium`
- Check system dependencies
- Try headed mode: `npm run test:e2e:headed`

### Tests failing inconsistently:
- Review element selectors
- Add proper waits (`await expect()`)
- Check for race conditions
- Run in headed mode to observe behavior

### Dev server not starting:
- Ensure port 3000 is available
- Check `.env.local` configuration
- Verify database connection (if required)

## Additional Resources

- [Playwright Documentation](https://playwright.dev)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Test Selectors](https://playwright.dev/docs/selectors)
- [API Reference](https://playwright.dev/docs/api/class-test)

## Contributing

When adding new smoke tests:
1. Follow the existing test structure
2. Keep tests focused and independent
3. Add descriptive comments
4. Update this README if adding new test files
5. Ensure tests pass locally before committing

## License

Same as the parent project (see LICENSE in repository root)
