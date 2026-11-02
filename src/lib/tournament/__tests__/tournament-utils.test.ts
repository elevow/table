import { validateTournamentConfig, buildPayouts, createDefaultFreezeoutConfig, createRebuyAddOnConfig, tournamentPresets } from '../tournament-utils';
import type { TournamentConfig } from '../../../types/tournament';

describe('US-057 Tournament Structure', () => {
  it('validates a correct tournament config', () => {
    const cfg: TournamentConfig = createDefaultFreezeoutConfig();
    const res = validateTournamentConfig(cfg);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('flags invalid blind levels, payouts, and late reg', () => {
    const cfg: TournamentConfig = {
      type: 'rebuy',
      blindLevels: [
        { level: 1, durationMinutes: 0, smallBlind: 100, bigBlind: 50 }, // invalid duration and blinds
        { level: 1, durationMinutes: 10, smallBlind: 100, bigBlind: 200 }, // duplicate level
      ],
      startingStack: 0,
      payoutStructure: [
        { place: 0, percentage: -5 },
        { place: 1, percentage: 105 },
        { place: 1, percentage: 10 }, // duplicate place
      ],
      breaks: [{ afterLevel: -1, durationMinutes: 0 }],
      lateRegistration: { enabled: true, endLevel: 99, endTime: 0 },
    };

    const res = validateTournamentConfig(cfg);
    expect(res.valid).toBe(false);
    expect(res.errors.join('\n')).toMatch(/Starting stack must be > 0/);
    expect(res.errors.join('\n')).toMatch(/duration must be > 0/);
    expect(res.errors.join('\n')).toMatch(/big blind < small blind/);
    expect(res.errors.join('\n')).toMatch(/Duplicate blind level/);
    expect(res.errors.join('\n')).toMatch(/Payout structure must not be empty|Payout percentages/);
    expect(res.errors.join('\n')).toMatch(/Invalid payout place/);
    expect(res.errors.join('\n')).toMatch(/Invalid payout percentage/);
    expect(res.errors.join('\n')).toMatch(/Duplicate payout place/);
    expect(res.errors.join('\n')).toMatch(/Break afterLevel cannot be negative/);
    expect(res.errors.join('\n')).toMatch(/Break duration must be > 0/);
    expect(res.errors.join('\n')).toMatch(/Late reg endLevel exceeds last blind level/);
    expect(res.errors.join('\n')).toMatch(/Late reg endTime must be > 0/);
  });

  it('builds payouts summing to prize pool with rounding fix', () => {
    const payouts = buildPayouts(1000, [
      { place: 1, percentage: 50 },
      { place: 2, percentage: 30 },
      { place: 3, percentage: 20 },
    ]);

    const total = payouts.reduce((s, p) => s + p.amount, 0);
    expect(total).toBeCloseTo(1000, 2);
    expect(payouts[0].place).toBe(1);
    expect(payouts[0].amount).toBeGreaterThanOrEqual(payouts[1].amount);
  });
});

describe('seating config validation', () => {
  const base = () => createDefaultFreezeoutConfig();

  test.each([1, 10, 6.5])('rejects seatsPerTable %p', seatsPerTable => {
    expect(validateTournamentConfig({ ...base(), seatsPerTable }).errors.join('\n')).toMatch(/Seats per table/);
  });

  test.each([1, 0, 2.5])('rejects maxPlayers %p', maxPlayers => {
    expect(validateTournamentConfig({ ...base(), maxPlayers }).errors.join('\n')).toMatch(/Max players/);
  });

  test('accepts sensible seating settings', () => {
    expect(validateTournamentConfig({ ...base(), seatsPerTable: 6, maxPlayers: 60 }).valid).toBe(true);
  });
});

describe('schedule validation', () => {
  const base = () => createDefaultFreezeoutConfig(); // levels 1-4, break after 2

  test('rejects levels out of order', () => {
    const cfg = base();
    cfg.blindLevels = [cfg.blindLevels[1], cfg.blindLevels[0], ...cfg.blindLevels.slice(2)];
    expect(validateTournamentConfig(cfg).errors.join('\n')).toMatch(/must be in order/);
  });

  test.each([4, 9])('rejects a break after level %i (the last, or none)', afterLevel => {
    expect(validateTournamentConfig({ ...base(), breaks: [{ afterLevel, durationMinutes: 5 }] }).errors.join('\n'))
      .toMatch(/must follow a level before the last one/);
  });

  test('rejects two breaks after the same level', () => {
    const breaks = [{ afterLevel: 2, durationMinutes: 5 }, { afterLevel: 2, durationMinutes: 10 }];
    expect(validateTournamentConfig({ ...base(), breaks }).errors.join('\n')).toMatch(/Duplicate break/);
  });

  test('rejects an add-on at a break that is not scheduled', () => {
    const cfg = { ...base(), addOn: { enabled: true, availableAtBreakAfterLevel: 3, cost: 10, stack: 1000 } };
    expect(validateTournamentConfig(cfg).errors.join('\n')).toMatch(/no break then/);
  });

  test('rejects a rebuy period ending at a level that is not in the schedule', () => {
    const cfg = createRebuyAddOnConfig(); // 5 levels
    cfg.rebuys!.availableUntilLevel = 9;
    expect(validateTournamentConfig(cfg).errors.join('\n')).toMatch(/Rebuys are set to end after level 9/);
    cfg.rebuys!.availableUntilLevel = undefined; // every level
    expect(validateTournamentConfig(cfg).valid).toBe(true);
  });

  test('payout percentages must add up to exactly 100', () => {
    const cfg = base();
    cfg.payoutStructure = [{ place: 1, percentage: 60 }, { place: 2, percentage: 30 }];
    expect(validateTournamentConfig(cfg).errors).toContain('Payout percentages must add up to 100 (they add up to 90)');
  });

  test('checks the money settings', () => {
    const cfg = { ...createRebuyAddOnConfig(), buyIn: -1, entryFee: -2, bounty: { amount: 0, type: 'mystery' as any } };
    cfg.rebuys = { ...cfg.rebuys!, cost: -5 };
    cfg.addOn = { ...cfg.addOn!, feePercent: 120 };
    const errors = validateTournamentConfig(cfg).errors;
    expect(errors).toEqual(expect.arrayContaining([
      'Buy-in cannot be negative',
      'Entry fee cannot be negative',
      'Bounty must be more than 0',
      'Bounty type must be standard or progressive',
      'Rebuy cost cannot be negative',
      'Add-on fee must be from 0 to 100 percent',
    ]));
    expect(validateTournamentConfig({ ...base(), buyIn: 10, entryFee: 1, bounty: { amount: 2, type: 'progressive' } }).valid).toBe(true);
  });

  test('every preset is valid', () => {
    for (const [key, preset] of Object.entries(tournamentPresets)) {
      expect([key, validateTournamentConfig(preset.build()).errors]).toEqual([key, []]);
    }
  });
});
