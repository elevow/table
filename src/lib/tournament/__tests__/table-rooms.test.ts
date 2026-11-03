/**
 * @jest-environment node
 */
// Rooms, seats, saved games and the engine are faked in memory; the tournament is real
const mockRooms = new Map<string, { createdBy: string | null; maxPlayers: number; configuration: Record<string, any> }>();
const mockSeats = new Map<string, Record<number, { playerId: string; playerName: string; chips: number } | null>>();
const mockEngines = new Map<string, any>();
let mockNow = 1_000_000;

class MockEngine {
  removed = new Set<string>();
  pendingBlinds: { smallBlind: number; bigBlind: number } | null = null;
  ante = 0;
  handsStarted = 0;
  state: any;
  constructor(_roomId: string, players: any[], smallBlind: number, bigBlind: number) {
    this.state = { stage: 'preflop', players: players.map(p => ({ ...p })), smallBlind, bigBlind, handStartStacks: {}, paused: false };
  }
  getState() { return this.state; }
  isRemoved(id: string) { return this.removed.has(id); }
  removePlayer(id: string) { this.removed.add(id); }
  setPendingBlinds(smallBlind: number, bigBlind: number) { this.pendingBlinds = { smallBlind, bigBlind }; }
  setAnte(amount: number) { this.ante = amount; }
  configureClock() {}
  useTournamentRules() { this.state.tournamentRules = true; }
  syncSeatedPlayers(seated: Array<{ id: string; name: string; seatNumber: number; chips: number }>) {
    for (const s of seated) {
      if (!this.state.players.some((p: any) => p.id === s.id) || this.removed.has(s.id)) {
        this.removed.delete(s.id);
        this.state.players = this.state.players.filter((p: any) => p.id !== s.id);
        this.state.players.push({ id: s.id, name: s.name, position: s.seatNumber, stack: s.chips });
      }
    }
  }
  canStartNewHand() { return this.state.players.filter((p: any) => !this.removed.has(p.id)).length >= 2; }
  startNewHand() {
    this.state.players = this.state.players.filter((p: any) => !this.removed.has(p.id));
    this.removed.clear();
    if (this.pendingBlinds) Object.assign(this.state, this.pendingBlinds);
    this.state.stage = 'preflop';
    this.state.handStartStacks = Object.fromEntries(this.state.players.map((p: any) => [p.id, p.stack]));
    this.state.handNumber = (this.state.handNumber || 0) + 1;
    this.handsStarted += 1;
  }
  timedOutAt: number | null = null;
  handleTimeout(now: number) { this.timedOutAt = now; }
  /** Test helper: the hand ends with these stacks, the winner taking the chips that changed hands. */
  endHand(stacks: Record<string, number>, winner?: string) {
    this.state.stage = 'showdown';
    for (const p of this.state.players) if (stacks[p.id] !== undefined) p.stack = stacks[p.id];
    this.state.handResult = winner ? { pot: 0, winnings: { [winner]: 1 } } : undefined;
  }
}

jest.mock('../../poker/poker-engine', () => ({ PokerEngine: MockEngine }));
const mockSavedAt = new Map<string, number>();
jest.mock('../../poker/engine-persistence', () => ({
  getOrRestoreEngine: async (roomId: string) => mockEngines.get(roomId) ?? null,
  persistEngineState: async (roomId: string, engine: any) => { mockEngines.set(roomId, engine); mockSavedAt.set(roomId, Date.now()); return 'saved'; },
  STALE_STATE_RESPONSE: { error: 'stale', code: 'STALE_GAME_STATE' },
  getLastActionAt: async (roomId: string) => (mockSavedAt.has(roomId) ? new Date(mockSavedAt.get(roomId)!) : null),
}));
const mockTimeouts: string[] = [];
jest.mock('../../server/game-action-pipeline', () => ({
  runGameAction: async ({ tableId, apply }: { tableId: string; apply: () => void }) => { apply(); mockTimeouts.push(tableId); return { status: 'ok' }; },
}));
// Each seat change goes straight to the room's saved seats, like the database statements do
jest.mock('../room-seats', () => {
  const clear = (roomId: string, userId: string) => {
    const seats = mockSeats.get(roomId) || {};
    for (const n of Object.keys(seats)) if (seats[Number(n)]?.playerId === userId) seats[Number(n)] = null;
    mockSeats.set(roomId, seats);
  };
  const take = (roomId: string, seatNumber: number, seat: any) => {
    clear(roomId, seat.playerId);
    mockSeats.get(roomId)![seatNumber] = { ...seat };
    const cfg = mockRooms.get(roomId)!.configuration;
    if (!(cfg.members || []).includes(seat.playerId)) cfg.members = [...(cfg.members || []), seat.playerId];
  };
  return {
    takeSeat: async (roomId: string, seatNumber: number, seat: any) => take(roomId, seatNumber, seat),
    leaveSeat: async (roomId: string, userId: string) => clear(roomId, userId),
    moveSeat: async (from: string, to: string, seatNumber: number, seat: any) => { clear(from, seat.playerId); take(to, seatNumber, seat); },
  };
});
jest.mock('../../poker/run-it-twice-manager', () => ({ clearRunItState: () => {}, enrichStateWithRunIt: (_id: string, s: any) => s }));
jest.mock('../../poker/state-sanitizer', () => ({ sanitizeStateForBroadcast: (s: any) => s }));
jest.mock('../../realtime/publisher', () => ({ publishGameStateUpdate: async () => {}, publishTableEvent: async () => {} }));
jest.mock('../../realtime/sequence', () => ({ nextSeq: () => 1 }));
jest.mock('../../database/pool', () => ({ getPool: () => ({}) }));
jest.mock('../../shared/game-seats', () => ({
  loadPersistedRoomSeats: async (roomId: string) => (mockSeats.has(roomId) ? JSON.parse(JSON.stringify(mockSeats.get(roomId))) : null),
  setRoomSeats: () => {},
  persistRoomSeats: async (roomId: string, seats: any) => { mockSeats.set(roomId, JSON.parse(JSON.stringify(seats))); return true; },
}));
jest.mock('../../server/room-config', () => ({
  loadRoom: async (roomId: string) => mockRooms.get(roomId) ?? null,
}));
jest.mock('../../server/room-privacy', () => ({ newInviteCode: () => 'INVITE1234' }));
jest.mock('../../services/game-service', () => ({
  GameService: class {
    async createRoom(input: any) {
      const id = `room-${mockRooms.size + 1}`;
      mockRooms.set(id, { createdBy: input.createdBy, maxPlayers: input.maxPlayers, configuration: { ...input.configuration } });
      return { id };
    }
  },
}));
jest.mock('../pg-tournament-store', () => ({ loadPlayerNames: async () => ({}) }));
jest.mock('../manager-instance', () => {
  const { TournamentManager } = jest.requireActual('../tournament-manager');
  const { MemoryTournamentStore } = jest.requireActual('../tournament-store');
  // Seats are drawn in order (random() = 0) so tests know who sits where
  return { tournamentManager: new TournamentManager(new MemoryTournamentStore(), () => 0, () => mockNow) };
});

import { keepTablesMoving, prepareTournamentHand, syncTournamentRooms, tournamentTableOf } from '../table-rooms';
import { tournamentManager } from '../manager-instance';
import { createDefaultFreezeoutConfig, createRebuyAddOnConfig } from '../tournament-utils';
import type { TournamentConfig } from '../../../types/tournament';

const MIN = 60_000;

beforeEach(() => {
  mockRooms.clear();
  mockSeats.clear();
  mockEngines.clear();
  mockSavedAt.clear();
  mockTimeouts.length = 0;
  mockNow = 1_000_000;
});

async function startTournament(players: string[], config: TournamentConfig = createDefaultFreezeoutConfig()) {
  const { id } = await tournamentManager.create({ name: 'Friday', config, createdBy: 'td-1' });
  for (const userId of players) await tournamentManager.register({ tournamentId: id, userId });
  await tournamentManager.start(id);
  await syncTournamentRooms(id);
  return id;
}

const t = async (id: string) => (await tournamentManager.get(id))!;
const roomOf = async (id: string, tableNumber: number) => (await t(id)).tables.find(tb => tb.number === tableNumber)!.roomId!;
const seated = (roomId: string) => Object.values(mockSeats.get(roomId) || {}).filter(Boolean).map(a => a!.playerId).sort();
const linkOf = (roomId: string) => tournamentTableOf(mockRooms.get(roomId)!.configuration)!;

describe('opening tables', () => {
  test('each table gets a private room, its players seated with starting stacks, and a game', async () => {
    const id = await startTournament(['a', 'b', 'c', 'd'], { ...createDefaultFreezeoutConfig(), seatsPerTable: 2 });
    const state = await t(id);
    expect(state.tables).toHaveLength(2);
    for (const table of state.tables) {
      const room = mockRooms.get(table.roomId!)!;
      expect(room.createdBy).toBe('td-1');
      expect(room.configuration).toMatchObject({ visibility: 'private', tournamentId: id, tournamentTableId: table.id, members: expect.any(Array) });
      expect(seated(table.roomId!)).toEqual(table.seats.filter(Boolean).sort());
      const engine = mockEngines.get(table.roomId!);
      expect(engine.state.players.map((p: any) => p.stack)).toEqual([20000, 20000]);
      // Away until each opens the table, so a no-show doesn't hold up the first hands
      expect(engine.state.players.every((p: any) => p.isSittingOut && p.notArrived)).toBe(true);
      expect(engine.handsStarted).toBe(1);
      expect([engine.state.smallBlind, engine.state.bigBlind]).toEqual([100, 200]);
    }
    // The starting stacks reached the tables
    expect(state.chips).toEqual({ a: 20000, b: 20000, c: 20000, d: 20000 });
    expect(state.pendingChips ?? {}).toEqual({});
  });

  test('syncing again changes nothing', async () => {
    const id = await startTournament(['a', 'b', 'c']);
    const before = JSON.stringify([...mockSeats.entries()]);
    await syncTournamentRooms(id);
    expect(JSON.stringify([...mockSeats.entries()])).toBe(before);
    expect(mockRooms.size).toBe(1);
  });
});

describe('between hands', () => {
  test('stacks are reported and a busted player is eliminated, credited to the winner', async () => {
    const id = await startTournament(['a', 'b', 'c']);
    const roomId = await roomOf(id, 1);
    const engine = mockEngines.get(roomId);
    engine.endHand({ a: 40000, b: 0, c: 20000 }, 'a');
    const result = await prepareTournamentHand(roomId, engine, linkOf(roomId));
    expect(result).toEqual({ ok: true });
    const state = await t(id);
    expect(state.eliminatedPlayers).toEqual(['b']);
    expect(state.eliminationRecords![0]).toMatchObject({ userId: 'b', place: 3, eliminatedBy: 'a' });
    expect(state.chips).toMatchObject({ a: 40000, c: 20000, b: 0 });
    expect(engine.isRemoved('b')).toBe(true);
    expect(seated(roomId)).toEqual(['a', 'c']);
  });

  test('two players busting in one hand: the smaller starting stack finishes lower', async () => {
    const id = await startTournament(['a', 'b', 'c', 'd']);
    const roomId = await roomOf(id, 1);
    const engine = mockEngines.get(roomId);
    engine.state.handStartStacks = { a: 20000, b: 5000, c: 15000, d: 20000 };
    engine.endHand({ a: 60000, b: 0, c: 0 }, 'a');
    await prepareTournamentHand(roomId, engine, linkOf(roomId));
    const records = (await t(id)).eliminationRecords!.map(r => [r.userId, r.place]);
    expect(records).toEqual([['b', 4], ['c', 3]]);
  });

  test('the next hand gets the current level\'s blinds and ante', async () => {
    const id = await startTournament(['a', 'b']);
    const roomId = await roomOf(id, 1);
    const engine = mockEngines.get(roomId);
    mockNow += 24 * MIN + 10 * MIN; // levels 1-2 and the break: level 3 is 300/600 ante 75
    engine.endHand({});
    expect(await prepareTournamentHand(roomId, engine, linkOf(roomId))).toEqual({ ok: true });
    expect(engine.pendingBlinds).toEqual({ smallBlind: 300, bigBlind: 600 });
    expect(engine.ante).toBe(75);
  });

  test('tables hold during a break or a pause, and say when the tournament is over', async () => {
    const id = await startTournament(['a', 'b']);
    const roomId = await roomOf(id, 1);
    const engine = mockEngines.get(roomId);
    mockNow += 24 * MIN + 2 * MIN; // on the break after level 2
    engine.endHand({});
    const onBreak = await prepareTournamentHand(roomId, engine, linkOf(roomId));
    expect(onBreak).toMatchObject({ ok: false, status: 409, body: { code: 'TOURNAMENT_PAUSED', breakEndsAt: expect.any(Number) } });

    mockNow += 8 * MIN;
    await tournamentManager.pause(id);
    expect(await prepareTournamentHand(roomId, engine, linkOf(roomId))).toMatchObject({ ok: false, body: { code: 'TOURNAMENT_PAUSED', breakEndsAt: null } });

    await tournamentManager.resume(id);
    engine.endHand({ a: 40000, b: 0 }, 'a');
    expect(await prepareTournamentHand(roomId, engine, linkOf(roomId))).toMatchObject({ ok: false, body: { code: 'TOURNAMENT_OVER' } });
    expect((await t(id)).status).toBe('completed');
  });

  test('tables play by tournament rules, so players who are away are blinded off', async () => {
    const id = await startTournament(['a', 'b']);
    const roomId = await roomOf(id, 1);
    const engine = mockEngines.get(roomId);
    expect(engine.state.tournamentRules).toBe(true);
    // A game saved before the rules existed picks them up at its next hand
    delete engine.state.tournamentRules;
    engine.endHand({});
    await prepareTournamentHand(roomId, engine, linkOf(roomId));
    expect(engine.state.tournamentRules).toBe(true);
  });

  test('a hand still being played is left alone', async () => {
    const id = await startTournament(['a', 'b']);
    const roomId = await roomOf(id, 1);
    expect(await prepareTournamentHand(roomId, mockEngines.get(roomId), linkOf(roomId))).toMatchObject({ ok: false, body: { error: 'Hand still in progress' } });
  });
});

describe('moving players between tables', () => {
  test('a player moved for balancing leaves with their chips after their hand and is dealt in at the new table', async () => {
    // Three 3-max tables of 3, 3 and 2... with 6 players: tables of 3 and 3
    const id = await startTournament(['a', 'b', 'c', 'd', 'e', 'f'], { ...createDefaultFreezeoutConfig(), seatsPerTable: 3 });
    const tableA = await roomOf(id, 1);
    const tableB = await roomOf(id, 2);
    const atA = seated(tableA);
    const atB = seated(tableB);

    // Two players bust at table A: it's down to one, so a player at table B is moved over
    const engineA = mockEngines.get(tableA);
    engineA.endHand({ [atA[0]]: 60000, [atA[1]]: 0, [atA[2]]: 0 }, atA[0]);
    await prepareTournamentHand(tableA, engineA, linkOf(tableA));
    const state = await t(id);
    const moved = atB.find(u => state.tables.find(tb => tb.roomId === tableA)!.seats.includes(u))!;
    expect(moved).toBeDefined();
    // Table B is mid-hand, so the moved player is still sitting there
    expect(seated(tableB)).toContain(moved);

    // Table B finishes its hand: it lets them go, and they sit at table A with their stack
    const engineB = mockEngines.get(tableB);
    engineB.endHand({ [moved]: 23456 });
    await prepareTournamentHand(tableB, engineB, linkOf(tableB));
    expect(engineB.isRemoved(moved)).toBe(true);
    expect(seated(tableB)).not.toContain(moved);
    expect(seated(tableA)).toContain(moved);
    const seat = Object.values(mockSeats.get(tableA)!).find(a => a?.playerId === moved)!;
    expect(seat.chips).toBe(23456);
    expect(mockRooms.get(tableA)!.configuration.members).toContain(moved);
  });

  test('players who busted are saved as gone at once, even when the table then waits for a moved player', async () => {
    // Before, a table that couldn't deal never saved, so its next try reported the same busts again
    // and eliminated a player who had bought back in meanwhile
    const id = await startTournament(['a', 'b', 'c', 'd', 'e', 'f'], { ...createDefaultFreezeoutConfig(), seatsPerTable: 3 });
    const tableA = await roomOf(id, 1);
    const [winner, out1, out2] = seated(tableA);
    const engine = mockEngines.get(tableA);
    engine.endHand({ [winner]: 60000, [out1]: 0, [out2]: 0 }, winner);
    mockSavedAt.clear();
    await prepareTournamentHand(tableA, engine, linkOf(tableA));
    expect(mockSavedAt.has(tableA)).toBe(true);
    expect(engine.isRemoved(out1) && engine.isRemoved(out2)).toBe(true);
  });

  test('a table that breaks sends its players on and closes', async () => {
    const id = await startTournament(['a', 'b', 'c', 'd'], { ...createDefaultFreezeoutConfig(), seatsPerTable: 3 });
    // Tables of 2 and 2; a bust at table 1 leaves 3, who fit at one table, so the shortest (table 1) breaks
    const table1 = await roomOf(id, 1);
    const table2 = await roomOf(id, 2);
    const engine1 = mockEngines.get(table1);
    const [winner, loser] = seated(table1);
    engine1.endHand({ [winner]: 40000, [loser]: 0 }, winner);
    const closed = await prepareTournamentHand(table1, engine1, linkOf(table1));
    expect(closed).toMatchObject({ ok: false, body: { code: 'TABLE_CLOSED' } });
    expect((await t(id)).tables.map(tb => tb.number)).toEqual([2]);
    expect(seated(table1)).toEqual([]);
    // The survivor took their 40,000 to table 2
    expect(seated(table2)).toHaveLength(3);
    expect(Object.values(mockSeats.get(table2)!).find(a => a?.playerId === winner)!.chips).toBe(40000);
  });
});

describe('chips bought during play', () => {
  test('a busted player who rebuys is seated with the rebuy stack', async () => {
    const id = await startTournament(['a', 'b', 'c'], createRebuyAddOnConfig());
    const roomId = await roomOf(id, 1);
    const engine = mockEngines.get(roomId);
    engine.endHand({ a: 40000, b: 0, c: 20000 }, 'a');
    await prepareTournamentHand(roomId, engine, linkOf(roomId));
    expect(seated(roomId)).toEqual(['a', 'c']);

    await tournamentManager.rebuy({ tournamentId: id, userId: 'b' });
    await syncTournamentRooms(id);
    const seat = Object.values(mockSeats.get(roomId)!).find(a => a?.playerId === 'b')!;
    expect(seat.chips).toBe(20000);
    expect((await t(id)).chips!.b).toBe(20000);
    expect((await t(id)).pendingChips ?? {}).toEqual({});
  });

  test('an add-on is added to the stack of a player already at the table', async () => {
    const id = await startTournament(['a', 'b'], createRebuyAddOnConfig()); // add-on at the break after level 3
    const roomId = await roomOf(id, 1);
    const engine = mockEngines.get(roomId);
    mockNow += 36 * MIN + 1 * MIN;
    engine.endHand({ a: 25000, b: 15000 });
    await prepareTournamentHand(roomId, engine, linkOf(roomId)); // held for the break
    await tournamentManager.addOn({ tournamentId: id, userId: 'a' });
    mockNow += 10 * MIN; // the break is over
    expect(await prepareTournamentHand(roomId, engine, linkOf(roomId))).toEqual({ ok: true });
    expect(engine.state.players.find((p: any) => p.id === 'a').stack).toBe(25000 + 30000);
    expect((await t(id)).chips!.a).toBe(55000);
  });

  test('a late entrant is seated at their table and dealt in', async () => {
    const id = await startTournament(['a', 'b']);
    await tournamentManager.register({ tournamentId: id, userId: 'late' });
    await syncTournamentRooms(id);
    const roomId = await roomOf(id, 1);
    expect(seated(roomId)).toEqual(['a', 'b', 'late']);
    expect((await t(id)).chips!.late).toBe(20000);
  });
});

describe('seats out of step with the tournament', () => {
  test('a seat the tournament no longer gives the table is cleared before the next hand', async () => {
    const id = await startTournament(['a', 'b', 'c']);
    const roomId = await roomOf(id, 1);
    // A busted player left behind in the seats, as an overwritten change could leave them
    mockSeats.get(roomId)![9] = { playerId: 'ghost', playerName: 'Ghost', chips: 20000 };
    const engine = mockEngines.get(roomId);
    engine.endHand({});
    expect(await prepareTournamentHand(roomId, engine, linkOf(roomId))).toEqual({ ok: true });
    expect(seated(roomId)).toEqual(['a', 'b', 'c']);
  });
});

describe('tables nobody has open', () => {
  test('a table left at showdown gets its next hand dealt; one that just got there is left to its players', async () => {
    // Paying one place keeps four players off the bubble, where hand for hand would wake every table
    const id = await startTournament(['a', 'b', 'c', 'd'], {
      ...createDefaultFreezeoutConfig(), seatsPerTable: 2, payoutStructure: [{ place: 1, percentage: 100 }],
    });
    const idle = await roomOf(id, 1);
    const fresh = await roomOf(id, 2);
    mockEngines.get(idle).endHand({});
    mockEngines.get(fresh).endHand({});
    mockSavedAt.set(idle, Date.now() - 60_000);
    mockSavedAt.set(fresh, Date.now());
    await keepTablesMoving(id);
    expect(mockEngines.get(idle).handsStarted).toBe(2);
    expect(mockEngines.get(fresh).handsStarted).toBe(1);
  });

  test('a turn clock that ran out with no screen to enforce it is enforced', async () => {
    const id = await startTournament(['a', 'b']);
    const roomId = await roomOf(id, 1);
    const engine = mockEngines.get(roomId);
    engine.state.activePlayer = 'a';
    engine.state.players.forEach((p: any) => { p.currentBet = 0; });
    engine.state.currentBet = 0;
    engine.state.turnDeadline = Date.now() - 60_000;
    await keepTablesMoving(id);
    expect(mockTimeouts).toEqual([roomId]);
    expect(engine.timedOutAt).not.toBeNull();
  });

  test('a turn with time left, or a second call straight away, does nothing', async () => {
    const id = await startTournament(['a', 'b']);
    const roomId = await roomOf(id, 1);
    const engine = mockEngines.get(roomId);
    engine.state.activePlayer = 'a';
    engine.state.turnDeadline = Date.now() + 20_000;
    await keepTablesMoving(id);
    engine.state.turnDeadline = Date.now() - 60_000;
    await keepTablesMoving(id);
    expect(mockTimeouts).toEqual([]);
  });
});

describe('hand for hand on the bubble', () => {
  const config = (): TournamentConfig => ({
    ...createDefaultFreezeoutConfig(),
    seatsPerTable: 3,
    payoutStructure: [{ place: 1, percentage: 50 }, { place: 2, percentage: 30 }, { place: 3, percentage: 20 }],
  });

  test('each table plays one hand a round, and busts in a round finish by starting stack, whichever table reports first', async () => {
    const id = await startTournament(['a', 'b', 'c', 'd', 'e'], config());
    const rooms = (await t(id)).tables.map(tb => tb.roomId!);
    const big = rooms.find(r => seated(r).length === 3)!;
    const small = rooms.find(r => r !== big)!;
    const engineBig = mockEngines.get(big);
    const engineSmall = mockEngines.get(small);

    // A bust at the table of three leaves four, one off the money: hand for hand starts
    const [b1, b2, b3] = seated(big);
    engineBig.endHand({ [b1]: 40000, [b2]: 0, [b3]: 20000 }, b1);
    expect(await prepareTournamentHand(big, engineBig, linkOf(big))).toEqual({ ok: true });
    expect((await t(id)).handForHand).toMatchObject({ round: 1 });

    // Its hand of the round busts a player who started it with 40,000; it then waits
    engineBig.startNewHand();
    engineBig.state.handStartStacks = { [b1]: 40000, [b3]: 20000 };
    engineBig.endHand({ [b1]: 60000, [b3]: 0 }, b1);
    expect(await prepareTournamentHand(big, engineBig, linkOf(big))).toMatchObject({ ok: false, body: { code: 'HAND_FOR_HAND' } });
    expect((await t(id)).eliminatedPlayers).not.toContain(b3);

    // The other table finishes the hand it was playing, then deals its hand of the round
    const [s1, s2] = seated(small);
    engineSmall.endHand({});
    expect(await prepareTournamentHand(small, engineSmall, linkOf(small))).toEqual({ ok: true });
    engineSmall.startNewHand();
    engineSmall.state.handStartStacks = { [s1]: 30000, [s2]: 10000 };
    engineSmall.endHand({ [s1]: 40000, [s2]: 0 }, s1);
    await prepareTournamentHand(small, engineSmall, linkOf(small));

    // Both busted in the same round: the smaller starting stack finishes lower, off the money
    const state = await t(id);
    const placeOf = (u: string) => state.eliminationRecords!.find(r => r.userId === u)!.place;
    expect(placeOf(s2)).toBe(4);
    expect(placeOf(b3)).toBe(3);
    expect(state.handForHand ?? null).toBeNull();
  });
});
