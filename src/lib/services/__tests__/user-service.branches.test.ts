import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { UserService } from '../user-service';

describe('UserService branches (US-017)', () => {
  const manager = {
    upsertAuthToken: jest.fn(),
    findValidToken: jest.fn(),
    deleteToken: jest.fn(),
  } as any;

  let service: UserService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserService(manager);
  });

  it('consumePasswordReset returns false when token is invalid', async () => {
    manager.findValidToken.mockResolvedValue(null);

    const result = await service.consumePasswordReset('u-x', 'bad-token');
    expect(result).toBe(false);
    expect(manager.deleteToken).not.toHaveBeenCalled();
  });
});
