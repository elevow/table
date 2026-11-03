import { balanceTables, drawSeats, seatLatePlayer, seatedPlayers, unseatPlayer } from '../tournament-seating';
import type { TournamentTable } from '../../../types/tournament-management';

// Small seeded generator so every run deals the same seats
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const players = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const sizes = (tables: TournamentTable[]) => tables.map(t => seatedPlayers(t).length);

/** A table with the given players in seats 1, 2, ... */
function table(number: number, userIds: string[], maxSeats = 9): TournamentTable {
  const seats: (string | null)[] = Array(maxSeats).fill(null);
  userIds.forEach((u, i) => (seats[i] = u));
  return { id: `t${number}`, number, maxSeats, seats };
}

/** Everyone seated exactly once, as few tables as hold them, sizes within one of each other. */
function expectSeatingRules(tables: TournamentTable[], field: string[], seatsPerTable: number) {
  const seated = tables.flatMap(seatedPlayers);
  expect(seated.sort()).toEqual([...field].sort());
  expect(tables).toHaveLength(Math.ceil(field.length / seatsPerTable));
  expect(Math.max(...sizes(tables)) - Math.min(...sizes(tables))).toBeLessThanOrEqual(1);
  for (const t of tables) expect(t.seats).toHaveLength(seatsPerTable);
}

describe('drawSeats', () => {
  test('uses as few tables as hold the field and fills them evenly', () => {
    const tables = drawSeats(players(20), 9, seeded(1));
    expect(sizes(tables)).toEqual([7, 7, 6]);
    expect(tables.map(t => t.number)).toEqual([1, 2, 3]);
    expectSeatingRules(tables, players(20), 9);
  });

  test.each([[2, 9], [9, 9], [10, 9], [13, 6], [60, 10]])('seats %i players at %i-max by the rules', (n, seatsPerTable) => {
    expectSeatingRules(drawSeats(players(n), seatsPerTable, seeded(n)), players(n), seatsPerTable);
  });

  test('tables and seats are random', () => {
    const a = drawSeats(players(20), 9, seeded(1));
    const b = drawSeats(players(20), 9, seeded(2));
    expect(a.map(t => t.seats)).not.toEqual(b.map(t => t.seats));
    // Players aren't packed into the low seats
    expect(a.some(t => t.seats.indexOf(null) < t.seats.lastIndexOf(seatedPlayers(t).slice(-1)[0]))).toBe(true);
  });

  test('no players means no tables', () => {
    expect(drawSeats([], 9, seeded(1))).toEqual([]);
  });
});

describe('seatLatePlayer', () => {
  test('sits at the shortest table', () => {
    const tables = [table(1, players(7)), table(2, ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'])];
    seatLatePlayer(tables, 'late', 9, seeded(3));
    expect(seatedPlayers(tables[1])).toContain('late');
  });

  test('opens a new table when every seat is taken', () => {
    const tables = [table(1, players(9))];
    seatLatePlayer(tables, 'late', 9, seeded(3));
    expect(tables).toHaveLength(2);
    expect(tables[1]).toMatchObject({ number: 2, maxSeats: 9 });
    expect(seatedPlayers(tables[1])).toEqual(['late']);
  });
});

describe('balanceTables', () => {
  test('moves players from the biggest table to the smallest', () => {
    const { tables, moves } = balanceTables([table(1, players(9)), table(2, ['a', 'b', 'c', 'd', 'e'])], 9, seeded(4));
    expect(sizes(tables)).toEqual([7, 7]);
    expect(moves).toHaveLength(2);
    for (const m of moves) {
      expect(m).toMatchObject({ fromTableId: 't1', toTableId: 't2', reason: 'balance' });
      expect(tables[1].seats[m.seat - 1]).toBe(m.userId);
    }
  });

  test('leaves tables alone when sizes differ by one', () => {
    const before = [table(1, players(7)), table(2, ['a', 'b', 'c', 'd', 'e', 'f'])];
    const { tables, moves } = balanceTables(before, 9, seeded(4));
    expect(moves).toEqual([]);
    expect(sizes(tables)).toEqual([7, 6]);
  });

  test('breaks a table when the rest can hold everyone', () => {
    const { tables, moves } = balanceTables(
      [table(1, ['a', 'b', 'c', 'd']), table(2, ['e', 'f', 'g', 'h']), table(3, ['i', 'j'])],
      9,
      seeded(5)
    );
    expect(tables.map(t => t.number)).toEqual([1, 2]);
    expect(sizes(tables)).toEqual([5, 5]);
    expect(moves.map(m => [m.userId, m.reason]).sort()).toEqual([['i', 'break'], ['j', 'break']]);
  });

  test('breaks the highest-numbered of the shortest tables', () => {
    const { tables } = balanceTables(
      [table(1, ['a', 'b', 'c']), table(2, ['d', 'e', 'f']), table(3, ['g', 'h', 'i'])],
      6,
      seeded(6)
    );
    expect(tables.map(t => t.number)).toEqual([1, 2]);
  });

  test('drops empty tables', () => {
    const { tables } = balanceTables([table(1, ['a', 'b']), table(2, [])], 9, seeded(7));
    expect(tables.map(t => t.number)).toEqual([1]);
  });

  test.each([[50, 9, 11], [37, 6, 12], [24, 10, 13]])(
    'keeps the rules as %i players at %i-max bust to heads-up',
    (n, seatsPerTable, seed) => {
      const random = seeded(seed);
      let field = players(n);
      let tables = drawSeats(field, seatsPerTable, random);
      while (field.length > 2) {
        const out = field[Math.floor(random() * field.length)];
        field = field.filter(p => p !== out);
        unseatPlayer(tables, out);
        tables = balanceTables(tables, seatsPerTable, random).tables;
        expectSeatingRules(tables, field, seatsPerTable);
      }
      expect(tables).toHaveLength(1);
    }
  );
});
