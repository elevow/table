// Mock Supabase before importing
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    channel: jest.fn(() => ({
      send: jest.fn(),
    })),
  })),
}));

import { publishGameStateUpdate, publishSeatClaimed } from '../publisher';

describe('publisher', () => {
  it('should not throw when publishing without configured Supabase', async () => {
    // Without NEXT_PUBLIC_SUPABASE_URL, these should fail gracefully
    await expect(publishGameStateUpdate('test-table', {})).resolves.not.toThrow();
    await expect(publishSeatClaimed('test-table', {})).resolves.not.toThrow();
  });
});
