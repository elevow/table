import { isValidEmail, MAX_EMAIL_LENGTH } from '../email';
import { isUnsafeKey } from '../safe-key';
import { deepMerge } from '../../security/security-config-runtime';
import { DeltaManager } from '../../state-manager/delta';
import { roleKeyFromName } from '../../auth/role-admin';

describe('isValidEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('first.last+tag@mail.example.org')).toBe(true);
  });

  it('rejects malformed addresses and non-strings', () => {
    for (const bad of ['', 'a', 'a@b', 'a@b.', 'a @b.co', 'a@@b.co', '@b.co', 'a@.co', 'a@b..co']) {
      expect(isValidEmail(bad)).toBe(false);
    }
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(42)).toBe(false);
  });

  it('rejects addresses over the length limit', () => {
    const local = 'a'.repeat(MAX_EMAIL_LENGTH);
    expect(isValidEmail(`${local}@b.co`)).toBe(false);
  });

  it('stays fast on input built to make a backtracking regex slow', () => {
    const evil = '!@!.' + '!.'.repeat(50000);
    const start = Date.now();
    isValidEmail(evil);
    isValidEmail(evil.slice(0, MAX_EMAIL_LENGTH));
    expect(Date.now() - start).toBeLessThan(100);
  });
});

describe('unsafe keys', () => {
  afterEach(() => {
    delete (Object.prototype as any).polluted;
  });

  it('flags only the prototype-reaching keys', () => {
    expect(['__proto__', 'constructor', 'prototype'].every(isUnsafeKey)).toBe(true);
    expect(isUnsafeKey('user-123')).toBe(false);
  });

  it('deepMerge ignores __proto__ in a patch', () => {
    const patch = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
    const merged: any = deepMerge({}, patch);
    expect(merged.ok).toBe(1);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('DeltaManager.setValueAtPath ignores paths through __proto__', () => {
    const dm = new DeltaManager();
    const target: any = {};
    dm.setValueAtPath(target, '__proto__.polluted', true);
    dm.setValueAtPath(target, 'constructor.prototype.polluted', true);
    expect(({} as any).polluted).toBeUndefined();
    dm.setValueAtPath(target, 'a.b', 2);
    expect(target.a.b).toBe(2);
  });
});

describe('roleKeyFromName', () => {
  it('keeps the same keys as before', () => {
    expect(roleKeyFromName('Floor Manager')).toBe('floor_manager');
    expect(roleKeyFromName('  --VIP Host!! ')).toBe('vip_host');
    expect(roleKeyFromName('___')).toBe('');
  });

  it('stays fast on long underscore runs', () => {
    const start = Date.now();
    roleKeyFromName('_'.repeat(100000) + '!');
    expect(Date.now() - start).toBeLessThan(100);
  });
});
