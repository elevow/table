import { APIRequestContext, APIResponse, expect, request } from '@playwright/test';

/**
 * Helpers for multi-player tests that drive real tables through the API.
 *
 * Credentials come from TEST_USER1_EMAIL/TEST_USER1_PASSWORD … TEST_USER6_* (see .env.local).
 * These accounts have fake email addresses, so nothing here may call a route that sends mail
 * (register, forgot/reset password, invites, /api/test/email).
 */

export const MAX_TEST_USERS = 6;

export type Card = { rank: string; suit: string };

export type EnginePlayer = {
  id: string;
  name: string;
  position: number;
  stack: number;
  currentBet: number;
  hasActed: boolean;
  isFolded: boolean;
  isAllIn: boolean;
  holeCards?: Card[];
};

export type GameState = {
  tableId: string;
  stage: string;
  players: EnginePlayer[];
  activePlayer: string;
  pot: number;
  currentBet: number;
  minRaise: number;
  dealerPosition: number;
  smallBlind: number;
  bigBlind: number;
  communityCards: Card[];
  turnSeq?: number;
  variant?: string;
  bettingMode?: string;
  studState?: {
    playerCards: Record<string, { downCards: Card[]; upCards: Card[] }>;
    bringIn?: { amount: number; player: string };
  };
};

export type RoomOptions = {
  name?: string;
  variant?: string;
  bettingMode?: 'no-limit' | 'pot-limit';
  smallBlind?: number;
  bigBlind?: number;
  buyIn?: number;
  maxPlayers?: number;
};

type Credentials = { email: string; password: string };

/** The test accounts configured in the environment, in order. */
export function configuredCredentials(): Credentials[] {
  const creds: Credentials[] = [];
  for (let i = 1; i <= MAX_TEST_USERS; i++) {
    const email = process.env[`TEST_USER${i}_EMAIL`];
    const password = process.env[`TEST_USER${i}_PASSWORD`];
    if (email && password) creds.push({ email, password });
  }
  return creds;
}

function baseURL(): string {
  return process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
}

/** Lets requests through Vercel deployment protection when a bypass secret is configured. */
export function bypassHeaders(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret ? { 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' } : {};
}

async function json(res: APIResponse): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/** A signed-in test account that talks to the game API as itself. */
export class TestPlayer {
  constructor(
    readonly api: APIRequestContext,
    readonly id: string,
    readonly username: string,
    readonly token: string,
  ) {}

  private headers() {
    return { Authorization: `Bearer ${this.token}` };
  }

  post(path: string, data: unknown): Promise<APIResponse> {
    return this.api.post(path, { data, headers: this.headers() });
  }

  get(path: string): Promise<APIResponse> {
    return this.api.get(path, { headers: this.headers() });
  }

  /** Creates a table with a name that marks it as test data. */
  async createRoom(opts: RoomOptions = {}): Promise<string> {
    const res = await this.post('/api/games/rooms/create', {
      name: opts.name || `E2E multiplayer ${new Date().toISOString()}`,
      gameType: 'poker',
      maxPlayers: opts.maxPlayers ?? 6,
      blindLevels: { sb: opts.smallBlind ?? 5, bb: opts.bigBlind ?? 10 },
      configuration: {
        variant: opts.variant ?? 'texas-holdem',
        bettingMode: opts.bettingMode ?? 'no-limit',
        numberOfRebuys: 0,
        buyIn: opts.buyIn ?? 1000,
      },
    });
    expect(res.status(), `create room: ${JSON.stringify(await json(res))}`).toBe(201);
    return (await res.json()).id as string;
  }

  claimSeat(tableId: string, seatNumber: number): Promise<APIResponse> {
    return this.post('/api/games/seats/claim', { tableId, seatNumber, playerName: this.username });
  }

  stand(tableId: string): Promise<APIResponse> {
    return this.post('/api/games/seats/stand', { tableId });
  }

  start(tableId: string): Promise<APIResponse> {
    return this.post('/api/games/start', { tableId });
  }

  nextHand(tableId: string): Promise<APIResponse> {
    return this.post('/api/games/next-hand', { tableId });
  }

  act(tableId: string, action: string, opts: { amount?: number; expectedTurnSeq?: number; playerId?: string } = {}) {
    return this.post('/api/games/action', { tableId, action, ...opts });
  }

  /** The table as this player sees it (own hole cards only, unless showdown/all-in). */
  async state(tableId: string): Promise<GameState> {
    const res = await this.get(`/api/games/state?tableId=${encodeURIComponent(tableId)}`);
    expect(res.status(), `state: ${JSON.stringify(await json(res))}`).toBe(200);
    return (await res.json()).gameState as GameState;
  }

  async logout(): Promise<void> {
    await this.post('/api/auth/logout', {}).catch(() => undefined);
  }
}

/** Signs in every configured test account. One login per account per test file keeps well under the login rate limit. */
export async function loginAll(): Promise<TestPlayer[]> {
  const players: TestPlayer[] = [];
  for (const { email, password } of configuredCredentials()) {
    const api = await request.newContext({ baseURL: baseURL(), extraHTTPHeaders: bypassHeaders() });
    const res = await api.post('/api/auth/login', { data: { email, password } });
    // Never echo credentials; the status alone says what went wrong
    expect(res.status(), `login for test account ${players.length + 1}`).toBe(200);
    const body = await res.json();
    players.push(new TestPlayer(api, body.user.id, body.user.username, body.token));
  }
  return players;
}

export async function logoutAll(players: TestPlayer[]): Promise<void> {
  for (const p of players) {
    await p.logout();
    await p.api.dispose();
  }
}

/** Seats the players in order (seat 1, 2, …) and asserts each claim succeeded. */
export async function seatPlayers(tableId: string, players: TestPlayer[]): Promise<void> {
  for (let i = 0; i < players.length; i++) {
    const res = await players[i].claimSeat(tableId, i + 1);
    expect(res.status(), `seat ${i + 1}: ${JSON.stringify(await json(res))}`).toBe(200);
  }
}

/** Creates a table, seats the players and starts the first hand. Returns the table ID and opening state. */
export async function setUpTable(players: TestPlayer[], opts: RoomOptions = {}): Promise<{ tableId: string; state: GameState }> {
  const tableId = await players[0].createRoom(opts);
  await seatPlayers(tableId, players);
  const res = await players[0].start(tableId);
  expect(res.status(), `start: ${JSON.stringify(await json(res))}`).toBe(201);
  return { tableId, state: (await res.json()).gameState as GameState };
}

/** Stands every player up so the table is left empty. */
export async function clearTable(tableId: string | undefined, players: TestPlayer[]): Promise<void> {
  if (!tableId) return;
  for (const p of players) await p.stand(tableId).catch(() => undefined);
}

export function byId(players: TestPlayer[], id: string): TestPlayer {
  const p = players.find(x => x.id === id);
  if (!p) throw new Error(`No test player with id ${id}`);
  return p;
}

/** Chips on the table: every stack plus the pot. Must not change while a hand is played. */
export function chipsInPlay(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.stack, 0) + (state.pot || 0);
}

/** The amount the active player must add to stay in. */
export function toCall(state: GameState): number {
  const me = state.players.find(p => p.id === state.activePlayer);
  return Math.max(0, (state.currentBet || 0) - (me?.currentBet || 0));
}

export type Decision = { action: string; amount?: number };

/** Default strategy: never raise, just check or call. */
export const checkOrCall = (state: GameState): Decision => ({ action: toCall(state) > 0 ? 'call' : 'check' });

/**
 * Plays the current hand until showdown, asking `decide` for each action and having the
 * active player send it. Every action must be accepted and keep the chip total unchanged.
 */
export async function playHand(
  tableId: string,
  players: TestPlayer[],
  opts: { decide?: (state: GameState) => Decision; expectedChips?: number; maxActions?: number } = {},
): Promise<{ final: GameState; stagesSeen: string[]; actions: number }> {
  const decide = opts.decide ?? checkOrCall;
  const maxActions = opts.maxActions ?? 100;
  let state = await players[0].state(tableId);
  const expectedChips = opts.expectedChips ?? chipsInPlay(state);
  const stagesSeen = [state.stage];
  let actions = 0;

  while (state.stage !== 'showdown') {
    expect(actions, 'hand did not reach showdown').toBeLessThan(maxActions);
    expect(state.activePlayer, `no active player at ${state.stage}`).toBeTruthy();
    const actor = byId(players, state.activePlayer);
    const decision = decide(state);
    const res = await actor.act(tableId, decision.action, { amount: decision.amount, expectedTurnSeq: state.turnSeq ?? 0 });
    expect(res.status(), `${actor.username} ${decision.action} at ${state.stage}: ${JSON.stringify(await json(res))}`).toBe(200);
    state = (await res.json()).gameState as GameState;
    actions++;
    expect(chipsInPlay(state), `chips changed after ${decision.action} at ${state.stage}`).toBe(expectedChips);
    if (stagesSeen[stagesSeen.length - 1] !== state.stage) stagesSeen.push(state.stage);
  }

  return { final: state, stagesSeen, actions };
}

const cardKey = (c: Card) => `${c.rank}${c.suit}`;

/** Every card visible in the state, for duplicate checks once cards are face up. */
export function allVisibleCards(state: GameState): string[] {
  const cards: Card[] = [...(state.communityCards || [])];
  if (state.studState) {
    for (const pc of Object.values(state.studState.playerCards)) cards.push(...pc.downCards, ...pc.upCards);
  } else {
    for (const p of state.players) cards.push(...(p.holeCards || []));
  }
  return cards.map(cardKey);
}
