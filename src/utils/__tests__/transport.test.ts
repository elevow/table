import { getTransportMode, setTransportMode } from '../transport';

describe('transport', () => {
  it('should return supabase as the only transport mode', () => {
    const mode = getTransportMode();
    expect(mode).toBe('supabase');
  });

  it('setTransportMode should be a no-op', () => {
    // setTransportMode is a no-op since only Supabase is supported
    expect(() => setTransportMode('supabase')).not.toThrow();
    // Mode should still be supabase
    expect(getTransportMode()).toBe('supabase');
  });
});
