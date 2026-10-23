/**
 * Turn clock settings, shared by the engine (which sets deadlines), the timeout route (which
 * enforces them) and the table page (which counts down and asks the server to enforce).
 */

/** Time every decision gets before the player's time bank starts running. */
export const BASE_TURN_MS = 30_000;

/** Clients wait this long past the deadline before asking the server to enforce it. */
export const TIMEOUT_GRACE_MS = 1_500;

/** A player whose clock runs out this many turns in a row is sat out from the next hand. */
export const TIMEOUTS_BEFORE_SIT_OUT = 2;

/** Clients warn the player once their remaining time drops below this. */
export const LOW_TIME_WARNING_MS = 10_000;
