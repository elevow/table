import { FriendService } from '../friend-service';
import { FriendManager } from '../../database/friend-manager';

// Mock FriendManager so FriendService delegates to it without touching DB
jest.mock('../../database/friend-manager', () => {
  return {
    FriendManager: jest.fn().mockImplementation(() => ({
      sendRequest: jest.fn(async (_: any) => ({ id: 'fr-1', requesterId: 'u1', recipientId: 'u2', status: 'pending', createdAt: new Date(), updatedAt: new Date() })),
      respondToRequest: jest.fn(async (_id: string, _accept: boolean) => ({ id: 'fr-1', requesterId: 'u1', recipientId: 'u2', status: _accept ? 'accepted' : 'declined', createdAt: new Date(), updatedAt: new Date() })),
      listFriends: jest.fn(async (_userId: string, p: number, l: number) => ({ items: [], total: 0, page: p, limit: l })),
      listPending: jest.fn(async (_userId: string, p: number, l: number) => ({ items: [], total: 0, page: p, limit: l })),
      unfriend: jest.fn(async () => {}),
      block: jest.fn(async (userId: string, blockedId: string, reason?: string) => ({ id: 'b1', userId, blockedId, reason: reason ?? null, createdAt: new Date() })),
      unblock: jest.fn(async () => {}),
    })),
  };
});

describe('FriendService', () => {
  const getManagerInstance = () => (FriendManager as unknown as jest.Mock).mock.results[(FriendManager as unknown as jest.Mock).mock.results.length - 1].value as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates sendRequest and validates IDs', async () => {
    const svc = new FriendService({} as any);
    const mgr = getManagerInstance();

    // Happy path
    const res = await svc.sendRequest('u1', 'u2');
    expect(mgr.sendRequest).toHaveBeenCalledWith({ requesterId: 'u1', recipientId: 'u2' });
    expect(res.status).toBe('pending');

    // Missing requesterId
    await expect(svc.sendRequest('', 'u2')).rejects.toThrow('Missing or invalid requesterId');
    // Missing recipientId
    await expect(svc.sendRequest('u1', '  ')).rejects.toThrow('Missing or invalid recipientId');
  });

  it('respondToRequest maps action to boolean', async () => {
    const svc = new FriendService({} as any);
    const mgr = getManagerInstance();

    await svc.respondToRequest('fr-1', 'accept');
    expect(mgr.respondToRequest).toHaveBeenCalledWith('fr-1', true);

    await svc.respondToRequest('fr-1', 'decline');
    expect(mgr.respondToRequest).toHaveBeenCalledWith('fr-1', false);

    await expect(svc.respondToRequest('  ', 'accept')).rejects.toThrow('Missing or invalid id');
  });

  it('normalizes pagination for listFriends', async () => {
    const svc = new FriendService({} as any);
    const mgr = getManagerInstance();

    // Defaults
    await svc.listFriends('u1');
    expect(mgr.listFriends).toHaveBeenLastCalledWith('u1', 1, 20);

    // Invalid page and limit -> fallback to 1 and 20
    await svc.listFriends('u1', -5 as any, 0 as any);
    expect(mgr.listFriends).toHaveBeenLastCalledWith('u1', 1, 20);

    // Over max limit -> fallback to 20
    await svc.listFriends('u1', 3, 1000);
    expect(mgr.listFriends).toHaveBeenLastCalledWith('u1', 3, 20);
  });

  it('normalizes pagination for listPending', async () => {
    const svc = new FriendService({} as any);
    const mgr = getManagerInstance();

    await svc.listPending('u1', 2, 50);
    expect(mgr.listPending).toHaveBeenLastCalledWith('u1', 2, 50);

    await svc.listPending('u1', 0 as any, -1 as any);
    expect(mgr.listPending).toHaveBeenLastCalledWith('u1', 1, 20);
  });

  it('unfriend, block, and unblock validate and delegate', async () => {
    const svc = new FriendService({} as any);
    const mgr = getManagerInstance();

    await svc.unfriend('a', 'b');
    expect(mgr.unfriend).toHaveBeenCalledWith('a', 'b');

    await expect(svc.unfriend('a', '')).rejects.toThrow('Missing or invalid b');

    const block = await svc.block('u1', 'u2', 'spam');
    expect(mgr.block).toHaveBeenCalledWith('u1', 'u2', 'spam');
    expect(block.reason).toBe('spam');

    await svc.unblock('u1', 'u2');
    expect(mgr.unblock).toHaveBeenCalledWith('u1', 'u2');

    await expect(svc.block('', 'u2')).rejects.toThrow('Missing or invalid userId');
    await expect(svc.unblock('u1', '  ')).rejects.toThrow('Missing or invalid blockedId');
  });
});
