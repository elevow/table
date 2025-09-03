// US-063: Simple content filter for chat moderation

const DEFAULT_BLOCKLIST = [
  // Keep lightweight; real impl would be more robust and configurable
  'badword',
  'offensive',
];

export interface FilterResult {
  ok: boolean;
  violations: string[];
}

export function filterMessage(message: string, extraBlocklist: string[] = []): FilterResult {
  const list = [...DEFAULT_BLOCKLIST, ...extraBlocklist]
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  const lower = (message || '').toLowerCase();
  const violations = list.filter((w) => w && lower.includes(w));
  return { ok: violations.length === 0, violations };
}
