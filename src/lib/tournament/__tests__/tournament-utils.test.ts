import { validateTournamentConfig, buildPayouts, createDefaultFreezeoutConfig } from '../tournament-utils';
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
