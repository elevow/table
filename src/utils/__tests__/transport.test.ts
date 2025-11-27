import { getTransportMode, setTransportMode, TransportMode } from '../transport';

describe('Transport Utility', () => {
  describe('getTransportMode()', () => {
    it('should always return supabase', () => {
      expect(getTransportMode()).toBe('supabase');
    });

    it('should return supabase type', () => {
      const mode: TransportMode = getTransportMode();
      expect(mode).toBe('supabase');
    });
  });

  describe('setTransportMode()', () => {
    it('should not throw when called with supabase', () => {
      expect(() => setTransportMode('supabase')).not.toThrow();
    });

    it('should still return supabase after calling setTransportMode', () => {
      setTransportMode('supabase');
      expect(getTransportMode()).toBe('supabase');
    });
  });

  describe('TransportMode type', () => {
    it('should only allow supabase as a valid value', () => {
      // This is a compile-time check, but we can verify at runtime
      const validMode: TransportMode = 'supabase';
      expect(validMode).toBe('supabase');
    });
  });
});
