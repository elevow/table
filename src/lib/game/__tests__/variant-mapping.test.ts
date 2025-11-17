import { defaultBettingModeForVariant, resolveVariantAndMode } from '../variant-mapping';

describe('variant-mapping', () => {
  describe('defaultBettingModeForVariant', () => {
    it('should return no-limit for texas-holdem', () => {
      expect(defaultBettingModeForVariant('texas-holdem')).toBe('no-limit');
    });

    it('should return no-limit for dealers-choice', () => {
      expect(defaultBettingModeForVariant('dealers-choice')).toBe('no-limit');
    });

    it('should return pot-limit for omaha', () => {
      expect(defaultBettingModeForVariant('omaha')).toBe('pot-limit');
    });

    it('should return pot-limit for omaha-hi-lo', () => {
      expect(defaultBettingModeForVariant('omaha-hi-lo')).toBe('pot-limit');
    });

    it('should return no-limit for seven-card-stud', () => {
      // Note: Stud games traditionally use limit, but engine only supports no-limit/pot-limit
      expect(defaultBettingModeForVariant('seven-card-stud')).toBe('no-limit');
    });

    it('should return no-limit for seven-card-stud-hi-lo', () => {
      expect(defaultBettingModeForVariant('seven-card-stud-hi-lo')).toBe('no-limit');
    });

    it('should return no-limit for five-card-stud', () => {
      expect(defaultBettingModeForVariant('five-card-stud')).toBe('no-limit');
    });
  });

  describe('resolveVariantAndMode', () => {
    it('should use texas-holdem as default variant', () => {
      const result = resolveVariantAndMode({});
      expect(result.variant).toBe('texas-holdem');
      expect(result.bettingMode).toBe('no-limit');
    });

    it('should use provided variant', () => {
      const result = resolveVariantAndMode({ variant: 'omaha' });
      expect(result.variant).toBe('omaha');
    });

    it('should use default betting mode for variant if not specified', () => {
      const result = resolveVariantAndMode({ variant: 'omaha' });
      expect(result.bettingMode).toBe('pot-limit');
    });

    it('should override default betting mode when specified', () => {
      const result = resolveVariantAndMode({ variant: 'omaha', bettingMode: 'no-limit' });
      expect(result.variant).toBe('omaha');
      expect(result.bettingMode).toBe('no-limit');
    });

    it('should handle texas-holdem explicitly', () => {
      const result = resolveVariantAndMode({ variant: 'texas-holdem' });
      expect(result.variant).toBe('texas-holdem');
      expect(result.bettingMode).toBe('no-limit');
    });

    it('should handle dealers-choice', () => {
      const result = resolveVariantAndMode({ variant: 'dealers-choice' });
      expect(result.variant).toBe('dealers-choice');
      expect(result.bettingMode).toBe('no-limit');
    });

    it('should handle seven-card-stud with default no-limit', () => {
      const result = resolveVariantAndMode({ variant: 'seven-card-stud' });
      expect(result.variant).toBe('seven-card-stud');
      expect(result.bettingMode).toBe('no-limit');
    });

    it('should allow overriding stud betting mode to no-limit', () => {
      const result = resolveVariantAndMode({ variant: 'seven-card-stud', bettingMode: 'no-limit' });
      expect(result.variant).toBe('seven-card-stud');
      expect(result.bettingMode).toBe('no-limit');
    });

    it('should handle omaha-hi-lo', () => {
      const result = resolveVariantAndMode({ variant: 'omaha-hi-lo' });
      expect(result.variant).toBe('omaha-hi-lo');
      expect(result.bettingMode).toBe('pot-limit');
    });

    it('should handle five-card-stud', () => {
      const result = resolveVariantAndMode({ variant: 'five-card-stud' });
      expect(result.variant).toBe('five-card-stud');
      expect(result.bettingMode).toBe('no-limit');
    });
  });
});
