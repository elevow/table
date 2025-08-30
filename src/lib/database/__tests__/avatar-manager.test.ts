import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AvatarManager } from '../avatar-manager';

const mockPool = { query: jest.fn() } as any;

describe('AvatarManager (US-018)', () => {
  let manager: AvatarManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new AvatarManager(mockPool);
  });

  it('creates an avatar with variants', async () => {
    (mockPool.query as any).mockResolvedValueOnce({ rows: [{ id: 'a-1', user_id: 'u-1', status: 'pending', original_url: 'http://img/orig.png', variants: { s: 'http://img/s.png' }, version: 1, created_at: new Date() }] });
    const avatar = await manager.createAvatar({ userId: 'u-1', originalUrl: 'http://img/orig.png', variants: { s: 'http://img/s.png' } });
    expect(avatar.id).toBe('a-1');
    expect(avatar.variants.s).toContain('s.png');
  });

  it('updates status to approved with moderator info', async () => {
    // updateAvatar
    (mockPool.query as any).mockResolvedValueOnce({ rows: [{ id: 'a-1', user_id: 'u-1', status: 'approved', original_url: 'http://img/orig.png', variants: { s: 'http://img/s.png' }, version: 1, created_at: new Date(), moderated_at: new Date(), moderator_id: 'mod-1' }] });
    const res = await manager.updateAvatar('a-1', { status: 'approved', moderatorId: 'mod-1', moderatedAt: new Date() });
    expect(res.status).toBe('approved');
    expect(res.moderatorId).toBe('mod-1');
  });

  it('adds a new version and updates main avatar version', async () => {
    // list current max version
    (mockPool.query as any)
      .mockResolvedValueOnce({ rows: [{ v: 1 }] }) // MAX version
      .mockResolvedValueOnce({ rows: [{ id: 'av-2', avatar_id: 'a-1', version: 2, url: 'http://img/v2.png', created_at: new Date() }] }) // insert version
      .mockResolvedValueOnce({ rows: [] }); // update main avatar
    const v = await manager.addAvatarVersion('a-1', 'http://img/v2.png');
    expect(v.version).toBe(2);
    expect(v.url).toContain('v2.png');
  });

  it('searches avatars with pagination', async () => {
    (mockPool.query as any)
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'a-1', user_id: 'u-1', status: 'pending', original_url: 'http://img/orig.png', variants: { s: 'http://img/s.png' }, version: 1, created_at: new Date() }] });
    const res = await manager.searchAvatars({ status: 'pending' }, 1, 10);
    expect(res.total).toBe(1);
    expect(res.avatars[0].status).toBe('pending');
  });
});
