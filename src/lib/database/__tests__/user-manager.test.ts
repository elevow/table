import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { UserManager } from '../user-manager';

const mockPool = {
  connect: jest.fn(),
  query: jest.fn(),
} as any;

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

jest.mock('uuid', () => ({ v4: () => 'u-1' }));

describe('UserManager (US-017)', () => {
  let manager: UserManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    manager = new UserManager(mockPool);
  });

  it('creates a user with unique email and username', async () => {
    (mockClient.query as unknown as jest.Mock).mockImplementation((q: any) => {
      if (q.includes('BEGIN')) return Promise.resolve({});
      if (q.includes('SELECT id FROM public.users WHERE email')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT id FROM public.users WHERE username')) return Promise.resolve({ rows: [] });
      if (q.includes('INSERT INTO public.users')) return Promise.resolve({ rows: [{ id: 'u-1', email: 'a@b.com', username: 'alice', created_at: new Date(), is_verified: false }] });
      if (q.includes('COMMIT')) return Promise.resolve({});
      return Promise.resolve({ rows: [] });
    });

    const user = await manager.createUser({ email: 'a@b.com', username: 'alice' });
    expect(user.id).toBe('u-1');
    expect(user.email).toBe('a@b.com');
    expect(user.username).toBe('alice');
  });

  it('rejects duplicate email', async () => {
    (mockClient.query as unknown as jest.Mock).mockImplementation((q: any) => {
      if (q.includes('BEGIN')) return Promise.resolve({});
      if (q.includes('SELECT id FROM public.users WHERE email')) return Promise.resolve({ rows: [{ id: 'u-x' }] });
      return Promise.resolve({ rows: [] });
    });
    await expect(manager.createUser({ email: 'a@b.com', username: 'alice' } as any)).rejects.toMatchObject({ code: 'EMAIL_EXISTS' });
  });

  it('updates a user metadata and verification', async () => {
    mockPool.query = jest.fn();
    (mockPool.query as any).mockImplementationOnce(() => Promise.resolve({ rows: [{ id: 'u-1', email: 'a@b.com', username: 'alice', created_at: new Date(), is_verified: true, metadata: { a: 1 } }] }));
    const user = await manager.updateUser('u-1', { isVerified: true, metadata: { a: 1 } });
    expect(user.isVerified).toBe(true);
  });

  it('searches users with pagination', async () => {
    mockPool.query = jest.fn();
    (mockPool.query as any)
      .mockImplementationOnce(() => Promise.resolve({ rows: [{ total: '1' }] }))
      .mockImplementationOnce(() => Promise.resolve({ rows: [{ id: 'u-1', email: 'a@b.com', username: 'alice', created_at: new Date(), is_verified: false }] }));
    const res = await manager.searchUsers({ email: 'a@' }, { page: 1, limit: 10 });
    expect(res.total).toBe(1);
    expect(res.users[0].username).toBe('alice');
  });
});
