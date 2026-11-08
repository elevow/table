import { test, expect, Page, request } from '@playwright/test';
import {
  GameState, TestPlayer, bypassHeaders, deleteTables, hasTestUser, loginAs, logoutAll, playHand, seatPlayers, signedInPage,
} from '../helpers/players';

/**
 * Guards against two production problems fixed in November 2026:
 *
 * 1. Routes that trusted the caller about who they were. The unused ones were removed and must
 *    stay gone; the friends routes must turn away anyone not signed in. These checks need no test
 *    accounts, so they also run in CI.
 * 2. Browser polling that ran up Vercel's request, invocation and CPU limits: the turn check fired
 *    on every render instead of every 10s, and every poll kept going in hidden or idle tabs.
 *    These drive a real table, so they need TEST_USER1 (player) and TEST_USER2 (host). The table,
 *    named "E2E polling …", is deleted afterwards when a TEST_ADMIN_* account is configured, and
 *    otherwise left behind empty.
 */

const POLLED_ROUTES = ['/api/games/check-turn', '/api/games/seats/state', '/api/games/table-extras', '/api/games/rooms/lobby'];

test.describe('Removed and signed-in-only routes', () => {
  async function anonymous() {
    return request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
      extraHTTPHeaders: bypassHeaders(),
    });
  }

  test('routes that trusted the caller\'s claimed identity are gone', async () => {
    const api = await anonymous();
    try {
      const calls = [
        api.get('/api/profile?userId=someone'),
        api.put('/api/profile', { data: { userId: 'someone', email: 'attacker@example.com' } }),
        api.get('/api/sessions?userId=someone'),
        api.post('/api/sessions', { data: { userId: 'someone' } }),
        api.post('/api/social/share', { data: { userId: 'someone' } }),
        api.post('/api/social/engagement', { data: { userId: 'someone' } }),
      ];
      const labels = ['GET /api/profile', 'PUT /api/profile', 'GET /api/sessions', 'POST /api/sessions',
        'POST /api/social/share', 'POST /api/social/engagement'];
      const responses = await Promise.all(calls);
      responses.forEach((res, i) => expect(res.status(), labels[i]).toBe(404));
    } finally {
      await api.dispose();
    }
  });

  test('the database diagnostics route is gone', async () => {
    const api = await anonymous();
    try {
      expect((await api.get('/api/health/db')).status()).toBe(404);
    } finally {
      await api.dispose();
    }
  });

  test('the lobby loads', async () => {
    const api = await anonymous();
    try {
      expect((await api.get('/api/games/rooms/lobby')).status()).toBe(200);
    } finally {
      await api.dispose();
    }
  });

  test('friends routes turn away signed-out callers', async () => {
    const api = await anonymous();
    try {
      const responses = await Promise.all([
        api.get('/api/friends/status?a=u1&b=u2'),
        api.get('/api/friends/invites?userId=u1'),
        api.post('/api/friends/invite', { data: { inviterId: 'u1', inviteeId: 'u2', roomId: 'r1' } }),
        api.post('/api/friends/invite-respond', { data: { id: 'i1', action: 'accept' } }),
      ]);
      const labels = ['GET status', 'GET invites', 'POST invite', 'POST invite-respond'];
      responses.forEach((res, i) => expect(res.status(), labels[i]).toBe(401));
    } finally {
      await api.dispose();
    }
  });
});

/** Records the API requests a page makes, by path. */
function recordApiRequests(page: Page) {
  const seen: { path: string; at: number }[] = [];
  page.on('request', req => {
    const path = new URL(req.url()).pathname;
    if (path.startsWith('/api/')) seen.push({ path, at: Date.now() });
  });
  return {
    since: (at: number, paths: string[] = POLLED_ROUTES) => seen.filter(r => r.at >= at && paths.includes(r.path)),
    count: (path: string, since = 0) => seen.filter(r => r.at >= since && r.path === path).length,
  };
}

/** Makes the page believe its tab was hidden or shown, as switching tabs would. */
async function setTabHidden(page: Page, hidden: boolean) {
  await page.evaluate(h => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test.describe('Browser polling stays within budget', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!hasTestUser(1) || !hasTestUser(2), 'Needs TEST_USER1_* and TEST_USER2_* in .env.local');

  let host: TestPlayer;   // seat 1
  let player: TestPlayer; // seat 2
  let tableId: string | undefined;

  test.beforeAll(async () => {
    host = await loginAs(2);
    player = await loginAs(1);
  });

  test.afterAll(async () => {
    await deleteTables([tableId], [host, player].filter(Boolean));
    await logoutAll([host, player].filter(Boolean));
  });

  /**
   * The shared heads-up table (host in seat 1, player in seat 2) with a fresh hand dealt, so each
   * test starts with a full turn clock. The first call creates the table; later ones finish the
   * hand in progress and deal the next.
   */
  async function freshHand(): Promise<{ tableId: string; state: GameState }> {
    if (!tableId) {
      tableId = await host.createRoom({ name: `E2E polling ${new Date().toISOString()}`, maxPlayers: 2 });
      await seatPlayers(tableId, [host, player]);
      const res = await host.start(tableId);
      expect(res.status(), 'start').toBe(201);
    } else {
      const current = await host.state(tableId);
      if (current.stage !== 'showdown') await playHand(tableId, [host, player]);
      const res = await host.nextHand(tableId);
      expect(res.status(), 'next hand').toBe(200);
    }
    const state = await host.state(tableId);
    expect(state.stage, 'a new hand is dealt').not.toBe('showdown');
    return { tableId, state };
  }

  test('a waiting player checks the turn about every 10s, not on every render', async ({ browser }) => {
    test.setTimeout(120_000);
    const { tableId, state } = await freshHand();
    // The player not to act watches the table; the 30s turn clock re-renders it 4 times a second
    const waiting = state.activePlayer === host.id ? player : host;
    const page = await signedInPage(browser, waiting);
    try {
      const log = recordApiRequests(page);
      await page.goto(`/game/${tableId}`);
      await page.waitForRequest(r => r.url().includes('/api/games/check-turn'), { timeout: 45_000 });
      const from = Date.now();
      await page.waitForTimeout(25_000);
      const checks = log.count('/api/games/check-turn', from);
      // 10s interval: 2-3 in 25s. The old bug made dozens.
      expect(checks, 'turn checks in 25s').toBeGreaterThanOrEqual(1);
      expect(checks, 'turn checks in 25s').toBeLessThanOrEqual(4);
    } finally {
      await page.context().close();
    }
  });

  test('a hidden tab stops polling, and refreshes when shown again', async ({ browser }) => {
    test.setTimeout(120_000);
    const { tableId, state } = await freshHand();
    const waiting = state.activePlayer === host.id ? player : host;
    const page = await signedInPage(browser, waiting);
    try {
      const log = recordApiRequests(page);
      await page.goto(`/game/${tableId}`);
      await page.waitForRequest(r => r.url().includes('/api/games/check-turn'), { timeout: 45_000 });
      // Let any request already under way finish before hiding
      await page.waitForTimeout(1_000);

      await setTabHidden(page, true);
      const hiddenAt = Date.now();
      await page.waitForTimeout(25_000);
      expect(log.since(hiddenAt).map(r => r.path), 'polls while hidden').toEqual([]);

      const shown = page.waitForRequest(r => r.url().includes('/api/games/check-turn'), { timeout: 5_000 });
      await setTabHidden(page, false);
      await shown;
    } finally {
      await page.context().close();
    }
  });

  test('after a showdown only the lowest seat asks for the next hand', async ({ browser }) => {
    test.setTimeout(120_000);
    const { tableId } = await freshHand();
    const hostPage = await signedInPage(browser, host);
    const playerPage = await signedInPage(browser, player);
    try {
      const hostLog = recordApiRequests(hostPage);
      const playerLog = recordApiRequests(playerPage);
      await Promise.all([hostPage.goto(`/game/${tableId}`), playerPage.goto(`/game/${tableId}`)]);
      await Promise.all([
        hostPage.waitForRequest(r => r.url().includes('/api/games/'), { timeout: 45_000 }),
        playerPage.waitForRequest(r => r.url().includes('/api/games/'), { timeout: 45_000 }),
      ]);

      const { final } = await playHand(tableId, [host, player]);
      expect(final.stage).toBe('showdown');
      const showdownAt = Date.now();

      // The leader asks within about 5s of seeing the showdown (live update or the next turn check)
      await hostPage.waitForRequest(r => r.url().includes('/api/games/next-hand'), { timeout: 30_000 });
      expect(playerLog.count('/api/games/next-hand', showdownAt), 'seat 2 waits for seat 1').toBe(0);
      expect(hostLog.count('/api/games/next-hand', showdownAt)).toBeGreaterThanOrEqual(1);

      // And that request moved the table on
      await expect.poll(async () => (await host.state(tableId)).stage, { timeout: 15_000 }).not.toBe('showdown');
    } finally {
      await hostPage.context().close();
      await playerPage.context().close();
    }
  });

  test('the lobby stops polling after 10 idle minutes and resumes on activity', async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await signedInPage(browser, player);
    try {
      // A fake clock lets ten minutes pass in a moment; requests still go to the real server
      await page.clock.install();
      const log = recordApiRequests(page);
      await page.goto('/dashboard');
      await expect.poll(() => log.count('/api/games/rooms/lobby'), { timeout: 45_000 }).toBeGreaterThanOrEqual(1);

      const beforeActive = log.count('/api/games/rooms/lobby');
      await page.clock.runFor(16_000);
      await expect.poll(() => log.count('/api/games/rooms/lobby'), { message: 'polls while active' })
        .toBeGreaterThan(beforeActive);

      // Nobody touches the page for over ten minutes
      await page.clock.runFor(11 * 60_000);
      await page.waitForTimeout(1_000);
      const idleFrom = log.count('/api/games/rooms/lobby');
      await page.clock.runFor(5 * 60_000);
      await page.waitForTimeout(1_000);
      expect(log.count('/api/games/rooms/lobby'), 'polls while idle').toBe(idleFrom);

      await page.mouse.move(200, 200);
      await page.mouse.move(220, 240);
      await expect.poll(() => log.count('/api/games/rooms/lobby'), { message: 'refresh on activity', timeout: 5_000 })
        .toBeGreaterThan(idleFrom);
    } finally {
      await page.context().close();
    }
  });
});
