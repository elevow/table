import { createSafeAudit, safeAudit } from '../audit';
import type { Pool } from 'pg';

jest.mock('../../database/security-utilities', () => ({
  DataProtectionFactory: {
    createDataProtectionService: jest.fn(),
  },
}));

jest.mock('../../database/rls-context', () => ({
  logAccess: jest.fn(),
}));

const { DataProtectionFactory } = require('../../database/security-utilities');
const { logAccess } = require('../../database/rls-context');

describe('audit helpers', () => {
  const pool = {} as unknown as Pool;
  const userId = 'u-1';
  const resource = 'users';
  const action = 'read';
  const success = true;
  const metadata = { ip: '127.0.0.1' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('createSafeAudit calls DataProtectionFactory and logAccess on success', async () => {
    (DataProtectionFactory.createDataProtectionService as jest.Mock).mockResolvedValue('dp');
    (logAccess as jest.Mock).mockResolvedValue(undefined);

    const audit = createSafeAudit(pool);
    await expect(audit(userId, resource, action, success, metadata)).resolves.toBeUndefined();

    expect(DataProtectionFactory.createDataProtectionService).toHaveBeenCalledTimes(1);
    expect(DataProtectionFactory.createDataProtectionService).toHaveBeenCalledWith(pool);
    expect(logAccess).toHaveBeenCalledTimes(1);
    expect(logAccess).toHaveBeenCalledWith('dp', userId, resource, action, success, metadata);
  });

  it('createSafeAudit swallows errors from DataProtectionFactory', async () => {
    (DataProtectionFactory.createDataProtectionService as jest.Mock).mockRejectedValue(new Error('boom'));

    const audit = createSafeAudit(pool);
    await expect(audit(userId, resource, action, success, metadata)).resolves.toBeUndefined();

    expect(DataProtectionFactory.createDataProtectionService).toHaveBeenCalledTimes(1);
    expect(logAccess).not.toHaveBeenCalled();
  });

  it('createSafeAudit swallows errors from logAccess', async () => {
    (DataProtectionFactory.createDataProtectionService as jest.Mock).mockResolvedValue('dp');
    (logAccess as jest.Mock).mockRejectedValue(new Error('fail'));

    const audit = createSafeAudit(pool);
    await expect(audit(userId, resource, action, success, metadata)).resolves.toBeUndefined();

    expect(DataProtectionFactory.createDataProtectionService).toHaveBeenCalledTimes(1);
    expect(logAccess).toHaveBeenCalledTimes(1);
  });

  it('safeAudit forwards to createSafeAudit (smoke test)', async () => {
    (DataProtectionFactory.createDataProtectionService as jest.Mock).mockResolvedValue('dp');
    (logAccess as jest.Mock).mockResolvedValue(undefined);

    await expect(safeAudit(pool, userId, resource, action, success, metadata)).resolves.toBeUndefined();

    expect(DataProtectionFactory.createDataProtectionService).toHaveBeenCalledTimes(1);
    expect(logAccess).toHaveBeenCalledTimes(1);
  });
});
