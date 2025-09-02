import { TournamentConfig, ValidationResult, PayoutTier, BlindLevel } from '../../types/tournament';

export function validateTournamentConfig(cfg: TournamentConfig): ValidationResult {
  const errors: string[] = [];

  if (!cfg.blindLevels?.length) errors.push('At least one blind level is required');
  if (cfg.startingStack <= 0) errors.push('Starting stack must be > 0');

  // Blind levels must be strictly increasing by level, with positive blinds and durations
  const seenLevels = new Set<number>();
  for (const lvl of cfg.blindLevels) {
    if (seenLevels.has(lvl.level)) errors.push(`Duplicate blind level: ${lvl.level}`);
    seenLevels.add(lvl.level);
    if (lvl.durationMinutes <= 0) errors.push(`Level ${lvl.level} duration must be > 0`);
    if (lvl.smallBlind <= 0 || lvl.bigBlind <= 0) errors.push(`Level ${lvl.level} blinds must be > 0`);
    if (lvl.bigBlind < lvl.smallBlind) errors.push(`Level ${lvl.level} big blind < small blind`);
    if (lvl.ante !== undefined && lvl.ante < 0) errors.push(`Level ${lvl.level} ante cannot be negative`);
  }

  // Payouts must be sane
  if (!cfg.payoutStructure?.length) {
    errors.push('Payout structure must not be empty');
  } else {
    const totalPct = cfg.payoutStructure.reduce((sum, t) => sum + t.percentage, 0);
    if (totalPct <= 0 || totalPct > 100.0001) errors.push('Payout percentages must sum to > 0 and <= 100');
    const seenPlaces = new Set<number>();
    for (const tier of cfg.payoutStructure) {
      if (tier.place <= 0) errors.push(`Invalid payout place: ${tier.place}`);
      if (tier.percentage <= 0) errors.push(`Invalid payout percentage for place ${tier.place}`);
      if (seenPlaces.has(tier.place)) errors.push(`Duplicate payout place: ${tier.place}`);
      seenPlaces.add(tier.place);
    }
  }

  // Breaks
  for (const brk of cfg.breaks || []) {
    if (brk.afterLevel < 0) errors.push('Break afterLevel cannot be negative');
    if (brk.durationMinutes <= 0) errors.push('Break duration must be > 0');
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
