import {
  getGameSeats,
  getRoomSeats,
  setRoomSeats,
  initializeRoomSeats,
  claimSeat,
  leaveSeat,
  getCurrentPlayerCount,
  getActiveRooms,
  getRoomStats,
  type GameSeats,
} from '../../lib/shared/game-seats';

describe('lib/shared/game-seats', () => {
  const ROOM_A = 'room-a';
  const ROOM_B = 'room-b';
  const ROOM_C = 'room-c';

  beforeEach(() => {
    // Clear the global map to isolate tests
    getGameSeats().clear();
  });

  test('initializeRoomSeats creates 9 empty seats (1..9)', () => {
    const seats = initializeRoomSeats(ROOM_A);
    // Should have keys 1..9 and all null
    for (let i = 1; i <= 9; i++) {
      expect(Object.prototype.hasOwnProperty.call(seats, i)).toBe(true);
      expect(seats[i]).toBeNull();
    }
    // Map should now contain the room
    expect(getGameSeats().has(ROOM_A)).toBe(true);
  });

  test('claimSeat succeeds for empty seat and fails when already taken', () => {
    initializeRoomSeats(ROOM_A);
    const ok = claimSeat(ROOM_A, 5, { playerId: 'p1', playerName: 'Alice', chips: 100 });
    expect(ok).toBe(true);
    let seats = getRoomSeats(ROOM_A);
    expect(seats[5]).toEqual({ playerId: 'p1', playerName: 'Alice', chips: 100 });

    const again = claimSeat(ROOM_A, 5, { playerId: 'p2', playerName: 'Bob', chips: 200 });
    expect(again).toBe(false);
    // Seat remains with original assignment
    seats = getRoomSeats(ROOM_A);
    expect(seats[5]).toEqual({ playerId: 'p1', playerName: 'Alice', chips: 100 });
  });

  test('leaveSeat removes player and returns seat number; null if not found', () => {
    initializeRoomSeats(ROOM_A);
    claimSeat(ROOM_A, 3, { playerId: 'p1', playerName: 'Alice', chips: 100 });
    claimSeat(ROOM_A, 7, { playerId: 'p2', playerName: 'Bob', chips: 200 });

    const left = leaveSeat(ROOM_A, 'p2');
    expect(left).toBe(7);
    const seats = getRoomSeats(ROOM_A);
    expect(seats[7]).toBeNull();

    const notFound = leaveSeat(ROOM_A, 'nope');
    expect(notFound).toBeNull();
  });

  test('getCurrentPlayerCount reflects number of claimed seats', () => {
    initializeRoomSeats(ROOM_A);
    expect(getCurrentPlayerCount(ROOM_A)).toBe(0);
    claimSeat(ROOM_A, 1, { playerId: 'p1', playerName: 'Alice', chips: 100 });
    claimSeat(ROOM_A, 9, { playerId: 'p2', playerName: 'Bob', chips: 200 });
    expect(getCurrentPlayerCount(ROOM_A)).toBe(2);
  });

  test('setRoomSeats and getRoomSeats round-trip custom map', () => {
    const custom: GameSeats = { 1: null, 2: null, 3: { playerId: 'p3', playerName: 'Cara', chips: 300 } } as any;
    setRoomSeats(ROOM_B, custom);
    const seats = getRoomSeats(ROOM_B);
    expect(seats[3]).toEqual({ playerId: 'p3', playerName: 'Cara', chips: 300 });
    expect(getCurrentPlayerCount(ROOM_B)).toBe(1);
  });

  test('getActiveRooms returns only rooms with at least one player', () => {
    initializeRoomSeats(ROOM_A);
    initializeRoomSeats(ROOM_B);
    initializeRoomSeats(ROOM_C);
    claimSeat(ROOM_A, 2, { playerId: 'p1', playerName: 'Alice', chips: 100 });
    // ROOM_B stays empty
    claimSeat(ROOM_C, 1, { playerId: 'p2', playerName: 'Bob', chips: 200 });
    claimSeat(ROOM_C, 5, { playerId: 'p3', playerName: 'Cara', chips: 300 });

    const active = getActiveRooms();
    expect(active).toEqual(expect.arrayContaining([ROOM_A, ROOM_C]));
    expect(active).not.toEqual(expect.arrayContaining([ROOM_B]));
  });

  test('getRoomStats aggregates and sorts players by seatNumber', () => {
    initializeRoomSeats(ROOM_A);
    claimSeat(ROOM_A, 7, { playerId: 'p7', playerName: 'Gina', chips: 700 });
    claimSeat(ROOM_A, 2, { playerId: 'p2', playerName: 'Bob', chips: 200 });

    const stats = getRoomStats(ROOM_A);
    expect(stats.roomId).toBe(ROOM_A);
    expect(stats.currentPlayers).toBe(2);
    expect(stats.playerList.map(p => p.seatNumber)).toEqual([2, 7]);
    expect(stats.playerList[0]).toMatchObject({ playerId: 'p2', playerName: 'Bob', chips: 200 });
    expect(stats.playerList[1]).toMatchObject({ playerId: 'p7', playerName: 'Gina', chips: 700 });
  });

  test('getRoomSeats returns empty object for unknown room', () => {
    const seats = getRoomSeats('unknown');
    expect(seats).toEqual({});
    expect(getCurrentPlayerCount('unknown')).toBe(0);
  });
});
