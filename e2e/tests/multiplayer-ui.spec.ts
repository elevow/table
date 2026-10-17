import { test, expect, BrowserContext, Page } from '@playwright/test';
import {
  TestPlayer,
  loginAll,
  logoutAll,
  setUpTable,
  clearTable,
  byId,
  configuredCredentials,
} from '../helpers/players';

/**
 * Six browsers, one per test account, sit at the same table. As each player acts in the UI,
 * the "Your Turn" panel must move to the next player's browser and leave everyone else's.
 * This is the scenario behind the old "not player's turn" polling bug.
 */

test.describe('Six players in six browsers', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let players: TestPlayer[] = [];
  let contexts: BrowserContext[] = [];
  const pages = new Map<string, Page>();
  let tableId: string | undefined;

  test.beforeAll(async () => {
    test.skip(configuredCredentials().length < 6, 'Needs TEST_USER1_* … TEST_USER6_* credentials');
    players = await loginAll();
  });

  test.afterAll(async () => {
    for (const c of contexts) await c.close();
    await clearTable(tableId, players);
    await logoutAll(players);
  });

  // On a protected Vercel deployment, the first load sets a bypass cookie for that site only.
  // A header would also go to third parties such as Supabase realtime.
  const withBypass = (path: string) => {
    const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    return secret ? `${path}?x-vercel-protection-bypass=${encodeURIComponent(secret)}&x-vercel-set-bypass-cookie=true` : path;
  };

  const yourTurn = (page: Page) => page.getByRole('heading', { name: 'Your Turn' });

  test('the turn passes from browser to browser around a full preflop orbit', async ({ browser }) => {
    const setup = await setUpTable(players, { buyIn: 1000, smallBlind: 5, bigBlind: 10 });
    tableId = setup.tableId;

    for (const p of players) {
      const context = await browser.newContext();
      await context.addInitScript(token => {
        try { window.localStorage.setItem('auth_token', token); } catch { /* storage blocked */ }
      }, p.token);
      contexts.push(context);
      const page = await context.newPage();
      await page.goto(withBypass(`/game/${tableId}`));
      pages.set(p.id, page);
    }

    const turnErrors: string[] = [];
    for (const [id, page] of pages) {
      page.on('response', async res => {
        if (res.url().includes('/api/games/action') && res.status() >= 400) {
          turnErrors.push(`${byId(players, id).username}: ${res.status()} ${await res.text().catch(() => '')}`);
        }
      });
    }

    // Six actions: four limps, the small blind completes, the big blind checks
    for (let i = 0; i < 6; i++) {
      const state = await players[0].state(tableId);
      expect(state.stage, `action ${i + 1}`).toBe('preflop');
      const active = byId(players, state.activePlayer);
      const activePage = pages.get(active.id)!;

      await expect(yourTurn(activePage), `${active.username} should see their turn`).toBeVisible({ timeout: 20_000 });
      for (const [id, page] of pages) {
        if (id !== active.id) await expect(yourTurn(page), `${byId(players, id).username} sees someone else's turn`).toHaveCount(0);
      }

      await activePage.getByRole('button', { name: /^(Check|Call)\b/ }).click();

      // The server has moved on before the next round of checks
      await expect.poll(async () => (await players[0].state(tableId!)).turnSeq, { timeout: 15_000 }).toBeGreaterThan(state.turnSeq ?? 0);
      await expect(yourTurn(activePage), `${active.username}'s turn panel should close`).toHaveCount(0, { timeout: 15_000 });
    }

    const after = await players[0].state(tableId);
    expect(after.stage).toBe('flop');
    expect(after.communityCards).toHaveLength(3);
    expect(after.pot).toBe(60);
    expect(turnErrors, 'action requests refused while playing in turn').toEqual([]);
  });
});
