import { chipUnit, computePresetAmount, nudgeAmount, supportsBetPresets, type BetSizingInput } from '../bet-sizing';

const base: Omit<BetSizingInput, 'preset'> = {
  kind: 'bet',
  pot: 30,
  currentBet: 0,
  myBet: 0,
  min: 2,
  max: 500,
  bigBlind: 2,
};

describe('computePresetAmount', () => {
  describe('bets', () => {
    it('sizes half, two-thirds and full pot bets', () => {
      expect(computePresetAmount({ ...base, preset: 'half' })).toBe(15);
      expect(computePresetAmount({ ...base, preset: 'two-thirds' })).toBe(20);
      expect(computePresetAmount({ ...base, preset: 'pot' })).toBe(30);
    });

    it('rounds to whole chips', () => {
      // 2/3 of 31 = 20.67
      expect(computePresetAmount({ ...base, pot: 31, preset: 'two-thirds' })).toBe(21);
      // 1/2 of 25 = 12.5 rounds up
      expect(computePresetAmount({ ...base, pot: 25, preset: 'half' })).toBe(13);
    });

    it('keeps cents when the blinds are fractional', () => {
      expect(computePresetAmount({ ...base, pot: 1.75, bigBlind: 0.5, min: 0.5, preset: 'two-thirds' })).toBe(1.17);
    });

    it('returns the bounds for min and all-in', () => {
      expect(computePresetAmount({ ...base, preset: 'min' })).toBe(2);
      expect(computePresetAmount({ ...base, preset: 'all-in' })).toBe(500);
    });

    it('never goes below the minimum bet', () => {
      expect(computePresetAmount({ ...base, pot: 3, preset: 'half' })).toBe(2);
    });

    it('caps at the stack', () => {
      expect(computePresetAmount({ ...base, pot: 300, max: 120, preset: 'pot' })).toBe(120);
    });

    it('does not round past a fractional all-in stack', () => {
      expect(computePresetAmount({ ...base, pot: 300, max: 99.5, preset: 'pot' })).toBe(99.5);
    });
  });

  describe('raises', () => {
    const raise: Omit<BetSizingInput, 'preset'> = { ...base, kind: 'raise', pot: 30, currentBet: 10, myBet: 0, min: 20, max: 1000 };

    it('makes a pot-sized raise as call plus the pot after calling', () => {
      // Pot 30 already includes the 10 bet; call 10 -> pot 40; raise by 40 -> total 50
      expect(computePresetAmount({ ...raise, preset: 'pot' })).toBe(50);
    });

    it('scales the raise part by the fraction', () => {
      // 10 + (30 + 10) / 2 = 30
      expect(computePresetAmount({ ...raise, preset: 'half' })).toBe(30);
      // 10 + 40 * 2/3 = 36.67 -> 37
      expect(computePresetAmount({ ...raise, preset: 'two-thirds' })).toBe(37);
    });

    it('accounts for chips the raiser already has in', () => {
      // Big blind facing a raise to 6 with 9 in the pot (1 + 2 + 6): call 4 -> pot 13 -> total 19
      expect(computePresetAmount({ ...raise, pot: 9, currentBet: 6, myBet: 2, min: 10, preset: 'pot' })).toBe(19);
    });

    it('lifts a small fraction to the minimum raise', () => {
      expect(computePresetAmount({ ...raise, pot: 12, currentBet: 10, min: 20, preset: 'half' })).toBe(21);
      expect(computePresetAmount({ ...raise, pot: 10, currentBet: 10, min: 20, preset: 'half' })).toBe(20);
    });

    it('respects a pot-limit maximum', () => {
      // Pot-limit max for this spot is exactly the pot raise
      expect(computePresetAmount({ ...raise, max: 50, preset: 'all-in' })).toBe(50);
      expect(computePresetAmount({ ...raise, max: 45, preset: 'pot' })).toBe(45);
    });

    it('handles a short stack whose all-in is below the minimum raise', () => {
      expect(computePresetAmount({ ...raise, min: 15, max: 15, preset: 'pot' })).toBe(15);
      expect(computePresetAmount({ ...raise, min: 20, max: 15, preset: 'min' })).toBe(15);
    });
  });
});

describe('supportsBetPresets', () => {
  it('allows no-limit (the default) and pot-limit only', () => {
    expect(supportsBetPresets(undefined)).toBe(true);
    expect(supportsBetPresets('no-limit')).toBe(true);
    expect(supportsBetPresets('pot-limit')).toBe(true);
    expect(supportsBetPresets('fixed-limit')).toBe(false);
  });
});

describe('chipUnit', () => {
  it('uses whole chips for whole blinds and cents otherwise', () => {
    expect(chipUnit(2)).toBe(1);
    expect(chipUnit(0.5)).toBe(0.01);
    expect(chipUnit(2.5)).toBe(0.01);
  });
});

describe('nudgeAmount', () => {
  it('moves by one big blind within the bounds', () => {
    expect(nudgeAmount(10, 1, 2, 2, 100)).toBe(12);
    expect(nudgeAmount(10, -1, 2, 2, 100)).toBe(8);
    expect(nudgeAmount(99, 1, 2, 2, 100)).toBe(100);
    expect(nudgeAmount(3, -1, 2, 2, 100)).toBe(2);
  });

  it('starts from the bound when the current value is outside it', () => {
    expect(nudgeAmount(0, 1, 2, 4, 100)).toBe(6);
  });

  it('falls back to the chip size without a big blind', () => {
    expect(nudgeAmount(5, 1, 0, 0, 10)).toBe(5.01);
  });
});
