import { describe, test, expect } from '@jest/globals';
import { SecurityUtilities, PasswordPolicy } from '../security-utilities';

function createUtils(overrides: Partial<PasswordPolicy> = {}) {
  const fakeDP: any = {};
  const fakePool: any = { query: jest.fn() };
  // Use shorter minLength to simplify valid password
  const utils = new SecurityUtilities(fakeDP, fakePool, { minLength: 8, ...overrides } as any);
  return utils;
}

describe('SecurityUtilities branches (lightweight)', () => {
  test('validatePassword flags missing requirements', () => {
    const utils = createUtils({ minLength: 10, requireUppercase: true, requireNumbers: true, requireSpecialChars: true });
    const result = utils.validatePassword('weakpass');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /uppercase/i.test(e))).toBe(true);
    expect(result.errors.some(e => /number/i.test(e))).toBe(true);
    expect(result.errors.some(e => /special/i.test(e))).toBe(true);
    expect(result.errors.some(e => /at least 10/i.test(e))).toBe(true);
  });

  test('validatePassword accepts strong password', () => {
    const utils = createUtils({ minLength: 8 });
    const result = utils.validatePassword('Aa1!good');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('maskSensitiveData: email masking', () => {
    const utils = createUtils();
    const masked = utils.maskSensitiveData('johndoe@example.com', 'email');
    expect(masked).toMatch(/^j\*+e@example\.com$/);
  });

  test('maskSensitiveData: phone masking keeps last 4 digits (contiguous digits)', () => {
    const utils = createUtils();
    const masked = utils.maskSensitiveData('1234567890', 'phone');
    expect(masked).toBe('******7890');
  });

  test('maskSensitiveData: credit card masking', () => {
    const utils = createUtils();
    const masked = utils.maskSensitiveData('4111111111111111', 'credit_card');
    expect(masked.endsWith('1111')).toBe(true);
    expect(masked.slice(0, -4).split('').every(ch => ch === '*')).toBe(true);
  });

  test('maskSensitiveData: default masking branches', () => {
    const utils = createUtils();
    expect(utils.maskSensitiveData('ab', 'name')).toBe('**');
    expect(utils.maskSensitiveData('abcd', 'name')).toBe('a**d');
  });
});
