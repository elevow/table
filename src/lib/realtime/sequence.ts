// Sequence number generator for event ordering
// Persist the map on the global object so it survives Next.js hot reloads/dev server restarts
const GLOBAL_SEQ_KEY = '__TABLE_SEQUENCE_MAP__';
type SeqStore = Map<string, number>;

const globalStore = globalThis as typeof globalThis & { [GLOBAL_SEQ_KEY]?: SeqStore };

if (!globalStore[GLOBAL_SEQ_KEY]) {
  globalStore[GLOBAL_SEQ_KEY] = new Map<string, number>();
}

const sequences: SeqStore = globalStore[GLOBAL_SEQ_KEY]!;

export function nextSeq(tableId: string): number {
  const current = sequences.get(tableId) ?? 0;
  const next = current + 1;
  sequences.set(tableId, next);
  return next;
}

export function resetSeq(tableId: string): void {
  sequences.delete(tableId);
}
