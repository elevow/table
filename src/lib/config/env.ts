/**
 * Settings read from the environment, in one place with consistent parsing.
 *
 * Every value is read when it is used, not when this module loads, so loading .env.local late
 * (see database/pool.ts) and tests that change process.env keep working.
 *
 * Browser code must keep reading NEXT_PUBLIC_* variables as a literal process.env.NEXT_PUBLIC_X:
 * Next.js inlines only those at build time, and a lookup by name here is undefined in the browser.
 * Database settings live in database/pool.ts, email in config/email-config.ts and security
 * thresholds in security/security-config.ts.
 */

/** The variable's value, trimmed; undefined when unset or blank. */
export function envString(name: string): string | undefined;
export function envString(name: string, fallback: string): string;
export function envString(name: string, fallback?: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/** True for 1, true, yes or on (any case); false when unset or anything else. */
export function envFlag(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes((envString(name) || '').toLowerCase());
}

/** The variable as a number, or the fallback when unset, blank or not a number. */
export function envNumber(name: string, fallback: number): number {
  const value = envString(name);
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** A comma-separated variable as a list, trimmed, with empty entries dropped. */
export function envList(name: string): string[] {
  return (envString(name) || '').split(',').map(s => s.trim()).filter(Boolean);
}

export const runtime = {
  get isProduction(): boolean { return process.env.NODE_ENV === 'production'; },
  get isDevelopment(): boolean { return process.env.NODE_ENV === 'development'; },
  get isTest(): boolean { return process.env.NODE_ENV === 'test'; },
  /** Running in CI (CI is set to anything): skip noisy logs and background timers. */
  get isCI(): boolean { return envString('CI') !== undefined; },
};

export const debugFlags = {
  /** DEBUG_POKER: verbose betting and engine logs. */
  get poker(): boolean { return envFlag('DEBUG_POKER'); },
  /** AUTO_RUNOUT_DEBUG (any value): log each step of all-in runouts. */
  get autoRunout(): boolean { return envString('AUTO_RUNOUT_DEBUG') !== undefined; },
};

/** Lower-cased emails in ADMIN_EMAILS, which get every permission. */
export function adminEmails(): string[] {
  return envList('ADMIN_EMAILS').map(e => e.toLowerCase());
}

/** Whether to use the in-memory mock database (tests, or USE_MOCK_DB in CI's e2e run). */
export function mockDatabaseEnabled(): boolean {
  return runtime.isTest || envFlag('USE_MOCK_DB');
}

// Public in this repository, so it protects nothing; only for development and tests
const INSECURE_DEFAULT_DATA_PROTECTION_KEY = 'default-key-change-in-production';
let warnedAboutDataProtectionKey = false;

/** Key material for encrypting sensitive fields (DATA_PROTECTION_KEY). */
export function dataProtectionKey(): string {
  const key = envString('DATA_PROTECTION_KEY');
  if (key) return key;
  if (runtime.isProduction && !warnedAboutDataProtectionKey) {
    warnedAboutDataProtectionKey = true;
    console.error('[config] DATA_PROTECTION_KEY is not set: sensitive fields would be encrypted with a publicly known key.');
  }
  return INSECURE_DEFAULT_DATA_PROTECTION_KEY;
}
