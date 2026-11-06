import { test, expect, APIResponse } from '@playwright/test';
import { TestPlayer, deleteTables, hasTestUser, loginAs, logoutAll, signedInPage } from '../helpers/players';

/**
 * Roles and permissions against the real API, with the test accounts set up as:
 *   TEST_USER1  Player only (players can't create rooms)
 *   TEST_USER2  Host
 *   TEST_USER3  Host + Tournament Director
 *   TEST_USER4  Host + Tournament Director + Moderator
 *
 * Wherever possible a request is one the route refuses after its permission check (a missing
 * field, suspending yourself), so allowed and denied are told apart by 400 vs 403 and nothing
 * changes. The only data left behind is one private table named "E2E permissions …", and
 * not even that when a TEST_ADMIN_* account is configured to delete it.
 */

const ROLE_KEYS = ['host', 'tournament_director', 'moderator'] as const;
const EXPECTED_ROLES: Record<number, string[]> = {
  1: [],
  2: ['host'],
  3: ['host', 'tournament_director'],
  4: ['host', 'tournament_director', 'moderator'],
};
const USERS = [1, 2, 3, 4];

test.describe('Roles and permissions', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!USERS.every(hasTestUser), 'Needs TEST_USER1_* to TEST_USER4_* in .env.local');

  const users: Record<number, TestPlayer> = {};

  test.beforeAll(async () => {
    for (const n of USERS) users[n] = await loginAs(n);
  });

  test.afterAll(async () => {
    await logoutAll(Object.values(users));
  });

  async function body(res: APIResponse): Promise<any> {
    try { return await res.json(); } catch { return {}; }
  }

  /** Sends the same request as each user and checks who is let through. */
  async function expectAllowed(
    send: (u: TestPlayer) => Promise<APIResponse>,
    allowed: number[],
    allowedStatus: number,
    what: string,
  ) {
    for (const n of USERS) {
      const res = await send(users[n]);
      const expected = allowed.includes(n) ? allowedStatus : 403;
      expect(res.status(), `TEST_USER${n} ${what}: ${JSON.stringify(await body(res))}`).toBe(expected);
    }
  }

  test('each account has the roles it was given, and no others', async () => {
    for (const n of USERS) {
      const res = await users[n].get('/api/auth/check-admin');
      expect(res.status()).toBe(200);
      const me = await res.json();
      // Every signed-in user also has the implicit player role
      expect(me.roles, `TEST_USER${n} roles`).toContain('player');
      const extra = (me.roles as string[]).filter(r => (ROLE_KEYS as readonly string[]).includes(r)).sort();
      expect(extra, `TEST_USER${n} roles`).toEqual([...EXPECTED_ROLES[n]].sort());
      // ADMIN_EMAILS accounts get every permission, which would make the rest of this file meaningless
      expect(me.roles, `TEST_USER${n} must not be in ADMIN_EMAILS`).not.toContain('super_admin');
    }
  });

  test.describe('Host', () => {
    test('players can\'t create rooms', async () => {
      // Hosts creating a room is covered by the private table below; no extra rooms are made here
      const res = await users[1].post('/api/games/rooms/create', { name: 'E2E permissions (should be refused)', gameType: 'poker' });
      expect(res.status()).toBe(403);
      expect((await res.json()).permission).toBe('room.create');
      for (const n of USERS) {
        const me = await (await users[n].get('/api/auth/check-admin')).json();
        expect(me.permissions.includes('room.create'), `TEST_USER${n} room.create`).toBe(n >= 2);
      }
    });

    test('only hosts see Create Room on the dashboard', async ({ browser }) => {
      for (const n of [1, 2]) {
        const page = await signedInPage(browser, users[n]);
        await page.goto('/dashboard');
        await expect(page.getByRole('button', { name: 'Tournaments' })).toBeVisible({ timeout: 30_000 });
        const create = page.getByRole('button', { name: /create a table/i });
        if (n === 1) await expect(create, 'TEST_USER1').toHaveCount(0);
        else await expect(create.first(), 'TEST_USER2').toBeVisible();
        await page.context().close();
      }
    });

    test('only hosts see Create a table on the profile page', async ({ browser }) => {
      for (const n of [1, 2]) {
        const page = await signedInPage(browser, users[n]);
        await page.goto('/profile');
        await expect(page.getByRole('button', { name: 'Back to the lobby' })).toBeVisible({ timeout: 30_000 });
        const create = page.getByRole('button', { name: 'Create a table' });
        if (n === 1) await expect(create, 'TEST_USER1').toHaveCount(0);
        else await expect(create, 'TEST_USER2').toBeVisible();
        // There's no join page; joining is by room code or invite link from the dashboard
        await expect(page.getByRole('button', { name: 'Join Game' })).toHaveCount(0);
        await page.context().close();
      }
    });

    test('players who open the create page directly are turned away', async ({ browser }) => {
      for (const n of [1, 2]) {
        const page = await signedInPage(browser, users[n]);
        await page.goto('/game/create');
        await expect(page.getByRole('heading', { name: 'Create a table' })).toBeVisible({ timeout: 30_000 });
        const notice = page.getByText('Your account can\'t create rooms');
        const form = page.getByText('Who can join');
        if (n === 1) {
          await expect(notice, 'TEST_USER1').toBeVisible();
          await expect(form, 'TEST_USER1').toHaveCount(0);
        } else {
          // The form shows before permissions load, so wait for the notice to have had its chance
          await page.waitForLoadState('networkidle');
          await expect(form, 'TEST_USER2').toBeVisible();
          await expect(notice, 'TEST_USER2').toHaveCount(0);
        }
        await page.context().close();
      }
    });

    test('hosts can correct the ledger; players can\'t', async () => {
      for (const n of USERS) {
        const me = await (await users[n].get('/api/auth/check-admin')).json();
        expect(me.permissions.includes('room.edit_ledger'), `TEST_USER${n} room.edit_ledger`).toBe(n >= 2);
      }
    });

    test('hosts have no daily room limit; players have one', async () => {
      for (const n of USERS) {
        const me = await (await users[n].get('/api/auth/check-admin')).json();
        if (n === 1) expect(me.limits['rooms.per_day'], 'TEST_USER1 rooms.per_day').toEqual(expect.any(Number));
        else expect(me.limits['rooms.per_day'], `TEST_USER${n} rooms.per_day`).toBeNull();
      }
    });
  });

  test.describe('Tournament Director', () => {
    // An empty body fails validation after the permission check: 400 means allowed
    test('only tournament directors can create tournaments', async () => {
      await expectAllowed(u => u.post('/api/tournaments/create', {}), [3, 4], 400, 'create tournament');
    });

    test('only tournament directors can run tournaments', async () => {
      await expectAllowed(u => u.post('/api/tournaments/start', {}), [3, 4], 400, 'start tournament');
      await expectAllowed(u => u.post('/api/tournaments/pause', {}), [3, 4], 400, 'pause tournament');
      await expectAllowed(u => u.post('/api/tournaments/advance-level', {}), [3, 4], 400, 'advance level');
    });

    test('only tournament directors can eliminate players', async () => {
      await expectAllowed(u => u.post('/api/tournaments/eliminate', {}), [3, 4], 400, 'eliminate player');
    });
  });

  test.describe('Moderator', () => {
    test('only moderators can look up users', async () => {
      await expectAllowed(u => u.get('/api/admin/users?q=e2e-no-such-user'), [4], 200, 'search users');
      await expectAllowed(u => u.get('/api/admin/roles'), [4], 200, 'list roles');
    });

    test('only moderators can see rooms and security alerts', async () => {
      await expectAllowed(u => u.get('/api/admin/rooms'), [4], 200, 'list all rooms');
      await expectAllowed(u => u.get('/api/admin/alerts'), [4], 200, 'list alerts');
    });

    test('moderators can suspend but not ban, and nobody else can do either', async () => {
      // Each user targets themselves: a moderator gets past the permission check and is
      // refused with 400 "You can't ban or suspend yourself", so nobody is suspended
      const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await expectAllowed(
        u => u.post(`/api/admin/users/${u.id}/sanction`, { kind: 'suspend', until, reason: 'e2e permission check' }),
        [4], 400, 'suspend',
      );
      await expectAllowed(
        u => u.post(`/api/admin/users/${u.id}/sanction`, { kind: 'ban', reason: 'e2e permission check' }),
        [], 400, 'ban',
      );
    });

    test('moderators can\'t edit roles or read the audit log', async () => {
      await expectAllowed(u => u.post('/api/admin/roles', {}), [], 400, 'create role');
      await expectAllowed(u => u.get('/api/admin/audit-log'), [], 200, 'audit log');
    });

    // Hosted by TEST_USER2. TEST_USER3 is also a host, but not of this table and not a member
    test.describe('at a private table', () => {
      let roomId: string;

      test.beforeAll(async () => {
        const res = await users[2].post('/api/games/rooms/create', {
          name: `E2E permissions ${new Date().toISOString()}`,
          gameType: 'poker',
          maxPlayers: 6,
          blindLevels: { sb: 5, bb: 10 },
          visibility: 'private',
          configuration: { variant: 'texas-holdem', bettingMode: 'no-limit', numberOfRebuys: 0, buyIn: 1000 },
        });
        expect(res.status(), `create private room: ${JSON.stringify(await body(res))}`).toBe(201);
        roomId = (await res.json()).id;
      });

      test.afterAll(async () => {
        await deleteTables([roomId]);
      });

      test('only the host and moderators can open it without the invite link', async () => {
        for (const n of USERS) {
          const res = await users[n].get(`/api/games/rooms/${roomId}`);
          const expected = n === 2 || n === 4 ? 200 : 403;
          expect(res.status(), `TEST_USER${n} open private room`).toBe(expected);
          if (expected === 403) expect((await res.json()).code).toBe('PRIVATE_TABLE');
        }
      });

      test('it doesn\'t appear in anyone else\'s lobby', async () => {
        for (const n of [1, 3, 4]) {
          const lobby = await (await users[n].get('/api/games/rooms/lobby')).json();
          const ids = [...(lobby.open || []), ...(lobby.mine || [])].map((t: { id: string }) => t.id);
          expect(ids, `TEST_USER${n} lobby`).not.toContain(roomId);
        }
      });

      test('only moderators can delete someone else\'s chat message', async () => {
        const sent = await users[2].post('/api/chat/send', { roomId, message: 'e2e permission check' });
        expect(sent.status(), `send chat: ${JSON.stringify(await body(sent))}`).toBe(201);
        const messageId = (await sent.json()).id;

        for (const n of [1, 3]) {
          const res = await users[n].post('/api/chat/delete', { messageId });
          expect(res.status(), `TEST_USER${n} delete another player's message`).toBe(403);
        }
        const res = await users[4].post('/api/chat/delete', { messageId });
        expect(res.status(), `moderator delete: ${JSON.stringify(await body(res))}`).toBe(200);
      });

      test('non-members can\'t chat there, even other hosts', async () => {
        for (const n of [1, 3]) {
          const res = await users[n].post('/api/chat/send', { roomId, message: 'e2e permission check' });
          expect(res.status(), `TEST_USER${n} chat`).toBe(403);
          expect((await res.json()).code).toBe('PRIVATE_TABLE');
        }
      });
    });
  });

  test.describe('in the browser', () => {
    test('only moderators see the Roles & permissions link on the dashboard', async ({ browser }) => {
      for (const n of USERS) {
        const page = await signedInPage(browser, users[n]);
        await page.goto('/dashboard');
        // Wait for the dashboard's own links, so a missing admin link isn't just a slow load
        await expect(page.getByRole('button', { name: 'Tournaments' })).toBeVisible({ timeout: 30_000 });
        const link = page.getByRole('button', { name: 'Roles & permissions' });
        if (n === 4) await expect(link, `TEST_USER${n}`).toBeVisible();
        else await expect(link, `TEST_USER${n}`).toHaveCount(0);
        await page.context().close();
      }
    });

    test('a moderator can find users with * on the admin page, without the audit log', async ({ browser }) => {
      const page = await signedInPage(browser, users[4]);
      await page.goto('/admin/roles');
      await expect(page.getByRole('tab', { name: 'Users' })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('tab', { name: 'Audit log' })).toHaveCount(0);

      await page.getByRole('tab', { name: 'Users' }).click();
      await page.getByLabel('Search by email or username').fill('*');
      await page.getByRole('button', { name: 'Search' }).click();
      // Every test account exists, so * finds at least four users
      await expect(page.getByText(/result/)).toBeVisible();
      await expect.poll(async () => page.locator('ul li').count()).toBeGreaterThanOrEqual(USERS.length);
      await page.context().close();
    });

    test('a host without a moderator role is turned away from the admin page', async ({ browser }) => {
      const page = await signedInPage(browser, users[3]);
      await page.goto('/admin/roles');
      await expect(page.getByText(/permission/i).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByLabel('Search by email or username')).toHaveCount(0);
      await page.context().close();
    });
  });
});
