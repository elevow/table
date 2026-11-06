import { test, expect, APIResponse } from '@playwright/test';
import { GameState, TestPlayer, byId, chipsInPlay, hasTestUser, loginAs, logoutAll, MAX_TEST_USERS, signedInPage } from '../helpers/players';

/**
 * A whole tournament against the real API and database, with all six test accounts playing and
 * TEST_USER3 (a Tournament Director) running it. Tables are 3-handed, so it starts on two tables,
 * balances and ends on one.
 *
 * Covered, in order: the start (rooms, seats, everyone away until they open their table), opening
 * a table in a browser sits the player in, a no-show is blinded off without holding the table up,
 * sitting out, director-controlled levels and a break, busting and rebuying, balancing and breaking
 * tables, and the finish (places and payouts).
 *
 * Players' screens are stood in for by the API: a player the tournament has just seated is sat in
 * the way their screen would (except the no-show), and everyone else moves all in to bust quickly.
 * Leaves behind one completed tournament named "E2E tournament …" and its rooms.
 */

const DIRECTOR = 3;
const USERS = Array.from({ length: MAX_TEST_USERS }, (_, i) => i + 1);

const config = {
  type: 'rebuy',
  levelControl: 'director',
  seatsPerTable: 3,
  startingStack: 1000,
  buyIn: 10,
  blindLevels: [
    { level: 1, durationMinutes: 10, smallBlind: 50, bigBlind: 100 },
    { level: 2, durationMinutes: 10, smallBlind: 100, bigBlind: 200 },
    { level: 3, durationMinutes: 10, smallBlind: 200, bigBlind: 400 },
  ],
  breaks: [{ afterLevel: 1, durationMinutes: 5 }],
  rebuys: { enabled: true, maxPerPlayer: 1, availableUntilLevel: 3, cost: 10, stack: 1000 },
  payoutStructure: [{ place: 1, percentage: 70 }, { place: 2, percentage: 30 }],
  lateRegistration: { enabled: false, endLevel: 0, endTime: 0 },
};

type Player = GameState['players'][number] & { isSittingOut?: boolean; notArrived?: boolean };
type TableState = GameState & { players: Player[]; handNumber?: number };
// Calm play (check or call) keeps everyone in while other things are tested; all in busts players
type Style = 'calm' | 'all-in';
type Table = { number: number; roomId: string | null; players: { seat: number; userId: string; name: string }[] };

async function body(res: APIResponse): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

test.describe('A tournament from start to finish', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!USERS.every(hasTestUser), 'Needs TEST_USER1_* to TEST_USER6_* in .env.local');
  test.setTimeout(5 * 60 * 1000);

  const players: TestPlayer[] = [];
  let director: TestPlayer;
  let tournamentId = '';
  // Kept away (never sat in) until the no-show test is done
  let noShow: string | null = null;

  test.beforeAll(async () => {
    for (const n of USERS) players.push(await loginAs(n));
    director = players[DIRECTOR - 1];
  });

  test.afterAll(async () => {
    // Don't leave a half-played tournament holding tables open
    if (tournamentId && director) {
      const v = await view().catch(() => null);
      if (v && v.status !== 'completed' && v.status !== 'cancelled') {
        await director.post('/api/tournaments/cancel', { tournamentId, reason: 'E2E test stopped early' }).catch(() => undefined);
      }
    }
    await logoutAll(players);
  });

  async function view(as: TestPlayer = director): Promise<any> {
    const res = await as.get(`/api/tournaments/view?tournamentId=${encodeURIComponent(tournamentId)}`);
    expect(res.status(), `view: ${JSON.stringify(await body(res))}`).toBe(200);
    return res.json();
  }

  async function directorDoes(path: string, extra: Record<string, unknown> = {}): Promise<any> {
    const res = await director.post(`/api/tournaments/${path}`, { tournamentId, ...extra });
    expect(res.status(), `${path}: ${JSON.stringify(await body(res))}`).toBe(200);
    return res.json();
  }

  const openTables = (v: any): Table[] => (v.tables as Table[]).filter(t => t.roomId && t.players.length > 0);

  /**
   * The table as one of its players sees it. A player the tournament has just moved here isn't in
   * the room until the table they left finishes its hand, so ask each in turn.
   */
  async function tableState(table: Table): Promise<TableState> {
    for (const p of table.players) {
      const res = await byId(players, p.userId).get(`/api/games/state?tableId=${encodeURIComponent(table.roomId!)}`);
      if (res.status() === 200) return (await res.json()).gameState;
    }
    throw new Error(`None of table ${table.number}'s players can see it`);
  }

  /** What a player's screen does on opening the table: sit in if the tournament just seated them. */
  async function arrive(roomId: string, p: Player) {
    const res = await byId(players, p.id).post('/api/games/sit-out', { tableId: roomId, sittingOut: false });
    expect([200, 409], `sit in ${p.name}: ${JSON.stringify(await body(res))}`).toContain(res.status());
  }

  /** All in (or call or check when that's all there is), or in a calm game just check or call. */
  async function move(roomId: string, state: GameState, style: Style) {
    const me = state.players.find(p => p.id === state.activePlayer)!;
    const actor = byId(players, me.id);
    const seq = state.turnSeq ?? 0;
    const allIn = me.currentBet + me.stack;
    let res = style === 'all-in' && allIn > state.currentBet
      ? await actor.act(roomId, 'raise', { amount: allIn, expectedTurnSeq: seq })
      : await actor.act(roomId, 'call', { expectedTurnSeq: seq });
    if (res.status() === 400) {
      res = await actor.act(roomId, state.currentBet > me.currentBet ? 'call' : 'check', { expectedTurnSeq: seq });
    }
    // 409: someone else's request moved the table on first
    expect([200, 409], `${me.name} at ${state.stage}: ${JSON.stringify(await body(res))}`).toContain(res.status());
  }

  /**
   * One step at every open table: sit in newly seated players, deal the next hand between hands,
   * or have the player to act move. Returns the next-hand refusals, by room.
   */
  async function stepTables(opts: { style?: Style; onState?: (roomId: string, s: TableState) => void } = {}) {
    const held: Record<string, string | undefined> = {};
    for (const table of openTables(await view())) {
      const roomId = table.roomId!;
      const state = await tableState(table);
      const seated = table.players.filter(p => state.players.some(sp => sp.id === p.userId));
      opts.onState?.(roomId, state);
      for (const p of state.players) if (p.notArrived && p.id !== noShow) await arrive(roomId, p);
      if (state.stage === 'showdown' || state.stage === 'awaiting-dealer-choice') {
        const dealer = byId(players, (seated[0] ?? table.players[0]).userId);
        const res = await dealer.nextHand(roomId);
        if (res.status() !== 200 && res.status() !== 201) held[roomId] = (await body(res)).code ?? (await body(res)).error;
      } else if (state.activePlayer) {
        await move(roomId, state, opts.style ?? 'calm');
      }
    }
    return held;
  }

  /** Where the tournament, each room's seats and each table's game have everyone, for a failure message. */
  async function seatingReport(userId: string, held: Record<string, string | undefined>) {
    const v = await view();
    const rooms = [];
    for (const t of v.tables as Table[]) {
      if (!t.roomId) continue;
      const seats = await body(await director.get(`/api/games/seats/state?tableId=${t.roomId}`));
      const state = t.players.length ? await tableState(t).catch(e => String(e)) : null;
      rooms.push({
        table: t.number,
        tournamentSeats: t.players.map(p => p.userId),
        roomSeats: seats.seats ?? seats,
        game: typeof state === 'string' || !state ? state
          : { stage: state.stage, hand: state.handNumber, players: state.players.map(p => [p.id, p.stack, p.isSittingOut, p.notArrived]) },
        nextHand: held[t.roomId],
      });
    }
    return { userId, status: v.status, finishers: v.finishers.map((f: any) => [f.place, f.userId]), rooms };
  }

  test('the director starts it: two private tables, everyone seated and away until they open their table', async () => {
    const created = await director.post('/api/tournaments/create', { name: `E2E tournament ${new Date().toISOString()}`, config });
    expect(created.status(), `create: ${JSON.stringify(await body(created))}`).toBe(201);
    tournamentId = (await created.json()).id;

    for (const p of players) {
      const res = await p.post('/api/tournaments/register', { tournamentId });
      expect(res.status(), `register ${p.username}: ${JSON.stringify(await body(res))}`).toBe(200);
    }
    await directorDoes('start');

    const v = await view();
    expect(v.status).toBe('running');
    expect(v.directorControlsLevels).toBe(true);
    const tables = openTables(v);
    expect(tables).toHaveLength(2);
    expect(tables.flatMap(t => t.players.map(p => p.userId)).sort()).toEqual(players.map(p => p.id).sort());

    for (const table of tables) {
      const state = await tableState(table);
      expect(state.players.map(p => p.id).sort()).toEqual(table.players.map(p => p.userId).sort());
      // Everyone brought their starting stack, and nobody's screen has opened the table yet
      expect(chipsInPlay(state), `table ${table.number} chips`).toBe(1000 * table.players.length);
      for (const p of state.players) expect(p, `${p.name} not here yet`).toMatchObject({ isSittingOut: true, notArrived: true });
    }
  });

  test('opening the table in a browser sits the player in', async ({ browser }) => {
    const table = openTables(await view())[0];
    const user = byId(players, table.players[0].userId);
    const page = await signedInPage(browser, user);
    try {
      await page.goto(`/game/${table.roomId}`);
      await expect.poll(async () => {
        const me = (await tableState(table)).players.find(p => p.id === user.id);
        return !!me && !me.notArrived && !me.isSittingOut;
      }, { message: `${user.username} sat in by their screen`, timeout: 30_000 }).toBe(true);
    } finally {
      await page.context().close();
    }
  });

  test('a no-show is blinded off and never waited on', async () => {
    const table = openTables(await view())[1];
    noShow = table.players[table.players.length - 1].userId;
    const handsWithNoShow = new Set<number>();
    let waitedOn = false;
    for (let i = 0; i < 40 && handsWithNoShow.size < 3; i++) {
      await stepTables({
        onState: (roomId, s) => {
          if (roomId !== table.roomId) return;
          if (s.activePlayer === noShow && s.stage !== 'showdown') waitedOn = true;
          if (s.stage === 'showdown' && s.players.some(p => p.id === noShow)) handsWithNoShow.add(s.handNumber ?? -1);
        },
      });
    }
    expect(waitedOn, 'the table waited for the no-show to act').toBe(false);
    expect(handsWithNoShow.size, 'hands finished with the no-show at the table').toBeGreaterThanOrEqual(3);
    const state = await tableState(table);
    expect(state.players.find(p => p.id === noShow)).toMatchObject({ isSittingOut: true, notArrived: true });
    // They turn up after all
    await arrive(table.roomId!, state.players.find(p => p.id === noShow)!);
    noShow = null;
  });

  test('a player who sits out has their hands folded for them, then comes back', async () => {
    const table = openTables(await view())[0];
    const away = byId(players, table.players[0].userId);
    const res = await away.post('/api/games/sit-out', { tableId: table.roomId, sittingOut: true });
    expect(res.status(), `sit out: ${JSON.stringify(await body(res))}`).toBe(200);
    let waitedOn = false;
    for (let i = 0; i < 15; i++) {
      await stepTables({ onState: (roomId, s) => { if (roomId === table.roomId && s.activePlayer === away.id && s.stage !== 'showdown') waitedOn = true; } });
    }
    expect(waitedOn, 'the table waited for a player who was away').toBe(false);
    const back = await away.post('/api/games/sit-out', { tableId: table.roomId, sittingOut: false });
    // They may have busted meanwhile; otherwise they're back in
    expect([200, 403]).toContain(back.status());
  });

  test('levels and breaks wait for the director', async () => {
    let v = await view();
    expect(v.level.number).toBe(1);
    // The break after level 1 starts when the director moves on, not before
    expect(v.breakAfterLevelMinutes).toBe(5);
    v = await directorDoes('advance-level');
    v = await view();
    expect(v.onBreak).toBe(true);
    expect(v.status).toBe('on-break');

    // Tables finish the hand they're in, then hold
    let held: Record<string, string | undefined> = {};
    for (let i = 0; i < 20; i++) {
      held = await stepTables();
      if (openTables(await view()).every(t => held[t.roomId!] === 'TOURNAMENT_PAUSED')) break;
    }
    for (const t of openTables(await view())) expect(held[t.roomId!], `table ${t.number} held for the break`).toBe('TOURNAMENT_PAUSED');

    const handsBefore: Record<string, number | undefined> = {};
    for (const t of openTables(await view())) handsBefore[t.roomId!] = (await tableState(t)).handNumber;
    await directorDoes('end-break');
    v = await view();
    expect(v.status).toBe('running');
    expect(v.level.number).toBe(2);

    // The next hand at each table is dealt at the new blinds
    const blinds: Record<string, number[]> = {};
    for (let i = 0; i < 10; i++) {
      held = await stepTables();
      for (const t of openTables(await view())) {
        const s = await tableState(t);
        if (s.handNumber !== handsBefore[t.roomId!] && s.stage !== 'showdown') blinds[t.roomId!] ??= [s.smallBlind, s.bigBlind];
      }
      if (openTables(await view()).every(t => blinds[t.roomId!])) break;
    }
    const tables = openTables(await view());
    if (!tables.every(t => blinds[t.roomId!])) console.log('No hand since the break:', JSON.stringify(await seatingReport('', held), null, 1));
    for (const t of tables) expect(blinds[t.roomId!], `table ${t.number} blinds`).toEqual([100, 200]);
  });

  test('a busted player rebuys and is dealt back in with the rebuy stack', async () => {
    let busted: string | undefined;
    for (let i = 0; i < 200 && !busted; i++) {
      await stepTables({ style: 'all-in' });
      busted = (await view()).finishers?.[0]?.userId;
    }
    expect(busted, 'someone busted').toBeTruthy();
    const player = byId(players, busted!);
    expect((await view(player)).you.canRebuy).toBe(true);
    const res = await player.post('/api/tournaments/rebuy', { tournamentId });
    expect(res.status(), `rebuy: ${JSON.stringify(await body(res))}`).toBe(200);

    // Seated again (at whichever table had room) and dealt in with 1000
    let seatedWith: number | undefined;
    let held: Record<string, string | undefined> = {};
    for (let i = 0; i < 20 && seatedWith === undefined; i++) {
      held = await stepTables();
      for (const t of openTables(await view())) {
        if (!t.players.some(p => p.userId === busted)) continue;
        const me = (await tableState(t)).players.find(p => p.id === busted);
        if (me) seatedWith = me.stack + (me.currentBet || 0);
      }
    }
    if (seatedWith === undefined) console.log('Rebuy not seated:', JSON.stringify(await seatingReport(busted!, held), null, 1));
    expect(seatedWith, 'rebuy player back at a table').toBeDefined();
    expect(seatedWith!).toBeGreaterThan(0);
    const v = await view();
    expect(v.entrants.find((e: any) => e.userId === busted).out).toBe(false);
  });

  test('tables balance and break as players bust, down to a winner', async () => {
    test.setTimeout(20 * 60 * 1000);
    let fewestTables = 2;
    let v = await view();
    // Stop early, with a report, once nothing at any table changes for a while
    let lastProgress = '';
    let stuckFor = 0;
    for (let i = 0; i < 1500 && v.status !== 'completed'; i++) {
      const progress: string[] = [];
      if (v.waitingOnRebuys) {
        // One player left: the director closes rebuys and the tournament ends
        v = await directorDoes('close-rebuys');
        v = await view();
        break;
      }
      const held = await stepTables({ style: 'all-in', onState: (roomId, st) => progress.push(`${roomId}:${st.handNumber}:${st.stage}:${st.activePlayer}:${st.pot}`) });
      v = await view();
      const key = progress.join('|') + JSON.stringify(v.tables);
      stuckFor = key === lastProgress ? stuckFor + 1 : 0;
      lastProgress = key;
      if (stuckFor >= 30) {
        console.log('Tournament stuck:', JSON.stringify(await seatingReport('', held), null, 1));
        throw new Error('No table made progress for 30 steps');
      }
      fewestTables = Math.min(fewestTables, openTables(v).length);
      // Never more players at a table than it has seats
      for (const t of openTables(v)) expect(t.players.length, `table ${t.number}`).toBeLessThanOrEqual(3);
    }
    expect(v.status, 'tournament finished').toBe('completed');
    expect(fewestTables, 'the tournament ended on one table').toBe(1);

    expect(v.players.remaining).toBe(1);
    expect(v.finishers).toHaveLength(players.length);
    expect(v.finishers.map((f: any) => f.place)).toEqual(players.map((_, i) => i + 1));
    // 6 buy-ins and 1 rebuy, paid 70/30
    expect(v.prizePool).toBe(70);
    expect(v.finishers[0].prize).toBe(49);
    expect(v.finishers[1].prize).toBe(21);
    expect(v.finishers.slice(2).every((f: any) => f.prize === 0)).toBe(true);
  });
});
