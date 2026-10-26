/**
 * Turn clock settings, shared by the engine (which sets deadlines), the timeout route (which
 * enforces them) and the table page (which counts down and asks the server to enforce).
 */

/** Time every decision gets before the player's time bank starts running (unless the table sets its own). */
export const BASE_TURN_MS = 30_000;

/** Table settings the host chooses: limits and defaults. */
export const MIN_TURN_SECONDS = 10;
export const MAX_TURN_SECONDS = 180;
export const DEFAULT_TIME_BANKS = 2;
export const MAX_TIME_BANKS = 20;
export const DEFAULT_TIME_BANK_SECONDS = 30;
export const MIN_TIME_BANK_SECONDS = 5;
export const MAX_TIME_BANK_SECONDS = 120;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Whole number in range, or the fallback when the value is missing or not a number. */
export function clampSetting(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(Math.round(n), lo, hi) : fallback;
}

/** Base time for each decision at this table, in ms. */
export function turnTimeMs(state: { turnTimeMs?: number }): number {
  return typeof state.turnTimeMs === 'number' && state.turnTimeMs > 0 ? state.turnTimeMs : BASE_TURN_MS;
}

/** Length of one time bank at this table, in ms. */
export function timeBankMs(state: { timeBankSeconds?: number }): number {
  const seconds = typeof state.timeBankSeconds === 'number' && state.timeBankSeconds > 0
    ? state.timeBankSeconds
    : DEFAULT_TIME_BANK_SECONDS;
  return seconds * 1000;
}

/**
 * Time-bank time a player has left, in ms. Players carry a count of time banks; games saved
 * before time banks were counted carry seconds in timeBank instead.
 */
export function bankTimeMs(
  player: { timeBanks?: number; timeBank?: number } | undefined,
  state: { timeBankSeconds?: number }
): number {
  if (!player) return 0;
  if (typeof player.timeBanks === 'number') return Math.max(0, player.timeBanks) * timeBankMs(state);
  return Math.max(0, player.timeBank || 0) * 1000;
}

/** Clients wait this long past the deadline before asking the server to enforce it. */
export const TIMEOUT_GRACE_MS = 1_500;

/** A player whose clock runs out this many turns in a row is sat out from the next hand. */
export const TIMEOUTS_BEFORE_SIT_OUT = 2;

/** Clients warn the player once their remaining time drops below this. */
export const LOW_TIME_WARNING_MS = 10_000;
