import { nextSeq, resetSeq } from '../sequence';

describe('sequence', () => {
  beforeEach(() => {
    // Reset all sequences before each test
    resetSeq('table1');
    resetSeq('table2');
  });

  describe('nextSeq', () => {
    it('should start at 1 for a new table', () => {
      expect(nextSeq('table1')).toBe(1);
    });

    it('should increment sequence for the same table', () => {
      expect(nextSeq('table1')).toBe(1);
      expect(nextSeq('table1')).toBe(2);
      expect(nextSeq('table1')).toBe(3);
    });

    it('should maintain separate sequences for different tables', () => {
      expect(nextSeq('table1')).toBe(1);
      expect(nextSeq('table2')).toBe(1);
      expect(nextSeq('table1')).toBe(2);
      expect(nextSeq('table2')).toBe(2);
      expect(nextSeq('table1')).toBe(3);
    });

    it('should continue incrementing after multiple calls', () => {
      for (let i = 1; i <= 100; i++) {
        expect(nextSeq('table1')).toBe(i);
      }
    });
  });

  describe('resetSeq', () => {
    it('should reset sequence to start from 1 again', () => {
      nextSeq('table1');
      nextSeq('table1');
      nextSeq('table1');
      
      resetSeq('table1');
      
      expect(nextSeq('table1')).toBe(1);
    });

    it('should only reset the specified table', () => {
      nextSeq('table1');
      nextSeq('table1');
      nextSeq('table2');
      nextSeq('table2');
      
      resetSeq('table1');
      
      expect(nextSeq('table1')).toBe(1);
      expect(nextSeq('table2')).toBe(3);
    });

    it('should not throw when resetting non-existent table', () => {
      expect(() => resetSeq('non-existent-table')).not.toThrow();
    });
  });
});
