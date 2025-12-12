# Playwright UI Smoke Tests

This directory contains Playwright end-to-end (E2E) smoke tests for validating basic UI functionality of the Table poker application.

## Overview

The smoke tests are designed to:
- Verify that key pages load without errors
- Test basic user interactions and navigation
- Ensure forms and inputs work correctly
- Validate responsive design across different screen sizes
- Catch JavaScript errors and rendering issues

## Documentation

- **[MANUAL_TEST_CASES.md](MANUAL_TEST_CASES.md)** - Complete list of 48 manual test cases that define what should be tested
- **[README.md](README.md)** - This file - How to run and write automated tests
- **[../PLAYWRIGHT_TESTS.md](../PLAYWRIGHT_TESTS.md)** - Test execution summary and results

## Test Structure

```
e2e/
├── MANUAL_TEST_CASES.md       # Manual test case specifications (48 test cases)
├── tests/
│   ├── homepage.spec.ts       # Login/registration page tests (TC-001 to TC-007)
│   ├── dashboard.spec.ts      # Dashboard functionality tests (TC-008 to TC-017)
│   ├── profile.spec.ts        # Profile page tests (TC-018 to TC-026)
│   ├── game-creation.spec.ts  # Game creation page tests (TC-027 to TC-038)
│   └── navigation.spec.ts     # General navigation tests (TC-039 to TC-048)
└── README.md                  # This file
```

Each automated test maps directly to one or more manual test cases documented in `MANUAL_TEST_CASES.md`.

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

### Automated Testing in CI

The Playwright tests are integrated into the GitHub Actions CI workflow and run automatically on:
- Every push to any branch
- Every pull request

**CI Workflow Configuration:**
The tests run in a separate `e2e-tests` job that:
1. Runs after the main `build` job succeeds
2. Installs Playwright browsers with dependencies
3. Creates `.env.local` with mock database settings
4. Executes all 49 smoke tests
5. Uploads test reports and results as artifacts (available for 30 days)

**Viewing Test Results:**
When tests run in CI, you can:
- View test results in the Actions tab of the GitHub repository
- Download the `playwright-report` artifact to see the HTML report
- Download the `test-results` artifact to see screenshots/videos of failures

### GitHub Actions Configuration

The complete CI workflow is in `.github/workflows/ci.yml`:

```yaml
e2e-tests:
  runs-on: ubuntu-latest
  needs: build

  steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '18'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Install Playwright browsers
      run: npx playwright install --with-deps chromium

    - name: Create .env.local for tests
      run: |
        echo "USE_MOCK_DB=true" > .env.local
        echo "NEXT_PUBLIC_SHOW_DB_HEALTH=false" >> .env.local

    - name: Run Playwright tests
      run: npm run test:e2e
      env:
        CI: true

    - name: Upload Playwright report
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: playwright-report
        path: playwright-report/
        retention-days: 30

    - name: Upload test results
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: test-results
        path: test-results/
        retention-days: 30
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

## Manual vs Automated Testing

### Test Development Process

1. **Manual Test Cases First** - Start by documenting test cases in `MANUAL_TEST_CASES.md`:
   - Define what to test (objective)
   - List steps to perform
   - Specify expected results
   - Assign priority level

2. **Automate the Tests** - Implement automated tests based on manual test cases:
   - Reference the test case ID in test comments
   - Follow the manual test steps in automation code
   - Verify the same expected results

3. **Keep Both Updated** - Maintain both documents:
   - Update manual test cases when features change
   - Update automated tests to match
   - Document new test cases before automating

### When to Use Manual vs Automated

**Manual Testing is better for:**
- Exploratory testing and finding edge cases
- Visual design and UX evaluation
- One-time or rarely executed tests
- Tests requiring human judgment

**Automated Testing is better for:**
- Regression testing (run frequently)
- Smoke tests before deployment
- Tests that need to run on multiple browsers
- Consistent, repeatable test execution

**Current Status:**
All 48 manual test cases (TC-001 to TC-048) have been automated. Manual test cases remain valuable for:
- Understanding test intent and requirements
- Manual verification when automation fails
- Onboarding new team members
- Creating new test cases before automation

## Contributing

When adding new smoke tests:
1. **First** - Document the manual test case in `MANUAL_TEST_CASES.md`
2. **Then** - Implement the automated test in the appropriate spec file
3. Reference the test case ID (e.g., TC-049) in your automation
4. Follow the existing test structure
5. Keep tests focused and independent
6. Add descriptive comments
7. Update this README if adding new test files
8. Ensure tests pass locally before committing

## License

Same as the parent project (see LICENSE in repository root)
