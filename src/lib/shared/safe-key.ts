/**
 * Whether a key is one that reaches an object's prototype when written to. Writing user input to
 * one of these (`obj[key] = ...`) changes every object in the app, so callers skip them.
 */
export function isUnsafeKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}
