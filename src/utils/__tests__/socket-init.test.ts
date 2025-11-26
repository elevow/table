/**
 * @jest-environment jsdom
 */

describe('Socket Initialization Utils (Deprecated)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('ensureSocketIOServer', () => {
    it('should be a no-op function that returns immediately', async () => {
      const { ensureSocketIOServer } = require('../socket-init');
      
      // Should return immediately without making any network calls
      const result = await ensureSocketIOServer();
      
      expect(result).toBeUndefined();
    });

    it('should return the same result for multiple calls', async () => {
      const { ensureSocketIOServer } = require('../socket-init');
      
      const results = await Promise.all([
        ensureSocketIOServer(),
        ensureSocketIOServer(),
        ensureSocketIOServer(),
      ]);
      
      // All results should be undefined (no-op)
      expect(results).toEqual([undefined, undefined, undefined]);
    });

    it('should not throw any errors', async () => {
      const { ensureSocketIOServer } = require('../socket-init');
      
      await expect(ensureSocketIOServer()).resolves.not.toThrow();
    });
  });
});