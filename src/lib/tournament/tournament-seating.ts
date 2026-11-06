import { randomUUID } from 'crypto';
import type { TableMove, TournamentTable } from '../../types/tournament-management';

export const DEFAULT_SEATS_PER_TABLE = 9;

/** A source of numbers in [0, 1), like Math.random; tests pass a seeded one. */
export type Random = () => number;

export function seatedPlayers(table: TournamentTable): string[] {
  return table.seats.filter((s): s is string => s !== null);
}

/**
 * Seat the field at the start: as few tables as hold everyone, dealt round-robin so table sizes
 * differ by at most one (20 players at 9-max sit 7, 7, 6), each player in a random seat.
 */
export function drawSeats(userIds: string[], seatsPerTable: number, random: Random): TournamentTable[] {
  const tableCount = Math.ceil(userIds.length / seatsPerTable);
  const tables = Array.from({ length: tableCount }, (_, i) => newTable(i + 1, seatsPerTable));
  shuffle(userIds, random).forEach((userId, i) => sit(tables[i % tableCount], userId, random));
  return tables;
}

/**
 * Seat a player who joins after the start in a random empty seat at the shortest table,
 * opening a new table only when every seat is taken. Changes `tables` in place.
 */
export function seatLatePlayer(tables: TournamentTable[], userId: string, seatsPerTable: number, random: Random): void {
  const open = tables.filter(hasEmptySeat);
  let table: TournamentTable;
  if (open.length > 0) {
    table = pick(shortest(open), random);
  } else {
    table = newTable(Math.max(0, ...tables.map(t => t.number)) + 1, seatsPerTable);
    tables.push(table);
  }
  sit(table, userId, random);
}

export function unseatPlayer(tables: TournamentTable[], userId: string): void {
  for (const table of tables) {
    const i = table.seats.indexOf(userId);
    if (i >= 0) table.seats[i] = null;
  }
}

/**
 * After the field changes: drop empty tables, break a table whenever everyone left fits at one
 * fewer, and move players from the biggest table to the smallest until sizes differ by at most one.
 * Returns the tables that remain and the moves made.
 *
 * The player moved for balancing should be the one due the big blind next, so nobody skips or
 * repeats the blinds. Tournament tables aren't linked to game rooms yet, so the button isn't
 * known here and a random player at the biggest table moves instead.
 */
export function balanceTables(
  tables: TournamentTable[],
  seatsPerTable: number,
  random: Random
): { tables: TournamentTable[]; moves: TableMove[] } {
  let current = tables.filter(t => count(t) > 0);
  const moves: TableMove[] = [];
  const move = (userId: string, from: TournamentTable, to: TournamentTable, reason: TableMove['reason']) => {
    from.seats[from.seats.indexOf(userId)] = null;
    const seat = sit(to, userId, random);
    moves.push({ at: Date.now(), userId, fromTableId: from.id, toTableId: to.id, seat, reason });
  };

  for (;;) {
    const players = current.reduce((sum, t) => sum + count(t), 0);
    if (current.length > Math.ceil(players / seatsPerTable)) {
      // Break the shortest table; among equals the highest-numbered goes first
      const breaking = shortest(current).sort((a, b) => b.number - a.number)[0];
      current = current.filter(t => t !== breaking);
      for (const userId of shuffle(seatedPlayers(breaking), random)) {
        move(userId, breaking, pick(shortest(current.filter(hasEmptySeat)), random), 'break');
      }
      continue;
    }
    if (current.length < 2) break;
    const biggest = longest(current);
    const smallest = shortest(current);
    if (count(biggest[0]) - count(smallest[0]) < 2) break;
    const from = pick(biggest, random);
    move(pick(seatedPlayers(from), random), from, pick(smallest, random), 'balance');
  }
  return { tables: current, moves };
}

function newTable(number: number, seatsPerTable: number): TournamentTable {
  return { id: `tbl-${randomUUID()}`, number, maxSeats: seatsPerTable, seats: Array(seatsPerTable).fill(null) };
}

/** Put a player in a random empty seat; returns the seat number. */
function sit(table: TournamentTable, userId: string, random: Random): number {
  const empty = table.seats.flatMap((s, i) => (s === null ? [i] : []));
  if (empty.length === 0) throw new Error(`Table ${table.number} is full`);
  const i = pick(empty, random);
  table.seats[i] = userId;
  return i + 1;
}

const count = (table: TournamentTable) => seatedPlayers(table).length;
const hasEmptySeat = (table: TournamentTable) => table.seats.includes(null);

function shortest(tables: TournamentTable[]): TournamentTable[] {
  const min = Math.min(...tables.map(count));
  return tables.filter(t => count(t) === min);
}

function longest(tables: TournamentTable[]): TournamentTable[] {
  const max = Math.max(...tables.map(count));
  return tables.filter(t => count(t) === max);
}

function pick<T>(items: T[], random: Random): T {
  return items[Math.floor(random() * items.length)];
}

function shuffle<T>(items: T[], random: Random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
