import { withRlsUserContext } from '../rls-context';

describe('withRlsUserContext', () => {
  it('sets app.current_user_id for the session and runs callback', async () => {
    const queries: any[] = [];
    const mockClient = {
      query: jest.fn((sql: string, params?: any[]) => {
        queries.push({ sql, params });
        return Promise.resolve({ rows: [{ ok: true }] });
      })
    } as any;
    const mockPool = {
      connect: jest.fn().mockResolvedValue({
        query: mockClient.query,
        release: jest.fn()
      })
    } as any;

    const result = await withRlsUserContext(mockPool, { userId: 'user-123' }, async (client) => {
      const res = await client.query('SELECT 1');
      return res.rows[0].ok;
    });

    expect(result).toBe(true);
    expect(queries.map(q => q.sql)).toEqual([
      'BEGIN',
      "SELECT set_config('app.current_user_id', $1, true)",
      'SELECT 1',
      'COMMIT',
    ]);
    expect(queries[1].params).toEqual(['user-123']);
  });

  it('rolls back, releases the connection and rethrows when the callback fails', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const release = jest.fn();
    const mockPool = { connect: jest.fn().mockResolvedValue({ query, release }) } as any;

    await expect(withRlsUserContext(mockPool, { userId: 'user-123' }, async () => {
      throw new Error('query failed');
    })).rejects.toThrow('query failed');

    expect(query.mock.calls.map(c => c[0])).toContain('ROLLBACK');
    expect(query.mock.calls.map(c => c[0])).not.toContain('COMMIT');
    expect(release).toHaveBeenCalled();
  });
});
