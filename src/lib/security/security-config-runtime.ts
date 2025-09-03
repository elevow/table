import type { SecuritySystemConfig } from '../../types';

// In-memory runtime overrides for security config. Not persisted.
let overrides: Partial<SecuritySystemConfig> = {};

export function getSecurityOverrides(): Partial<SecuritySystemConfig> {
  return overrides;
}

export function updateSecurityOverrides(partial: Partial<SecuritySystemConfig>): SecuritySystemConfig | undefined {
  overrides = deepMerge(overrides, partial);
  return undefined;
}

export function clearSecurityOverrides(): void {
  overrides = {};
}

function isObject(v: any): v is Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge<T extends Record<string, any>>(base: Partial<T>, patch: Partial<T>): Partial<T> {
  const out: any = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (isObject(v)) {
      out[k] = deepMerge(isObject(out[k]) ? out[k] : {}, v as any);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}
