import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { UserService } from '../user-service';

const mockManager = {
  createUser: jest.fn(),
  getUserById: jest.fn(),
  getUserByEmail: jest.fn(),
  getUserByUsername: jest.fn(),
  updateUser: jest.fn(),
  searchUsers: jest.fn(),
  upsertAuthToken: jest.fn(),
  findValidToken: jest.fn(),
  deleteToken: jest.fn(),
} as any;

describe('UserService (US-017)', () => {
  let service: UserService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserService(mockManager);
  });

  it('creates password reset token and verifies/consumes it', async () => {
    mockManager.upsertAuthToken.mockResolvedValue({});
    mockManager.findValidToken.mockResolvedValueOnce({ id: 't1' }).mockResolvedValueOnce({ id: 't1' }).mockResolvedValueOnce(null);
    mockManager.deleteToken.mockResolvedValue({});

    const { token, expiresAt } = await service.createPasswordReset('u-1', 1);
    expect(typeof token).toBe('string');
    expect(expiresAt instanceof Date).toBe(true);

    const ok = await service.verifyPasswordReset('u-1', token);
    expect(ok).toBe(true);

    const consumed = await service.consumePasswordReset('u-1', token);
    expect(consumed).toBe(true);

    const notOk = await service.verifyPasswordReset('u-1', token);
    expect(notOk).toBe(false);
  });
});
