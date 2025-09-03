import {
  fetchRelationshipStatus,
  fetchInvites,
  respondToInvite,
  createInvite,
} from '../friends-ui';

// Mock global fetch
const g: any = globalThis as any;

describe('friends-ui client', () => {
  const originalFetch = g.fetch;

  beforeEach(() => {
    g.fetch = jest.fn();
  });

  afterEach(() => {
    g.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('fetchRelationshipStatus success', async () => {
    (g.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ status: 'friends' }) });
    const res = await fetchRelationshipStatus('u1', 'u2');
    expect(res).toEqual({ status: 'friends' });
    expect(g.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/friends\/status\?a=u1&b=u2/),
      expect.objectContaining({ signal: undefined })
    );
  });

  it('fetchRelationshipStatus forwards AbortSignal', async () => {
    (g.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ status: 'none' }) });
    const controller = new AbortController();
    await fetchRelationshipStatus('a', 'b', controller.signal);
    expect(g.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/friends\/status\?a=a&b=b/),
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('fetchRelationshipStatus error path', async () => {
    (g.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
    await expect(fetchRelationshipStatus('u1', 'u2')).rejects.toThrow('Failed to fetch relationship status (500)');
  });

  it('fetchInvites builds query params and returns paginated result', async () => {
    (g.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: 'i1' }], page: 1, limit: 20, total: 1 }) });
    const res = await fetchInvites('u1', 'incoming', 1, 20);
    expect(res.items[0].id).toBe('i1');
    expect(g.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/friends\/invites\?userId=u1&kind=incoming&page=1&limit=20/),
      expect.objectContaining({ signal: undefined })
    );
  });

  it('fetchInvites supports defaults and forwards signal', async () => {
    (g.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ items: [], page: 1, limit: 20, total: 0 }) });
    const controller = new AbortController();
    await fetchInvites('userX', undefined as any, undefined as any, undefined as any, controller.signal);
    expect(g.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/userId=userX&kind=incoming&page=1&limit=20/),
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('fetchInvites error path', async () => {
    (g.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404 });
    await expect(fetchInvites('u1', 'incoming', 2, 10)).rejects.toThrow('Failed to fetch invites (404)');
  });

  it('respondToInvite posts accept action and returns record', async () => {
    (g.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ id: 'i2', status: 'accepted' }) });
    const rec = await respondToInvite('i2', 'accept');
    expect(rec.status).toBe('accepted');
    expect(g.fetch).toHaveBeenCalledWith('/api/friends/invite-respond', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'i2', action: 'accept' }),
    }));
  });

  it('respondToInvite posts decline action error path', async () => {
    (g.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });
    await expect(respondToInvite('i3', 'decline')).rejects.toThrow('Failed to decline invite (403)');
  });

  it('createInvite posts payload and returns record', async () => {
    (g.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ id: 'i4', inviterId: 'u1', inviteeId: 'u2' }) });
    const rec = await createInvite('u1', 'u2', 'room1');
    expect(rec.id).toBe('i4');
    expect(g.fetch).toHaveBeenCalledWith('/api/friends/invite', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviterId: 'u1', inviteeId: 'u2', roomId: 'room1' }),
    }));
  });

  it('createInvite error path', async () => {
    (g.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 422 });
    await expect(createInvite('u1', 'u2', 'roomX')).rejects.toThrow('Failed to create invite (422)');
  });
});
