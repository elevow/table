import { SocialService } from '../social-service';

describe('SocialService', () => {
  const query = jest.fn();
  const pool = { query } as any;
  let svc: SocialService;

  beforeEach(() => {
    jest.resetAllMocks();
    svc = new SocialService(pool);
  });

  it('createShare validates and inserts', async () => {
    const now = new Date();
    query.mockResolvedValueOnce({ rows: [{ id: 's1', user_id: 'u1', kind: 'achievement', ref_id: 'a1', visibility: 'public', message: 'gg', platforms: ['x'], payload: { foo: 1 }, share_slug: 'sluggy', created_at: now }] });
    const rec = await svc.createShare({ userId: 'u1', kind: 'achievement', refId: 'a1', message: 'gg', platforms: ['x'], payload: { foo: 1 }, shareSlug: 'sluggy' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO social_shares'), ['u1', 'achievement', 'a1', 'public', 'gg', ['x'], { foo: 1 }, 'sluggy']);
    expect(rec).toEqual({ id: 's1', userId: 'u1', kind: 'achievement', refId: 'a1', visibility: 'public', message: 'gg', platforms: ['x'], payload: { foo: 1 }, shareSlug: 'sluggy', createdAt: now });
  });

  it('createShare requires userId and kind', async () => {
    await expect(svc.createShare({} as any)).rejects.toThrow('userId is required');
    await expect(svc.createShare({ userId: 'u1' } as any)).rejects.toThrow('kind is required');
  });

  it('recordEngagement upserts and returns count', async () => {
    query.mockResolvedValueOnce({ rows: [{ share_id: 's1', metric: 'like', count: 3 }] });
    const res = await svc.recordEngagement('s1', 'like', 2);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO social_engagement'), ['s1', 'like', 2]);
    expect(res).toEqual({ shareId: 's1', metric: 'like', count: 3 });
  });

  it('recordEngagement validates inputs', async () => {
    await expect(svc.recordEngagement('', 'like')).rejects.toThrow('shareId is required');
    await expect(svc.recordEngagement('s1', '' as any)).rejects.toThrow('metric is required');
  });
});
