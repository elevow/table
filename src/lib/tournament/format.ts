/** $12, $12.50 */
export function formatMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** 4:05, 1:02:09 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 1st, 2nd, 3rd, 11th, 22nd */
export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** "300/600 ante 75" */
export function formatBlinds(l: { smallBlind: number; bigBlind: number; ante: number | null }): string {
  return `${l.smallBlind.toLocaleString()}/${l.bigBlind.toLocaleString()}${l.ante ? ` ante ${l.ante.toLocaleString()}` : ''}`;
}
