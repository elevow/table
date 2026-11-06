import { api, apiRequest, unwrap, ApiRequestError } from '../api-client';

function mockFetchOnce(status: number, body?: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: body === undefined ? () => Promise.reject(new Error('no body')) : () => Promise.resolve(body),
  });
}

describe('api-client', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    localStorage.clear();
  });

  it('sends the session token and encodes query params, dropping empty ones', async () => {
    localStorage.setItem('auth_token', 'tok');
    mockFetchOnce(200, { hello: 'world' });
    const result = await api.get('/api/games/state', { query: { tableId: 'a b&c', playerId: undefined, n: 2 } });
    expect(global.fetch).toHaveBeenCalledWith('/api/games/state?tableId=a+b%26c&n=2', expect.objectContaining({
      method: 'GET',
      headers: { Authorization: 'Bearer tok' },
    }));
    expect(result).toEqual({ ok: true, status: 200, data: { hello: 'world' } });
  });

  it('posts JSON with a content type', async () => {
    mockFetchOnce(200, {});
    await api.post('/api/games/action', { tableId: 't1' });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ tableId: 't1' }));
  });

  it('resolves failures with the body and the server error message', async () => {
    mockFetchOnce(403, { error: 'Private table', code: 'PRIVATE_TABLE' });
    const result = await apiRequest('/api/games/rooms/r1');
    expect(result).toEqual({ ok: false, status: 403, data: { error: 'Private table', code: 'PRIVATE_TABLE' }, error: 'Private table' });
  });

  it('falls back to {} and HTTP <status> when the body is not JSON', async () => {
    mockFetchOnce(502);
    const result = await apiRequest('/api/x');
    expect(result).toEqual({ ok: false, status: 502, data: {}, error: 'HTTP 502' });
  });

  it('unwrap returns data on success and throws ApiRequestError on failure', async () => {
    expect(unwrap({ ok: true, status: 200, data: 5 })).toBe(5);
    expect(() => unwrap({ ok: false, status: 404, data: {}, error: 'Not found' })).toThrow(ApiRequestError);
  });

  it('still rejects on network failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.get('/api/x')).rejects.toThrow('Failed to fetch');
  });
});
