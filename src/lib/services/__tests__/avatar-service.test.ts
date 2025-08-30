import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AvatarService } from '../avatar-service';

const mockPool = {} as any;

// Mock AvatarManager inside the service by mocking its module
jest.mock('../../database/avatar-manager', () => {
  return {
    AvatarManager: jest.fn().mockImplementation(() => ({
  createAvatar: jest.fn(async () => ({ id: 'a-1', userId: 'u-1', status: 'pending', originalUrl: 'http://img/orig.png', variants: { s: 'http://img/s.png' }, version: 1, createdAt: new Date() })),
  updateAvatar: jest.fn(async (_id: string, upd: any) => ({ id: 'a-1', userId: 'u-1', status: upd.status, originalUrl: 'http://img/orig.png', variants: { s: 'http://img/s.png' }, version: 1, createdAt: new Date(), moderatedAt: new Date(), moderatorId: upd.moderatorId })),
  addAvatarVersion: jest.fn(async () => ({ id: 'av-2', avatarId: 'a-1', version: 2, url: 'http://img/v2.png', createdAt: new Date() })),
  listVersions: jest.fn(async () => ([{ id: 'av-1', avatarId: 'a-1', version: 1, url: 'http://img/v1.png', createdAt: new Date() }])),
  getLatestAvatarForUser: jest.fn(async () => ({ id: 'a-1', userId: 'u-1', status: 'approved', originalUrl: 'http://img/orig.png', variants: { s: 'http://img/s.png' }, version: 2, createdAt: new Date() })),
  searchAvatars: jest.fn(async () => ({ avatars: [{ id: 'a-1' }], total: 1, page: 1, limit: 10, totalPages: 1 }))
    }))
  };
});

describe('AvatarService (US-018)', () => {
  let service: AvatarService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AvatarService(mockPool as any);
  });

  it('uploads avatar', async () => {
    const res = await service.uploadAvatar({ userId: 'u-1', originalUrl: 'http://img/orig.png', variants: { s: 'http://img/s.png' } });
    expect(res.status).toBe('pending');
  });

  it('approves avatar', async () => {
    const res = await service.approveAvatar('a-1', 'mod-1');
    expect(res.status).toBe('approved');
    expect(res.moderatorId).toBe('mod-1');
  });

  it('rejects avatar', async () => {
    const res = await service.rejectAvatar('a-1', 'mod-1');
    expect(res.status).toBe('rejected');
  });

  it('adds and lists versions', async () => {
    const v = await service.addVersion('a-1', 'http://img/v2.png');
    expect(v.version).toBe(2);
    const list = await service.listVersions('a-1');
    expect(list.length).toBe(1);
  });

  it('gets latest avatar for user', async () => {
    const latest = await service.getLatestForUser('u-1');
    expect(latest?.version).toBe(2);
  });
});
