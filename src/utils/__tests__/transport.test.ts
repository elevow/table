import { getTransportMode, setTransportMode } from '../transport';

describe('transport', () => {
  it('should return default transport mode', () => {
    const mode = getTransportMode();
    expect(['socket', 'supabase', 'hybrid']).toContain(mode);
  });

  it('should handle setTransportMode in test environment', () => {
    // In Node.js test environment, window is undefined, so this should not throw
    expect(() => setTransportMode('supabase')).not.toThrow();
  });
});
