import { adminEmails, dataProtectionKey, debugFlags, envFlag, envList, envNumber, envString, runtime, mockDatabaseEnabled } from '../env';

const saved = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

afterEach(() => {
  process.env = { ...saved };
  jest.restoreAllMocks();
});

describe('env parsing', () => {
  test('envString trims and treats blank as unset', () => {
    setEnv({ X_STR: '  hello  ', X_BLANK: '   ', X_UNSET: undefined });
    expect(envString('X_STR')).toBe('hello');
    expect(envString('X_BLANK')).toBeUndefined();
    expect(envString('X_UNSET', 'fallback')).toBe('fallback');
  });

  test.each([
    ['1', true], ['true', true], ['TRUE', true], ['yes', true], ['on', true],
    ['0', false], ['false', false], ['', false], [undefined, false], ['maybe', false],
  ])('envFlag(%p) is %p', (value, expected) => {
    setEnv({ X_FLAG: value as string | undefined });
    expect(envFlag('X_FLAG')).toBe(expected);
  });

  test('envNumber falls back for unset, blank and non-numbers', () => {
    setEnv({ X_NUM: '42', X_BAD: 'abc', X_BLANK: '', X_UNSET: undefined });
    expect(envNumber('X_NUM', 1)).toBe(42);
    expect(envNumber('X_BAD', 1)).toBe(1);
    expect(envNumber('X_BLANK', 1)).toBe(1);
    expect(envNumber('X_UNSET', 1)).toBe(1);
  });

  test('envList splits on commas and drops empty entries', () => {
    setEnv({ X_LIST: ' a, b ,,c ,' });
    expect(envList('X_LIST')).toEqual(['a', 'b', 'c']);
    setEnv({ X_LIST: undefined });
    expect(envList('X_LIST')).toEqual([]);
  });

  test('values are read on use, not at import', () => {
    setEnv({ DEBUG_POKER: undefined });
    expect(debugFlags.poker).toBe(false);
    setEnv({ DEBUG_POKER: 'true' });
    expect(debugFlags.poker).toBe(true);
  });
});

describe('settings', () => {
  test('runtime reflects NODE_ENV and CI', () => {
    setEnv({ NODE_ENV: 'production', CI: undefined });
    expect(runtime.isProduction).toBe(true);
    expect(runtime.isCI).toBe(false);
    setEnv({ NODE_ENV: 'test', CI: 'true' });
    expect(runtime.isTest).toBe(true);
    expect(runtime.isCI).toBe(true);
  });

  test('AUTO_RUNOUT_DEBUG is on for any value', () => {
    setEnv({ AUTO_RUNOUT_DEBUG: '1' });
    expect(debugFlags.autoRunout).toBe(true);
    setEnv({ AUTO_RUNOUT_DEBUG: undefined });
    expect(debugFlags.autoRunout).toBe(false);
  });

  test('adminEmails lower-cases each entry', () => {
    setEnv({ ADMIN_EMAILS: 'Boss@Example.com, ops@example.com' });
    expect(adminEmails()).toEqual(['boss@example.com', 'ops@example.com']);
  });

  test('mockDatabaseEnabled in tests or with USE_MOCK_DB', () => {
    setEnv({ NODE_ENV: 'production', USE_MOCK_DB: undefined });
    expect(mockDatabaseEnabled()).toBe(false);
    setEnv({ USE_MOCK_DB: 'true' });
    expect(mockDatabaseEnabled()).toBe(true);
  });

  test('dataProtectionKey uses DATA_PROTECTION_KEY, and complains in production without it', () => {
    setEnv({ DATA_PROTECTION_KEY: 'secret-key' });
    expect(dataProtectionKey()).toBe('secret-key');

    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    setEnv({ DATA_PROTECTION_KEY: undefined, NODE_ENV: 'production' });
    expect(dataProtectionKey()).toBe('default-key-change-in-production');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('DATA_PROTECTION_KEY is not set'));
  });
});
