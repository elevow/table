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
    expect(queries[0].sql).toContain('SET LOCAL app.current_user_id');
    expect(queries[0].params?.[0]).toBe('user-123');
    expect(queries[1].sql).toBe('SELECT 1');
  });
});
