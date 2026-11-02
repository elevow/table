jest.mock('../../database/pool', () => ({ getPool: jest.fn() }));

import { getPool } from '../../database/pool';
import { PgTournamentStore, loadPlayerNames } from '../pg-tournament-store';

const ID = '3f1c2b9a-6a8e-4c1d-9f2e-5b7a1d0c4e21';

const state = (overrides: Record<string, unknown> = {}): any => ({
  id: ID,
  name: 'Weekly',
  status: 'setup',
  createdBy: 'td-1',
  createdAt: 1000,
  updatedAt: 1000,
  registeredPlayers: [],
  ...overrides,
});

function mockPool(rows: any[] = []) {
  const client = {
    query: jest.fn(async (sql: string) => (sql.startsWith('SELECT') ? { rows } : { rows: [] })),
    release: jest.fn(),
  };
  const pool = { query: jest.fn(async () => ({ rows })), connect: jest.fn(async () => client) };
  (getPool as jest.Mock).mockReturnValue(pool);
  return { pool, client };
}

describe('PgTournamentStore', () => {
  const store = new PgTournamentStore();

  test('insert stores the state with its listing columns', async () => {
    const { pool } = mockPool();
    await store.insert(state());
    const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
    expect(sql).toMatch(/INSERT INTO tournaments/);
    expect(params.slice(0, 4)).toEqual([ID, 'Weekly', 'setup', 'td-1']);
    expect(JSON.parse(params[4])).toMatchObject({ id: ID, name: 'Weekly' });
  });

  test('get returns the stored state, and null for unknown or malformed ids', async () => {
    mockPool([{ state: state() }]);
    expect(await store.get(ID)).toMatchObject({ id: ID });

    mockPool([]);
    expect(await store.get(ID)).toBeNull();

    const { pool } = mockPool();
    expect(await store.get('not-a-uuid')).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('update locks the row, applies the change and saves it in one transaction', async () => {
    const { client } = mockPool([{ state: state() }]);
    const result = await store.update(ID, t => {
      t.status = 'running';
      t.updatedAt = 2000;
    });
    expect(result.status).toBe('running');
    const sqls = client.query.mock.calls.map(c => c[0]);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toMatch(/SELECT state FROM tournaments WHERE id = \$1 FOR UPDATE/);
    expect(sqls[2]).toMatch(/UPDATE tournaments SET state/);
    expect(sqls[3]).toBe('COMMIT');
    const params = client.query.mock.calls[2][1];
    expect(params[0]).toBe(ID);
    expect(JSON.parse(params[1]).status).toBe('running');
    expect(params.slice(2)).toEqual(['Weekly', 'running', 2000]);
    expect(client.release).toHaveBeenCalled();
  });

  test('update rolls back and rethrows when the rule fails', async () => {
    const { client } = mockPool([{ state: state() }]);
    await expect(store.update(ID, () => { throw new Error('Registration closed'); })).rejects.toThrow('Registration closed');
    const sqls = client.query.mock.calls.map(c => c[0]);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls.some(s => s.startsWith('UPDATE'))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  test('update of a missing tournament rolls back with not found', async () => {
    const { client } = mockPool([]);
    await expect(store.update(ID, () => {})).rejects.toThrow('Tournament not found');
    expect(client.query.mock.calls.map(c => c[0])).toContain('ROLLBACK');

    const { pool } = mockPool();
    await expect(store.update('nope', () => {})).rejects.toThrow('Tournament not found');
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

describe('loadPlayerNames', () => {
  test('looks up usernames for the ids that are users', async () => {
    const { pool } = mockPool([{ id: ID, username: 'alice' }]);
    expect(await loadPlayerNames([ID, ID, 'not-a-user'])).toEqual({ [ID]: 'alice' });
    expect((pool.query as jest.Mock).mock.calls[0][1]).toEqual([[ID]]);
  });

  test('skips the query when there is nobody to look up', async () => {
    const { pool } = mockPool();
    expect(await loadPlayerNames(['guest-1'])).toEqual({});
    expect(pool.query).not.toHaveBeenCalled();
  });
});
