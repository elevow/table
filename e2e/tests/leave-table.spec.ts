import { test, expect } from '@playwright/test';
import { TestPlayer, deleteTables, hasTestUser, loginAs, logoutAll, seatPlayers, signedInPage } from '../helpers/players';

/**
 * The Leave button at the table: gives up the seat, then goes back to the lobby without reloading
 * the app. Needs TEST_USER2 (a host). The table, named "E2E leave …", is deleted afterwards when
 * an admin is configured, and otherwise left behind empty.
 */

test.describe('Leaving a table', () => {
  test.skip(!hasTestUser(2), 'Needs TEST_USER2');

  let host: TestPlayer;
  let tableId: string | undefined;

  test.beforeAll(async () => {
    host = await loginAs(2);
  });

  test.afterAll(async () => {
    await deleteTables([tableId], [host]);
    await logoutAll([host]);
  });

  test('Leave gives up the seat and goes to the lobby without a full reload', async ({ browser }) => {
    tableId = await host.createRoom({ name: `E2E leave ${new Date().toISOString()}`, maxPlayers: 2 });
    await seatPlayers(tableId, [host]);

    const page = await signedInPage(browser, host);
    try {
      await page.goto(`/game/${tableId}`);
      // Leave only gives up a seat once the page knows it's theirs
      await expect(page.getByRole('button', { name: 'Stand up from seat' })).toBeVisible({ timeout: 30_000 });
      const leave = page.getByRole('button', { name: 'Leave game' });

      // Gone if the page reloads
      await page.evaluate(() => { (window as any).__sameApp = true; });
      page.once('dialog', dialog => dialog.accept());
      await leave.click();

      await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
      expect(await page.evaluate(() => (window as any).__sameApp)).toBe(true);

      const res = await host.get(`/api/games/seats/state?tableId=${encodeURIComponent(tableId)}`);
      const seats = (await res.json()).seats ?? {};
      expect(Object.values(seats).filter(Boolean), 'seats still taken').toEqual([]);
    } finally {
      await page.context().close();
    }
  });
});
