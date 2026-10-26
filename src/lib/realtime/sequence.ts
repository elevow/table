// Sequence number generator for event ordering
// Persist the map on the global object so it survives Next.js hot reloads/dev server restarts
const GLOBAL_SEQ_KEY = '__TABLE_SEQUENCE_MAP__';
type SeqStore = Map<string, number>;

const globalStore = globalThis as typeof globalThis & { [GLOBAL_SEQ_KEY]?: SeqStore };

if (!globalStore[GLOBAL_SEQ_KEY]) {
  globalStore[GLOBAL_SEQ_KEY] = new Map<string, number>();
}

const sequences: SeqStore = globalStore[GLOBAL_SEQ_KEY]!;

/**
 * Ordering number for a table broadcast. Clients drop any update numbered below the last one
 * they saw, and requests for one table are served by different server instances that share no
 * memory, so a plain per-instance counter (restarting at 1 on a fresh instance) got whole
 * updates thrown away. The number is the clock in microsecond-sized steps (ms × 1000), kept
 * strictly increasing within an instance, so numbers from any instance sort by time.
 */
export function nextSeq(tableId: string): number {
  const fromClock = Date.now() * 1000;
  const previous = sequences.get(tableId) ?? 0;
  const next = Math.max(fromClock, previous + 1);
  sequences.set(tableId, next);
  return next;
}

export function resetSeq(tableId: string): void {
  sequences.delete(tableId);
}
