import type { BlindLevel, TournamentConfig } from '../../types/tournament';

/*
 * Edits to a tournament structure for the setup form. Levels are numbered 1..n by position, so
 * adding or removing one renumbers the rest and moves everything that names a level (breaks, the
 * add-on break, the rebuy window, late registration) along with it. Every function returns a new
 * config and leaves the one passed in alone.
 */

/** Renumber a preset's levels 1..n, keeping breaks and other level references on the same levels. */
export function normalizeLevels(cfg: TournamentConfig): TournamentConfig {
  const byOld = new Map(cfg.blindLevels.map((l, i) => [l.level, i + 1]));
  return remapLevels({ ...cfg, blindLevels: cfg.blindLevels.map((l, i) => ({ ...l, level: i + 1 })) }, cfg, level => byOld.get(level) ?? null);
}

/**
 * Add a level after the last with the same length, a big blind about 1.5 times higher and the
 * small blind in the same proportion to it as before (so 400/800 becomes 600/1200).
 */
export function addLevel(cfg: TournamentConfig): TournamentConfig {
  const last = cfg.blindLevels[cfg.blindLevels.length - 1];
  let next: BlindLevel = { level: 1, durationMinutes: 15, smallBlind: 25, bigBlind: 50 };
  if (last) {
    const bigBlind = niceAmount(last.bigBlind * 1.5);
    next = {
      level: last.level + 1,
      durationMinutes: last.durationMinutes,
      smallBlind: last.bigBlind > 0 ? Math.round(bigBlind * (last.smallBlind / last.bigBlind) * 100) / 100 : bigBlind / 2,
      bigBlind,
      ...(last.ante ? { ante: niceAmount(last.ante * 1.5) } : {}),
    };
  }
  return { ...cfg, blindLevels: [...cfg.blindLevels, next] };
}

/** Remove the level at `index`; its break goes with it and later levels move up. */
export function removeLevel(cfg: TournamentConfig, index: number): TournamentConfig {
  const removed = index + 1;
  const blindLevels = cfg.blindLevels.filter((_, i) => i !== index).map((l, i) => ({ ...l, level: i + 1 }));
  return remapLevels({ ...cfg, blindLevels }, cfg, level => (level === removed ? null : level > removed ? level - 1 : level));
}

export function updateLevel(cfg: TournamentConfig, index: number, patch: Partial<Omit<BlindLevel, 'level'>>): TournamentConfig {
  const blindLevels = cfg.blindLevels.map((l, i) => {
    if (i !== index) return l;
    const updated = { ...l, ...patch };
    if (!updated.ante) delete updated.ante;
    return updated;
  });
  return { ...cfg, blindLevels };
}

/** Put a break of `minutes` after a level, or remove it with null. */
export function setBreak(cfg: TournamentConfig, afterLevel: number, minutes: number | null): TournamentConfig {
  const others = cfg.breaks.filter(b => b.afterLevel !== afterLevel);
  const breaks = minutes === null ? others : [...others, { afterLevel, durationMinutes: minutes }];
  breaks.sort((a, b) => a.afterLevel - b.afterLevel);
  const addOn = minutes === null && cfg.addOn?.availableAtBreakAfterLevel === afterLevel
    ? { ...cfg.addOn, availableAtBreakAfterLevel: undefined }
    : cfg.addOn;
  return { ...cfg, breaks, ...(addOn ? { addOn } : {}) };
}

/** Minutes from the start until each level begins, counting the breaks before it. */
export function levelStartMinutes(cfg: TournamentConfig): number[] {
  let elapsed = 0;
  return cfg.blindLevels.map(l => {
    const startsAt = elapsed;
    elapsed += l.durationMinutes + (cfg.breaks.find(b => b.afterLevel === l.level)?.durationMinutes ?? 0);
    return startsAt;
  });
}

/** "0:00", "1:25" */
export function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')}`;
}

export function addPayoutPlace(cfg: TournamentConfig): TournamentConfig {
  const place = cfg.payoutStructure.length + 1;
  return { ...cfg, payoutStructure: [...cfg.payoutStructure, { place, percentage: 0 }] };
}

export function removeLastPayoutPlace(cfg: TournamentConfig): TournamentConfig {
  return { ...cfg, payoutStructure: cfg.payoutStructure.slice(0, -1) };
}

export function setPayoutPercentage(cfg: TournamentConfig, place: number, percentage: number): TournamentConfig {
  return { ...cfg, payoutStructure: cfg.payoutStructure.map(p => (p.place === place ? { ...p, percentage } : p)) };
}

/** Round up to a chip-friendly amount: 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten. */
export function niceAmount(n: number): number {
  if (n <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(n));
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const step = steps.find(s => s * magnitude >= n * 0.97) ?? 10;
  return Math.round(step * magnitude * 100) / 100;
}

/**
 * Carry the level references from `before` over to `next` through `map` (old level -> new level,
 * or null when that level is gone). References past the new last level are pulled back to it.
 */
function remapLevels(next: TournamentConfig, before: TournamentConfig, map: (level: number) => number | null): TournamentConfig {
  const last = next.blindLevels.length;
  const clamp = (level: number) => Math.max(1, Math.min(level, last));
  const breaks = before.breaks
    .map(b => ({ ...b, afterLevel: map(b.afterLevel) }))
    .filter((b): b is { afterLevel: number; durationMinutes: number } => b.afterLevel !== null && b.afterLevel < last);
  const result: TournamentConfig = { ...next, breaks };

  if (before.addOn) {
    const at = before.addOn.availableAtBreakAfterLevel;
    const mapped = at === undefined || at === null ? undefined : map(at) ?? undefined;
    result.addOn = { ...before.addOn, availableAtBreakAfterLevel: mapped !== undefined && breaks.some(b => b.afterLevel === mapped) ? mapped : undefined };
  }
  if (before.rebuys?.availableUntilLevel !== undefined) {
    result.rebuys = { ...before.rebuys, availableUntilLevel: clamp(map(before.rebuys.availableUntilLevel) ?? before.rebuys.availableUntilLevel - 1) };
  }
  if (before.lateRegistration.enabled) {
    result.lateRegistration = { ...before.lateRegistration, endLevel: clamp(map(before.lateRegistration.endLevel) ?? before.lateRegistration.endLevel - 1) };
  }
  return result;
}
