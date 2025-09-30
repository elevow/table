// Shared game state for tracking real-time seat assignments
// This module maintains the game state that can be accessed by multiple API routes

export type SeatAssignment = {
  playerId: string;
  playerName: string;
  chips: number;
} | null;

export type GameSeats = Record<number, SeatAssignment>;

// Global Map to store game seats across all rooms
const gameSeats: Map<string, GameSeats> = new Map();

export function getGameSeats(): Map<string, GameSeats> {
  return gameSeats;
}

export function getRoomSeats(roomId: string): GameSeats {
  return gameSeats.get(roomId) || {};
}

export function setRoomSeats(roomId: string, seats: GameSeats): void {
  gameSeats.set(roomId, seats);
}

export function initializeRoomSeats(roomId: string): GameSeats {
  if (!gameSeats.has(roomId)) {
    const initialSeats: GameSeats = {};
    for (let i = 1; i <= 9; i++) {
      initialSeats[i] = null;
    }
    gameSeats.set(roomId, initialSeats);
  }
  return gameSeats.get(roomId)!;
}

export function claimSeat(roomId: string, seatNumber: number, assignment: { playerId: string; playerName: string; chips: number }): boolean {
  const seats = initializeRoomSeats(roomId);
  
  if (seats[seatNumber]) {
    return false; // Seat already taken
  }
  
  seats[seatNumber] = assignment;
  gameSeats.set(roomId, seats);
  return true;
}

export function leaveSeat(roomId: string, playerId: string): number | null {
  const seats = getRoomSeats(roomId);
  
  for (const [seatNumberStr, assignment] of Object.entries(seats)) {
    if (assignment && assignment.playerId === playerId) {
      const seatNumber = parseInt(seatNumberStr);
      seats[seatNumber] = null;
      gameSeats.set(roomId, seats);
      return seatNumber;
    }
  }
  
  return null;
}

export function getCurrentPlayerCount(roomId: string): number {
  const seats = getRoomSeats(roomId);
  let count = 0;
  
  for (const assignment of Object.values(seats)) {
    if (assignment) {
      count++;
    }
  }
  
  return count;
}

export function getActiveRooms(): string[] {
  const activeRooms: string[] = [];
  
  for (const [roomId, seats] of gameSeats) {
    let hasPlayers = false;
    for (const assignment of Object.values(seats)) {
      if (assignment) {
        hasPlayers = true;
        break;
      }
    }
    if (hasPlayers) {
      activeRooms.push(roomId);
    }
  }
  
  return activeRooms;
}

export function getRoomStats(roomId: string) {
  const seats = getRoomSeats(roomId);
  const playerList: Array<{
    seatNumber: number;
    playerId: string;
    playerName: string;
    chips: number;
  }> = [];
  
  let currentPlayers = 0;
  
  for (const [seatNumberStr, assignment] of Object.entries(seats)) {
    if (assignment) {
      currentPlayers++;
      playerList.push({
        seatNumber: parseInt(seatNumberStr),
        playerId: assignment.playerId,
        playerName: assignment.playerName,
        chips: assignment.chips
      });
    }
  }
  
  return {
    roomId,
    currentPlayers,
    playerList: playerList.sort((a, b) => a.seatNumber - b.seatNumber)
  };
}