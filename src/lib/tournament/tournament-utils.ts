import { TournamentConfig, ValidationResult, PayoutTier, BlindLevel } from '../../types/tournament';

export function validateTournamentConfig(cfg: TournamentConfig): ValidationResult {
  const errors: string[] = [];

  if (!cfg.blindLevels?.length) errors.push('At least one blind level is required');
  if (cfg.startingStack <= 0) errors.push('Starting stack must be > 0');
  // Game rooms seat at most 9
  if (cfg.seatsPerTable !== undefined && !(Number.isInteger(cfg.seatsPerTable) && cfg.seatsPerTable >= 2 && cfg.seatsPerTable <= 9)) {
    errors.push('Seats per table must be a whole number from 2 to 9');
  }
  if (cfg.maxPlayers !== undefined && !(Number.isInteger(cfg.maxPlayers) && cfg.maxPlayers >= 2)) {
    errors.push('Max players must be a whole number of at least 2');
  }

  if (cfg.startsAt !== undefined && !(typeof cfg.startsAt === 'number' && Number.isFinite(cfg.startsAt))) {
    errors.push('Start time is not a valid time');
  }
  if (cfg.minPlayers !== undefined) {
    if (!(Number.isInteger(cfg.minPlayers) && cfg.minPlayers >= 2)) errors.push('Minimum players must be a whole number of at least 2');
    else if (cfg.maxPlayers && cfg.minPlayers > cfg.maxPlayers) errors.push('Minimum players cannot be more than the maximum');
  }
  if (cfg.payoutScaling && !(typeof cfg.payoutScaling.paidPercent === 'number' && cfg.payoutScaling.paidPercent >= 1 && cfg.payoutScaling.paidPercent <= 100)) {
    errors.push('The share of the field paid must be from 1 to 100 percent');
  }
  if (cfg.levelControl !== undefined && cfg.levelControl !== 'director' && cfg.levelControl !== 'clock') {
    errors.push('Levels change either when the director says or on the clock');
  }
  if (cfg.reentry?.enabled && !cfg.lateRegistration?.enabled) {
    errors.push('Re-entry needs late registration, which sets how long it lasts');
  }

  // Money
  const isMoney = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (cfg.buyIn !== undefined && !isMoney(cfg.buyIn)) errors.push('Buy-in cannot be negative');
  if (cfg.entryFee !== undefined && !isMoney(cfg.entryFee)) errors.push('Entry fee cannot be negative');
  if (cfg.bounty) {
    if (!(isMoney(cfg.bounty.amount) && cfg.bounty.amount > 0)) errors.push('Bounty must be more than 0');
    if (cfg.bounty.type !== 'standard' && cfg.bounty.type !== 'progressive') errors.push('Bounty type must be standard or progressive');
  }
  for (const [label, extra] of [['Rebuy', cfg.rebuys], ['Add-on', cfg.addOn]] as const) {
    if (!extra?.enabled) continue;
    if (!isMoney(extra.cost)) errors.push(`${label} cost cannot be negative`);
    if (extra.feePercent !== undefined && !(isMoney(extra.feePercent) && extra.feePercent <= 100)) {
      errors.push(`${label} fee must be from 0 to 100 percent`);
    }
  }

  // Blind levels must be strictly increasing by level, with positive blinds and durations
  const seenLevels = new Set<number>();
  let prevLevel = -Infinity;
  for (const lvl of cfg.blindLevels) {
    if (seenLevels.has(lvl.level)) errors.push(`Duplicate blind level: ${lvl.level}`);
    else if (lvl.level < prevLevel) errors.push(`Blind levels must be in order: level ${lvl.level} comes after level ${prevLevel}`);
    seenLevels.add(lvl.level);
    prevLevel = Math.max(prevLevel, lvl.level);
    if (lvl.durationMinutes <= 0) errors.push(`Level ${lvl.level} duration must be > 0`);
    if (lvl.smallBlind <= 0 || lvl.bigBlind <= 0) errors.push(`Level ${lvl.level} blinds must be > 0`);
    if (lvl.bigBlind < lvl.smallBlind) errors.push(`Level ${lvl.level} big blind < small blind`);
    if (lvl.ante !== undefined && lvl.ante < 0) errors.push(`Level ${lvl.level} ante cannot be negative`);
  }

  // Payouts must be sane
  if (!cfg.payoutStructure?.length) {
    errors.push('Payout structure must not be empty');
  } else {
    // The whole prize pool is paid out; the house's share is the entry fee
    const totalPct = cfg.payoutStructure.reduce((sum, t) => sum + t.percentage, 0);
    if (Math.abs(totalPct - 100) > 0.0001) errors.push(`Payout percentages must add up to 100 (they add up to ${Math.round(totalPct * 100) / 100})`);
    const seenPlaces = new Set<number>();
    for (const tier of cfg.payoutStructure) {
      if (tier.place <= 0) errors.push(`Invalid payout place: ${tier.place}`);
      if (tier.percentage <= 0) errors.push(`Invalid payout percentage for place ${tier.place}`);
      if (seenPlaces.has(tier.place)) errors.push(`Duplicate payout place: ${tier.place}`);
      seenPlaces.add(tier.place);
    }
  }

  // Breaks come between levels, so each follows a level that isn't the last
  const lastLevel = cfg.blindLevels?.length ? cfg.blindLevels[cfg.blindLevels.length - 1].level : undefined;
  const breakLevels = new Set<number>();
  for (const brk of cfg.breaks || []) {
    if (brk.afterLevel < 0) errors.push('Break afterLevel cannot be negative');
    else if (!seenLevels.has(brk.afterLevel) || brk.afterLevel === lastLevel) {
      errors.push(`Break after level ${brk.afterLevel} must follow a level before the last one`);
    }
    if (breakLevels.has(brk.afterLevel)) errors.push(`Duplicate break after level ${brk.afterLevel}`);
    breakLevels.add(brk.afterLevel);
    if (brk.durationMinutes <= 0) errors.push('Break duration must be > 0');
  }
  const rebuyUntil = cfg.rebuys?.enabled ? cfg.rebuys.availableUntilLevel : undefined;
  if (rebuyUntil !== undefined && rebuyUntil !== null && !seenLevels.has(rebuyUntil)) {
    errors.push(`Rebuys are set to end after level ${rebuyUntil}, which isn't in the schedule`);
  }
  const addOnAt = cfg.addOn?.enabled ? cfg.addOn.availableAtBreakAfterLevel : undefined;
  if (cfg.addOn?.enabled && (addOnAt === undefined || addOnAt === null)) {
    errors.push('Choose the break the add-on is offered at');
  } else if (addOnAt !== undefined && addOnAt !== null && !breakLevels.has(addOnAt)) {
    errors.push(`Add-on is set for the break after level ${addOnAt}, but there is no break then`);
  }

  // Late registration constraints
  if (cfg.lateRegistration.enabled) {
    if (cfg.lateRegistration.endLevel <= 0) errors.push('Late reg endLevel must be > 0 when enabled');
    const maxLevel = Math.max(...cfg.blindLevels.map(b => b.level));
    if (cfg.lateRegistration.endLevel > maxLevel) errors.push('Late reg endLevel exceeds last blind level');
    if (cfg.lateRegistration.endTime <= 0) errors.push('Late reg endTime must be > 0 when enabled');
  }

  return { valid: errors.length === 0, errors };
}

export function buildPayouts(prizePool: number, payoutStructure: PayoutTier[]): { place: number; amount: number }[] {
  if (prizePool < 0) throw new Error('Prize pool cannot be negative');
  const totalPct = payoutStructure.reduce((s, t) => s + t.percentage, 0) || 1;
  // Normalize to avoid floating point drift if sum != 100
  const norm = 100 / totalPct;
  const payouts = payoutStructure
    .slice()
    .sort((a, b) => a.place - b.place)
    .map(t => ({ place: t.place, amount: round2(prizePool * (t.percentage * norm / 100)) }));

  // Adjust rounding residual to the top place if any
  const sum = round2(payouts.reduce((s, p) => s + p.amount, 0));
  const delta = round2(prizePool - sum);
  if (Math.abs(delta) >= 0.01) {
    payouts[0].amount = round2(payouts[0].amount + delta);
  }
  return payouts;
}

export function createDefaultFreezeoutConfig(): TournamentConfig {
  const blindLevels: BlindLevel[] = [
    { level: 1, durationMinutes: 12, smallBlind: 100, bigBlind: 200 },
    { level: 2, durationMinutes: 12, smallBlind: 200, bigBlind: 400 },
    { level: 3, durationMinutes: 12, smallBlind: 300, bigBlind: 600, ante: 75 },
    { level: 4, durationMinutes: 12, smallBlind: 400, bigBlind: 800, ante: 100 },
  ];
  return {
    type: 'freezeout',
    blindLevels,
    startingStack: 20000,
    payoutStructure: [
      { place: 1, percentage: 50 },
      { place: 2, percentage: 30 },
      { place: 3, percentage: 20 },
    ],
    breaks: [{ afterLevel: 2, durationMinutes: 10 }],
    lateRegistration: { enabled: true, endLevel: 4, endTime: 45 },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Additional presets
export function createTurboFreezeoutConfig(): TournamentConfig {
  const blindLevels: BlindLevel[] = [
    { level: 1, durationMinutes: 8, smallBlind: 100, bigBlind: 200 },
    { level: 2, durationMinutes: 8, smallBlind: 200, bigBlind: 400 },
    { level: 3, durationMinutes: 8, smallBlind: 300, bigBlind: 600, ante: 75 },
    { level: 4, durationMinutes: 8, smallBlind: 500, bigBlind: 1000, ante: 100 },
    { level: 5, durationMinutes: 8, smallBlind: 800, bigBlind: 1600, ante: 200 },
  ];
  return {
    type: 'freezeout',
    blindLevels,
    startingStack: 15000,
    payoutStructure: [
      { place: 1, percentage: 55 },
      { place: 2, percentage: 30 },
      { place: 3, percentage: 15 },
    ],
    breaks: [{ afterLevel: 3, durationMinutes: 8 }],
    lateRegistration: { enabled: true, endLevel: 5, endTime: 40 },
  };
}

export function createHyperFreezeoutConfig(): TournamentConfig {
  const blindLevels: BlindLevel[] = [
    { level: 1, durationMinutes: 5, smallBlind: 100, bigBlind: 200 },
    { level: 2, durationMinutes: 5, smallBlind: 250, bigBlind: 500 },
    { level: 3, durationMinutes: 5, smallBlind: 500, bigBlind: 1000, ante: 100 },
    { level: 4, durationMinutes: 5, smallBlind: 1000, bigBlind: 2000, ante: 200 },
  ];
  return {
    type: 'freezeout',
    blindLevels,
    startingStack: 10000,
    payoutStructure: [
      { place: 1, percentage: 60 },
      { place: 2, percentage: 25 },
      { place: 3, percentage: 15 },
    ],
    breaks: [],
    lateRegistration: { enabled: true, endLevel: 3, endTime: 20 },
  };
}

export function createRebuyAddOnConfig(): TournamentConfig {
  const blindLevels: BlindLevel[] = [
    { level: 1, durationMinutes: 12, smallBlind: 100, bigBlind: 200 },
    { level: 2, durationMinutes: 12, smallBlind: 200, bigBlind: 400 },
    { level: 3, durationMinutes: 12, smallBlind: 300, bigBlind: 600, ante: 75 },
    { level: 4, durationMinutes: 12, smallBlind: 400, bigBlind: 800, ante: 100 },
    { level: 5, durationMinutes: 12, smallBlind: 600, bigBlind: 1200, ante: 150 },
  ];
  return {
    type: 'rebuy',
    blindLevels,
    startingStack: 20000,
    buyIn: 50,
    payoutStructure: [
      { place: 1, percentage: 45 },
      { place: 2, percentage: 28 },
      { place: 3, percentage: 17 },
      { place: 4, percentage: 10 },
    ],
    breaks: [{ afterLevel: 3, durationMinutes: 10 }],
    lateRegistration: { enabled: true, endLevel: 5, endTime: 60 },
    rebuys: { enabled: true, maxPerPlayer: 2, availableUntilLevel: 4, cost: 50, stack: 20000, feePercent: 10 },
    addOn: { enabled: true, availableAtBreakAfterLevel: 3, cost: 60, stack: 30000, feePercent: 10 },
  };
}

export const tournamentPresets: Record<string, { name: string; description: string; build: () => TournamentConfig }>
  = {
    freezeout_default: { name: 'Freezeout (Standard)', description: '12-min levels, 20K stack, 3-place payouts', build: createDefaultFreezeoutConfig },
    freezeout_turbo: { name: 'Freezeout (Turbo)', description: '8-min levels, 15K stack, faster pace', build: createTurboFreezeoutConfig },
    freezeout_hyper: { name: 'Freezeout (Hyper)', description: '5-min levels, 10K stack, very fast', build: createHyperFreezeoutConfig },
    rebuy_addon: { name: 'Rebuy + Add-on', description: 'Rebuys until L4, add-on at first break', build: createRebuyAddOnConfig },
  };

/**
 * Payout percentages for a field: the top `paidPercent` of entries are paid (at least one place),
 * on a curve where each place pays more than the one below it, 1st the most. Percentages are
 * rounded to hundredths and add up to exactly 100.
 */
export function scaledPayoutStructure(entries: number, paidPercent: number): PayoutTier[] {
  const places = Math.max(1, Math.min(Math.max(entries, 1), Math.round((entries * paidPercent) / 100)));
  const weights = Array.from({ length: places }, (_, i) => (places - i) ** 1.5);
  const total = weights.reduce((a, b) => a + b, 0);
  const tiers = weights.map((w, i) => ({ place: i + 1, percentage: Math.round((w / total) * 10000) / 100 }));
  const residual = Math.round((100 - tiers.reduce((sum, t) => sum + t.percentage, 0)) * 100) / 100;
  tiers[0].percentage = Math.round((tiers[0].percentage + residual) * 100) / 100;
  return tiers;
}
