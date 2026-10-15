import { resolveSessionUserId } from '../session-identity';

const ok = (body: any) => ({ ok: true, json: async () => body });
const unauthorized = () => ({ ok: false, json: async () => ({ authenticated: false }) });

describe('resolveSessionUserId', () => {
  beforeEach(() => localStorage.clear());

  it('returns null without calling the server when there is no auth token', async () => {
    const fetchImpl = jest.fn();
    await expect(resolveSessionUserId({ fetchImpl, retryDelaysMs: [0, 0] })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns the session user ID and sends the token', async () => {
    localStorage.setItem('auth_token', 'tok');
    const fetchImpl = jest.fn().mockResolvedValue(ok({ userId: 'user-1' }));
    await expect(resolveSessionUserId({ fetchImpl, retryDelaysMs: [0, 0] })).resolves.toBe('user-1');
    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/me', { headers: { Authorization: 'Bearer tok' } });
  });

  it('retries a failed check before giving up on the session', async () => {
    localStorage.setItem('auth_token', 'tok');
    const fetchImpl = jest.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok({ userId: 'user-1' }));
    await expect(resolveSessionUserId({ fetchImpl, retryDelaysMs: [0, 0] })).resolves.toBe('user-1');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('returns null when every attempt fails', async () => {
    localStorage.setItem('auth_token', 'tok');
    const fetchImpl = jest.fn().mockResolvedValue(unauthorized());
    await expect(resolveSessionUserId({ fetchImpl, retryDelaysMs: [0, 0] })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
