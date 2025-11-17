// Mock Supabase before importing
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    channel: jest.fn(),
  })),
}));

import { getSupabaseBrowser } from '../supabaseClient';

describe('supabaseClient', () => {
  it('should return null in SSR environment', () => {
    const client = getSupabaseBrowser();
    // In test environment (Node.js), window is undefined, so should return null
    expect(client).toBeNull();
  });
});
