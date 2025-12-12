# Manual Smoke Test Cases

This document outlines the manual test cases that should be performed to validate basic UI functionality of the Table poker application. These test cases serve as the basis for the automated Playwright tests in `e2e/tests/`.

## Purpose

Smoke tests are designed to quickly validate that the core functionality of the application is working. They are not exhaustive but cover the most critical user paths to catch major issues before deeper testing.

## Test Environment Setup

**Prerequisites:**
- Application running on `http://localhost:3000`
- Browser: Chrome, Firefox, or Safari (latest versions)
- Clear browser cache and cookies before testing
- Test with both authenticated and unauthenticated users

---

## 1. Homepage / Login & Registration Tests

### TC-001: Homepage Loads Successfully
**Priority:** Critical  
**Objective:** Verify the homepage loads without errors

**Steps:**
1. Navigate to `http://localhost:3000`
2. Wait for page to fully load

**Expected Results:**
- Page loads within 5 seconds
- No JavaScript errors in console
- Page title contains "Table"
- Login/registration form is visible

**Automation Status:** ✅ Automated in `homepage.spec.ts`

---

### TC-002: Login Form Display
**Priority:** Critical  
**Objective:** Verify login form elements are present and functional

**Steps:**
1. Navigate to homepage
2. Observe the form elements

**Expected Results:**
- Email input field is visible and accepts text
- Password input field is visible and masks characters
- Submit button is visible and enabled
- Form labels are clear and readable

**Automation Status:** ✅ Automated in `homepage.spec.ts`

---

### TC-003: Toggle Between Login and Register
**Priority:** High  
**Objective:** Verify user can switch between login and registration modes

**Steps:**
1. Navigate to homepage
2. Look for "Sign up" or "Register" link/button
3. Click the toggle link
4. Observe form changes

**Expected Results:**
- Clicking toggle changes form to registration mode
- Username field appears in registration mode
- Form label changes appropriately
- Can toggle back to login mode

**Automation Status:** ✅ Automated in `homepage.spec.ts`

---

### TC-004: Form Validation - Empty Fields
**Priority:** High  
**Objective:** Verify proper validation when submitting empty forms

**Steps:**
1. Navigate to homepage
2. Leave email and password fields empty
3. Click submit button

**Expected Results:**
- Form does not submit
- HTML5 validation message appears on email field
- User remains on homepage
- No error messages in console

**Automation Status:** ✅ Automated in `homepage.spec.ts`

---

### TC-005: Email Format Validation
**Priority:** High  
**Objective:** Verify email field validates format

**Steps:**
1. Navigate to homepage
2. Enter invalid email format (e.g., "invalid-email")
3. Click submit button

**Expected Results:**
- Form does not submit
- Validation message indicates invalid email format
- Password field is not checked until email is valid

**Automation Status:** ✅ Automated in `homepage.spec.ts`

---

### TC-006: Guest Access (If Available)
**Priority:** Medium  
**Objective:** Verify guest access functionality

**Steps:**
1. Navigate to homepage
2. Look for "Continue as Guest" or similar option
3. Click guest access button

**Expected Results:**
- User is redirected to dashboard
- Guest can access limited features
- No authentication errors

**Automation Status:** ✅ Automated in `homepage.spec.ts`

---

### TC-007: Password Reset Link
**Priority:** Medium  
**Objective:** Verify password reset flow is accessible

**Steps:**
1. Navigate to homepage
2. Look for "Forgot Password" link
3. Click the link

**Expected Results:**
- User is redirected to password reset page
- Password reset form is visible
- URL changes to `/forgot-password` or similar

**Automation Status:** ✅ Automated in `homepage.spec.ts`

---

## 2. Dashboard Tests

### TC-008: Dashboard Page Load
**Priority:** Critical  
**Objective:** Verify dashboard page loads for authenticated users

**Steps:**
1. Navigate to `/dashboard` (may require authentication)
2. Wait for page to fully load

**Expected Results:**
- Page loads within 5 seconds
- URL contains "dashboard"
- Main dashboard content is visible
- No JavaScript errors

**Automation Status:** ✅ Automated in `dashboard.spec.ts`

---

### TC-009: Room Code Input Field
**Priority:** High  
**Objective:** Verify room code joining interface is present

**Steps:**
1. Navigate to dashboard
2. Locate room code input field

**Expected Results:**
- Input field for room code is visible
- Input accepts text/numbers
- Join button or submit button is present
- Placeholder text guides user

**Automation Status:** ✅ Automated in `dashboard.spec.ts`

---

### TC-010: Room Code Validation - Empty Input
**Priority:** High  
**Objective:** Verify validation when submitting empty room code

**Steps:**
1. Navigate to dashboard
2. Leave room code field empty
3. Click join button

**Expected Results:**
- Form does not submit OR button is disabled
- Validation message appears if button is enabled
- No page crash or error
- User remains on dashboard

**Automation Status:** ✅ Automated in `dashboard.spec.ts`

---

### TC-011: Invalid Room Code Handling
**Priority:** High  
**Objective:** Verify graceful handling of invalid room codes

**Steps:**
1. Navigate to dashboard
2. Enter invalid room code (e.g., "INVALID-999")
3. Click join button

**Expected Results:**
- Error message displays (e.g., "Room not found")
- Page does not crash
- User can retry with different code
- Input field is cleared or remains editable

**Automation Status:** ✅ Automated in `dashboard.spec.ts`

---

### TC-012: User Avatar Display
**Priority:** Medium  
**Objective:** Verify user avatar/profile picture displays

**Steps:**
1. Navigate to dashboard (authenticated user)
2. Look for avatar/profile picture

**Expected Results:**
- Avatar is visible (or placeholder if none uploaded)
- Avatar is clickable
- Appropriate size and positioning
- No broken image icons

**Automation Status:** ✅ Automated in `dashboard.spec.ts`

---

### TC-013: Navigation Elements Present
**Priority:** High  
**Objective:** Verify main navigation is available

**Steps:**
1. Navigate to dashboard
2. Observe navigation menu/header

**Expected Results:**
- Navigation menu is visible
- Links to main sections are present
- Navigation is consistently placed
- Responsive on different screen sizes

**Automation Status:** ✅ Automated in `dashboard.spec.ts`

---

### TC-014: Profile Page Link
**Priority:** Medium  
**Objective:** Verify link to profile page works

**Steps:**
1. Navigate to dashboard
2. Click profile link/avatar
3. Verify navigation

**Expected Results:**
- User is redirected to profile page
- URL changes to `/profile` or similar
- Profile page loads successfully
- No navigation errors

**Automation Status:** ✅ Automated in `dashboard.spec.ts`

---

### TC-015: Admin Panel Visibility (Admin Users)
**Priority:** Low  
**Objective:** Verify admin features are shown to admin users

**Steps:**
1. Login as admin user
2. Navigate to dashboard
3. Look for admin-specific features

**Expected Results:**
- Admin panel/section visible for admin users
- Admin panel hidden for regular users
- Admin features are accessible
- No permission errors

**Automation Status:** ✅ Automated in `dashboard.spec.ts`

---

### TC-016: Player Statistics Display
**Priority:** Medium  
**Objective:** Verify player stats are shown

**Steps:**
1. Navigate to dashboard
2. Look for statistics section

**Expected Results:**
- Stats section is visible (or placeholder)
- Stats are formatted correctly
- No data errors
- Updates reflect actual gameplay

**Automation Status:** ✅ Automated in `dashboard.spec.ts`

---

### TC-017: Game Creation Navigation
**Priority:** High  
**Objective:** Verify user can navigate to game creation

**Steps:**
1. Navigate to dashboard
2. Look for "Create Game" or similar button/link
3. Click the link

**Expected Results:**
- User is redirected to game creation page
- URL changes to `/game/create` or similar
- Game creation form loads
- No navigation errors

**Automation Status:** ✅ Automated in `dashboard.spec.ts`

---

## 3. Profile Page Tests

### TC-018: Profile Page Load
**Priority:** High  
**Objective:** Verify profile page loads correctly

**Steps:**
1. Navigate to `/profile`
2. Wait for page to load

**Expected Results:**
- Page loads within 5 seconds
- URL contains "profile"
- Profile information is visible
- No JavaScript errors

**Automation Status:** ✅ Automated in `profile.spec.ts`

---

### TC-019: Avatar Display and Upload
**Priority:** High  
**Objective:** Verify avatar management functionality

**Steps:**
1. Navigate to profile page
2. Observe avatar section
3. Look for upload button

**Expected Results:**
- Current avatar is displayed (or placeholder)
- Upload button is visible and functional
- File input accepts image files
- Preview shows on selection (if applicable)

**Automation Status:** ✅ Automated in `profile.spec.ts`

---

### TC-020: Theme Toggle Functionality
**Priority:** Medium  
**Objective:** Verify theme switching works

**Steps:**
1. Navigate to profile page
2. Locate theme toggle (light/dark mode)
3. Click toggle

**Expected Results:**
- Theme changes immediately
- Visual changes are visible (colors, backgrounds)
- Theme preference is saved
- Page remains functional after toggle

**Automation Status:** ✅ Automated in `profile.spec.ts`

---

### TC-021: User Information Display
**Priority:** High  
**Objective:** Verify user details are shown correctly

**Steps:**
1. Navigate to profile page (authenticated)
2. Observe user information section

**Expected Results:**
- Username is displayed
- Email is displayed (or masked)
- Other profile fields are visible
- Information matches user account

**Automation Status:** ✅ Automated in `profile.spec.ts`

---

### TC-022: Navigation Back to Dashboard
**Priority:** Medium  
**Objective:** Verify user can return to dashboard

**Steps:**
1. Navigate to profile page
2. Look for back/dashboard link
3. Click the link

**Expected Results:**
- User returns to dashboard
- URL changes to `/dashboard`
- Dashboard loads successfully
- No navigation errors

**Automation Status:** ✅ Automated in `profile.spec.ts`

---

### TC-023: Account Settings Access
**Priority:** Medium  
**Objective:** Verify account settings are accessible

**Steps:**
1. Navigate to profile page
2. Look for settings section/link

**Expected Results:**
- Settings section is visible or accessible
- Settings options are clear
- Changes can be made (if applicable)
- Settings are persisted

**Automation Status:** ✅ Automated in `profile.spec.ts`

---

### TC-024: Avatar Click Interaction
**Priority:** Low  
**Objective:** Verify clicking avatar doesn't cause errors

**Steps:**
1. Navigate to profile page
2. Click on avatar image

**Expected Results:**
- Action occurs (upload, preview, or no-op)
- No JavaScript errors
- Page remains functional
- User experience is clear

**Automation Status:** ✅ Automated in `profile.spec.ts`

---

### TC-025: Unauthenticated Access Handling
**Priority:** High  
**Objective:** Verify profile page handles unauthenticated users

**Steps:**
1. Clear authentication tokens
2. Navigate to `/profile`

**Expected Results:**
- User is redirected to login page, OR
- Page shows appropriate message
- No uncaught errors
- Graceful degradation

**Automation Status:** ✅ Automated in `profile.spec.ts`

---

### TC-026: Responsive Layout - Profile
**Priority:** Medium  
**Objective:** Verify profile page is responsive

**Steps:**
1. Navigate to profile page
2. Resize browser to mobile width (375px)
3. Resize to tablet width (768px)
4. Resize to desktop width (1920px)

**Expected Results:**
- Layout adjusts appropriately at each size
- All elements remain accessible
- No horizontal scrolling (mobile)
- Content is readable at all sizes

**Automation Status:** ✅ Automated in `profile.spec.ts`

---

## 4. Game Creation Tests

### TC-027: Game Creation Page Load
**Priority:** Critical  
**Objective:** Verify game creation page loads

**Steps:**
1. Navigate to `/game/create`
2. Wait for page to load

**Expected Results:**
- Page loads within 5 seconds
- URL contains "create"
- Game creation form is visible
- No JavaScript errors

**Automation Status:** ✅ Automated in `game-creation.spec.ts`

---

### TC-028: Game Configuration Form Display
**Priority:** Critical  
**Objective:** Verify form elements are present

**Steps:**
1. Navigate to game creation page
2. Observe form elements

**Expected Results:**
- Form is visible and well-formatted
- Input fields for game settings present
- Labels are clear
- Form is organized logically

**Automation Status:** ✅ Automated in `game-creation.spec.ts`

---

### TC-029: Game Settings Options
**Priority:** High  
**Objective:** Verify game configuration options available

**Steps:**
1. Navigate to game creation page
2. Review available settings

**Expected Results:**
- Blind/stake inputs are present
- Buy-in amount field exists
- Seat/player count option available
- Settings are appropriate for poker game

**Automation Status:** ✅ Automated in `game-creation.spec.ts`

---

### TC-030: Input Fields for Settings
**Priority:** High  
**Objective:** Verify input fields accept appropriate values

**Steps:**
1. Navigate to game creation page
2. Test each input field
3. Enter valid values

**Expected Results:**
- Number inputs accept numbers
- Text inputs accept text
- Dropdowns show options
- All fields are editable

**Automation Status:** ✅ Automated in `game-creation.spec.ts`

---

### TC-031: Create/Start Game Button
**Priority:** Critical  
**Objective:** Verify submit button is present and functional

**Steps:**
1. Navigate to game creation page
2. Locate create/start button

**Expected Results:**
- Button is visible
- Button may be disabled initially (validation)
- Button label is clear
- Button is clickable when valid

**Automation Status:** ✅ Automated in `game-creation.spec.ts`

---

### TC-032: Required Field Validation
**Priority:** High  
**Objective:** Verify validation for required fields

**Steps:**
1. Navigate to game creation page
2. Leave required fields empty
3. Click create button

**Expected Results:**
- Form does not submit OR button disabled
- Validation messages appear
- User is guided to complete fields
- No page crash

**Automation Status:** ✅ Automated in `game-creation.spec.ts`

---

### TC-033: Cancel/Back Button
**Priority:** Medium  
**Objective:** Verify user can cancel game creation

**Steps:**
1. Navigate to game creation page
2. Look for cancel/back button
3. Click button

**Expected Results:**
- User returns to previous page (dashboard)
- URL changes appropriately
- No data is saved
- Navigation is smooth

**Automation Status:** ✅ Automated in `game-creation.spec.ts`

---

### TC-034: Game Variant Options
**Priority:** Medium  
**Objective:** Verify game variants are selectable

**Steps:**
1. Navigate to game creation page
2. Look for variant selector

**Expected Results:**
- Variant options available (Hold'em, Omaha, etc.)
- Selector is functional
- Selection changes form if needed
- Default variant is pre-selected

**Automation Status:** ✅ Automated in `game-creation.spec.ts`

---

### TC-035: Numeric Input Handling
**Priority:** High  
**Objective:** Verify numeric fields handle values correctly

**Steps:**
1. Navigate to game creation page
2. Enter numbers in blind/stake fields
3. Try negative numbers, decimals

**Expected Results:**
- Fields accept positive numbers
- Invalid inputs are rejected or corrected
- Validation messages are clear
- Maximum/minimum values enforced

**Automation Status:** ✅ Automated in `game-creation.spec.ts`

---

### TC-036: Help Text and Labels
**Priority:** Medium  
**Objective:** Verify form has adequate documentation

**Steps:**
1. Navigate to game creation page
2. Review all form fields

**Expected Results:**
- Each field has a label
- Help text explains complex fields
- Labels are descriptive
- User understands what to enter

**Automation Status:** ✅ Automated in `game-creation.spec.ts`

---

### TC-037: Form Interaction Stability
**Priority:** High  
**Objective:** Verify form handles interaction without crashing

**Steps:**
1. Navigate to game creation page
2. Fill some fields
3. Clear fields
4. Change selections
5. Repeat several times

**Expected Results:**
- No JavaScript errors
- Form remains functional
- Data is not lost unexpectedly
- Page does not freeze

**Automation Status:** ✅ Automated in `game-creation.spec.ts`

---

### TC-038: Responsive Layout - Game Creation
**Priority:** Medium  
**Objective:** Verify form is responsive

**Steps:**
1. Navigate to game creation page
2. Test at mobile (375px), tablet (768px), desktop (1920px) sizes

**Expected Results:**
- Form layout adjusts to screen size
- All fields accessible on mobile
- Form is usable at all sizes
- No overlapping elements

**Automation Status:** ✅ Automated in `game-creation.spec.ts`

---

## 5. Navigation and General Tests

### TC-039: Cross-Page Navigation
**Priority:** Critical  
**Objective:** Verify navigation between main pages works

**Steps:**
1. Start at homepage
2. Navigate to dashboard
3. Navigate to profile
4. Navigate to game creation
5. Use browser back button

**Expected Results:**
- All pages load successfully
- URLs change correctly
- Browser history works
- No navigation errors
- Content loads on each page

**Automation Status:** ✅ Automated in `navigation.spec.ts`

---

### TC-040: 404 Page Handling
**Priority:** High  
**Objective:** Verify 404 errors are handled gracefully

**Steps:**
1. Navigate to non-existent page (e.g., `/this-does-not-exist`)

**Expected Results:**
- 404 page is shown OR redirect occurs
- User sees helpful message
- Navigation still works
- No uncaught errors

**Automation Status:** ✅ Automated in `navigation.spec.ts`

---

### TC-041: JavaScript Error Monitoring
**Priority:** Critical  
**Objective:** Verify pages load without JS errors

**Steps:**
1. Open browser console
2. Navigate to each main page
3. Monitor console for errors

**Expected Results:**
- No JavaScript errors on page load
- No uncaught exceptions
- Warnings are acceptable
- Page functions correctly

**Automation Status:** ✅ Automated in `navigation.spec.ts`

---

### TC-042: Browser Navigation (Back/Forward)
**Priority:** High  
**Objective:** Verify browser back/forward buttons work

**Steps:**
1. Navigate through several pages
2. Click browser back button
3. Click browser forward button
4. Verify page states

**Expected Results:**
- Back button returns to previous page
- Forward button goes forward
- Page state is preserved
- URLs update correctly

**Automation Status:** ✅ Automated in `navigation.spec.ts`

---

### TC-043: Page Reload Stability
**Priority:** High  
**Objective:** Verify pages handle reload correctly

**Steps:**
1. Navigate to each main page
2. Press F5 or click reload
3. Verify page state

**Expected Results:**
- Page reloads successfully
- Data is preserved or refetched
- No errors on reload
- Page remains functional

**Automation Status:** ✅ Automated in `navigation.spec.ts`

---

### TC-044: Page Load Performance
**Priority:** Medium  
**Objective:** Verify pages load within acceptable time

**Steps:**
1. Clear cache
2. Navigate to each main page
3. Measure load time

**Expected Results:**
- Homepage loads < 5 seconds
- Dashboard loads < 5 seconds  
- Profile loads < 5 seconds
- Game creation loads < 5 seconds
- No timeout errors

**Automation Status:** ✅ Automated in `navigation.spec.ts`

---

### TC-045: Internal Links Validation
**Priority:** Medium  
**Objective:** Verify internal links are not broken

**Steps:**
1. Navigate to dashboard
2. Check all internal links
3. Click each link

**Expected Results:**
- Links have valid href attributes
- Links navigate correctly
- No broken links
- External links open in new tab (if applicable)

**Automation Status:** ✅ Automated in `navigation.spec.ts`

---

### TC-046: Console Error Monitoring
**Priority:** High  
**Objective:** Verify minimal console errors/warnings

**Steps:**
1. Open console
2. Navigate through main user flows
3. Monitor console output

**Expected Results:**
- No critical errors
- Warnings are documented/expected
- No failed network requests (except expected)
- Clean console on main paths

**Automation Status:** ✅ Automated in `navigation.spec.ts`

---

### TC-047: Rapid Navigation Handling
**Priority:** Medium  
**Objective:** Verify app handles rapid clicks

**Steps:**
1. Rapidly click between pages
2. Switch pages quickly multiple times

**Expected Results:**
- App remains stable
- No race conditions
- Navigation completes
- No JavaScript errors

**Automation Status:** ✅ Automated in `navigation.spec.ts`

---

### TC-048: Responsive Design - Multiple Viewports
**Priority:** High  
**Objective:** Verify app works on different screen sizes

**Steps:**
1. Test at mobile width (375px)
2. Test at tablet width (768px)
3. Test at desktop width (1920px)
4. Test on each major page

**Expected Results:**
- Layout adapts to viewport
- All features accessible
- No horizontal scroll (mobile)
- Text is readable
- Touch targets are appropriate size (mobile)

**Automation Status:** ✅ Automated in `navigation.spec.ts`

---

## Test Execution Guidelines

### Test Execution Order
Execute tests in this order:
1. Homepage / Login tests (TC-001 to TC-007)
2. Dashboard tests (TC-008 to TC-017)
3. Profile tests (TC-018 to TC-026)
4. Game creation tests (TC-027 to TC-038)
5. Navigation tests (TC-039 to TC-048)

### Pass/Fail Criteria
- **Pass**: All expected results are met
- **Fail**: Any expected result is not met
- **Blocked**: Cannot execute due to dependency failure
- **Skip**: Not applicable in current environment

### Reporting
For each test, record:
- Test case ID
- Pass/Fail/Blocked/Skip status
- Browser and version
- Date and tester
- Screenshots for failures
- Steps to reproduce failures

### Critical Path Tests
These tests MUST pass before release:
- TC-001, TC-002, TC-008, TC-027, TC-039, TC-041

---

## Automation Mapping

All 48 manual test cases have been automated in the Playwright test suite:
- `e2e/tests/homepage.spec.ts` - TC-001 to TC-007
- `e2e/tests/dashboard.spec.ts` - TC-008 to TC-017
- `e2e/tests/profile.spec.ts` - TC-018 to TC-026
- `e2e/tests/game-creation.spec.ts` - TC-027 to TC-038
- `e2e/tests/navigation.spec.ts` - TC-039 to TC-048

Run automated tests: `npm run test:e2e`

---

## Notes

- These test cases focus on UI smoke testing, not exhaustive functional testing
- Additional test cases for game play, chat, social features, etc. should be documented separately
- Test cases should be updated as features are added or modified
- Priority levels: Critical > High > Medium > Low
