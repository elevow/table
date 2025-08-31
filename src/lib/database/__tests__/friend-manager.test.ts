import { describe, it, beforeEach, expect, jest } from '@jest/globals';
import { FriendManager } from '../friend-manager';

const mockPool = {
  query: jest.fn(),
} as any;

describe('FriendManager (US-019)', () => {
  let mgr: FriendManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mgr = new FriendManager(mockPool);
  });

  it('sends a friend request when none exists and not blocked', async () => {
    (mockPool.query as jest.Mock)
      // block check
      .mockImplementationOnce(async () => ({ rows: [] }))
      // existing check
      .mockImplementationOnce(async () => ({ rows: [] }))
      // insert
      .mockImplementationOnce(async () => ({ rows: [{ id: 'fr-1', user_id: 'u-1', friend_id: 'u-2', status: 'pending', created_at: new Date(), updated_at: new Date() }] }));

    const res = await mgr.sendRequest({ requesterId: 'u-1', recipientId: 'u-2' });
    expect(res.status).toBe('pending');
  });

  it('prevents sending when blocked either way', async () => {
    (mockPool.query as jest.Mock)
      .mockImplementationOnce(async () => ({ rows: [{ x: 1 }] })); // block check
    await expect(mgr.sendRequest({ requesterId: 'u-1', recipientId: 'u-2' })).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('prevents duplicate pending', async () => {
    (mockPool.query as jest.Mock)
      .mockImplementationOnce(async () => ({ rows: [] })) // block
      .mockImplementationOnce(async () => ({ rows: [{ id: 'fr-1', user_id: 'u-1', friend_id: 'u-2', status: 'pending' }] })); // existing
    await expect(mgr.sendRequest({ requesterId: 'u-1', recipientId: 'u-2' })).rejects.toMatchObject({ code: 'DUPLICATE' });
  });

  it('rejects self friend request', async () => {
    await expect(mgr.sendRequest({ requesterId: 'u-1', recipientId: 'u-1' })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('updates declined to pending on resubmit', async () => {
    (mockPool.query as jest.Mock)
      .mockImplementationOnce(async () => ({ rows: [] })) // block
      .mockImplementationOnce(async () => ({ rows: [{ id: 'fr-1', user_id: 'u-1', friend_id: 'u-2', status: 'declined' }] })) // existing
      .mockImplementationOnce(async () => ({ rows: [{ id: 'fr-1', user_id: 'u-1', friend_id: 'u-2', status: 'pending', created_at: new Date(), updated_at: new Date() }] })); // update
    const res = await mgr.sendRequest({ requesterId: 'u-1', recipientId: 'u-2' });
    expect(res.status).toBe('pending');
  });

  it('prevents sending when already friends', async () => {
    (mockPool.query as jest.Mock)
      .mockImplementationOnce(async () => ({ rows: [] })) // block
      .mockImplementationOnce(async () => ({ rows: [{ id: 'fr-1', user_id: 'u-1', friend_id: 'u-2', status: 'accepted' }] })); // existing accepted
    await expect(mgr.sendRequest({ requesterId: 'u-1', recipientId: 'u-2' })).rejects.toMatchObject({ code: 'ALREADY_FRIENDS' });
  });

  it('responds to request accept/decline', async () => {
    (mockPool.query as jest.Mock)
      .mockImplementationOnce(async () => ({ rows: [{ id: 'fr-1', user_id: 'u-1', friend_id: 'u-2', status: 'accepted', created_at: new Date(), updated_at: new Date() }] }));
    const accepted = await mgr.respondToRequest('fr-1', true);
    expect(accepted.status).toBe('accepted');
  });

  it('responds to non-existent request throws NOT_FOUND', async () => {
    (mockPool.query as jest.Mock)
      .mockImplementationOnce(async () => ({ rows: [] }));
    await expect(mgr.respondToRequest('missing', true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists friends and pending with pagination', async () => {
    (mockPool.query as jest.Mock)
      // friends count
      .mockImplementationOnce(async () => ({ rows: [{ total: '1' }] }))
      // friends list
      .mockImplementationOnce(async () => ({ rows: [{ id: 'fr-1', user_id: 'u-1', friend_id: 'u-2', status: 'accepted', created_at: new Date(), updated_at: new Date() }] }))
      // pending count
      .mockImplementationOnce(async () => ({ rows: [{ total: '1' }] }))
      // pending list
      .mockImplementationOnce(async () => ({ rows: [{ id: 'fr-2', user_id: 'u-2', friend_id: 'u-1', status: 'pending', created_at: new Date(), updated_at: new Date() }] }));

    const friends = await mgr.listFriends('u-1', 1, 10);
    expect(friends.total).toBe(1);
    const pending = await mgr.listPending('u-1', 1, 10);
    expect(pending.items[0].status).toBe('pending');
  });

  it('blocks then unfriends and can unblock', async () => {
    (mockPool.query as jest.Mock)
      // block insert
      .mockImplementationOnce(async () => ({ rows: [{ id: 'b-1', user_id: 'u-1', blocked_id: 'u-2', reason: 'spam', created_at: new Date() }] }))
      // unfriend delete
      .mockImplementationOnce(async () => ({ rows: [] }))
      // unblock delete
      .mockImplementationOnce(async () => ({ rows: [] }));

    const block = await mgr.block('u-1', 'u-2', 'spam');
    expect(block.userId).toBe('u-1');
    await mgr.unblock('u-1', 'u-2');
    expect((mockPool.query as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  it('lists friends when count missing uses zero', async () => {
    (mockPool.query as jest.Mock)
      // friends count returns no rows -> triggers fallback branch
      .mockImplementationOnce(async () => ({ rows: [] }))
      // friends list empty
      .mockImplementationOnce(async () => ({ rows: [] }));
    const res = await mgr.listFriends('u-1', 1, 10);
    expect(res.total).toBe(0);
    expect(res.items).toHaveLength(0);
  });

  it('lists pending when count missing uses zero', async () => {
    (mockPool.query as jest.Mock)
      // pending count returns no rows -> triggers fallback
      .mockImplementationOnce(async () => ({ rows: [] }))
      // pending list empty
      .mockImplementationOnce(async () => ({ rows: [] }));
    const res = await mgr.listPending('u-1', 1, 10);
    expect(res.total).toBe(0);
    expect(res.items).toHaveLength(0);
  });

  it('block with no reason stores null reason', async () => {
    (mockPool.query as jest.Mock)
      // block insert with null reason
      .mockImplementationOnce(async () => ({ rows: [{ id: 'b-2', user_id: 'u-1', blocked_id: 'u-3', reason: null, created_at: new Date() }] }))
      // unfriend delete
      .mockImplementationOnce(async () => ({ rows: [] }));
    const block = await mgr.block('u-1', 'u-3');
    expect(block.reason).toBeNull();
  });
});
