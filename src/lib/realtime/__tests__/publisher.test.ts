// Store original env vars
const originalEnv = { ...process.env };

// Create mock send function to track calls
const mockSend = jest.fn().mockResolvedValue(undefined);
const mockChannel = jest.fn(() => ({ send: mockSend }));
const mockCreateClient = jest.fn(() => ({ channel: mockChannel }));

// Mock Supabase before importing
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: any[]) => mockCreateClient(...args),
}));

import {
  publishGameStateUpdate,
  publishSeatClaimed,
  publishSeatVacated,
  publishSeatState,
  publishAwaitingDealerChoice,
  publishRebuyPrompt,
  publishRebuyResult,
} from '../publisher';

describe('publisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('when Supabase is not configured', () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    });

    it('publishGameStateUpdate should not throw and not call supabase', async () => {
      await expect(publishGameStateUpdate('test-table', { foo: 'bar' })).resolves.not.toThrow();
      expect(mockChannel).not.toHaveBeenCalled();
    });

    it('publishSeatClaimed should not throw and not call supabase', async () => {
      await expect(publishSeatClaimed('test-table', { seatNumber: 1 })).resolves.not.toThrow();
      expect(mockChannel).not.toHaveBeenCalled();
    });

    it('publishSeatVacated should not throw and not call supabase', async () => {
      await expect(publishSeatVacated('test-table', { seatNumber: 2 })).resolves.not.toThrow();
      expect(mockChannel).not.toHaveBeenCalled();
    });

    it('publishSeatState should not throw and not call supabase', async () => {
      await expect(publishSeatState('test-table', { seats: {} })).resolves.not.toThrow();
      expect(mockChannel).not.toHaveBeenCalled();
    });

    it('publishAwaitingDealerChoice should not throw and not call supabase', async () => {
      await expect(publishAwaitingDealerChoice('test-table', { dealerId: 'player1' })).resolves.not.toThrow();
      expect(mockChannel).not.toHaveBeenCalled();
    });

    it('publishRebuyPrompt should not throw and not call supabase', async () => {
      await expect(publishRebuyPrompt('test-table', { playerId: 'p1', baseChips: 20 })).resolves.not.toThrow();
      expect(mockChannel).not.toHaveBeenCalled();
    });

    it('publishRebuyResult should not throw and not call supabase', async () => {
      await expect(publishRebuyResult('test-table', { playerId: 'p1', status: 'accepted' })).resolves.not.toThrow();
      expect(mockChannel).not.toHaveBeenCalled();
    });
  });

  describe('when Supabase is configured with service role key', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    });

    it('publishGameStateUpdate should broadcast to correct channel with correct event', async () => {
      const payload = { gameState: { stage: 'preflop' }, seq: 1 };
      await publishGameStateUpdate('table-123', payload);

      expect(mockChannel).toHaveBeenCalledWith('table:table-123');
      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'game_state_update',
        payload,
      });
    });

    it('publishSeatClaimed should broadcast seat_claimed event', async () => {
      const payload = { seatNumber: 3, playerId: 'player-abc', playerName: 'Alice', chips: 1000 };
      await publishSeatClaimed('room-456', payload);

      expect(mockChannel).toHaveBeenCalledWith('table:room-456');
      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'seat_claimed',
        payload,
      });
    });

    it('publishSeatVacated should broadcast seat_vacated event', async () => {
      const payload = { seatNumber: 2, playerId: 'player-xyz', reason: 'left' };
      await publishSeatVacated('room-789', payload);

      expect(mockChannel).toHaveBeenCalledWith('table:room-789');
      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'seat_vacated',
        payload,
      });
    });

    it('publishSeatState should broadcast seat_state event', async () => {
      const payload = { seats: { 1: { playerId: 'p1', playerName: 'Bob', chips: 500 }, 2: null } };
      await publishSeatState('room-abc', payload);

      expect(mockChannel).toHaveBeenCalledWith('table:room-abc');
      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'seat_state',
        payload,
      });
    });

    it('publishAwaitingDealerChoice should broadcast awaiting_dealer_choice event', async () => {
      const payload = { dealerId: 'dealer-1', allowedVariants: ['texas-holdem', 'omaha'] };
      await publishAwaitingDealerChoice('dc-table', payload);

      expect(mockChannel).toHaveBeenCalledWith('table:dc-table');
      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'awaiting_dealer_choice',
        payload,
      });
    });

    it('publishRebuyPrompt should broadcast rebuy_prompt event', async () => {
      const payload = { playerId: 'busted-player', baseChips: 20, rebuysUsed: 1, rebuyLimit: 3, remaining: 2 };
      await publishRebuyPrompt('rebuy-table', payload);

      expect(mockChannel).toHaveBeenCalledWith('table:rebuy-table');
      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'rebuy_prompt',
        payload,
      });
    });

    it('publishRebuyResult should broadcast rebuy_result event for accepted rebuy', async () => {
      const payload = { playerId: 'p1', status: 'accepted', rebuysUsed: 2, stack: 20 };
      await publishRebuyResult('rebuy-table', payload);

      expect(mockChannel).toHaveBeenCalledWith('table:rebuy-table');
      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'rebuy_result',
        payload,
      });
    });

    it('publishRebuyResult should broadcast rebuy_result event for declined rebuy', async () => {
      const payload = { playerId: 'p2', status: 'declined' };
      await publishRebuyResult('rebuy-table', payload);

      expect(mockChannel).toHaveBeenCalledWith('table:rebuy-table');
      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'rebuy_result',
        payload,
      });
    });
  });

  describe('when Supabase is configured with anon key only', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    });

    it('publishGameStateUpdate should still work with anon key', async () => {
      const payload = { gameState: { stage: 'flop' } };
      await publishGameStateUpdate('anon-table', payload);

      expect(mockChannel).toHaveBeenCalledWith('table:anon-table');
      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'game_state_update',
        payload,
      });
    });

    it('publishSeatClaimed should still work with anon key', async () => {
      const payload = { seatNumber: 1, playerId: 'anon-player' };
      await publishSeatClaimed('anon-table', payload);

      expect(mockChannel).toHaveBeenCalledWith('table:anon-table');
      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'seat_claimed',
        payload,
      });
    });
  });

  describe('when only URL is configured but no key', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    });

    it('publishGameStateUpdate should not call supabase without a key', async () => {
      await publishGameStateUpdate('no-key-table', { test: true });
      expect(mockChannel).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    });

    it('should handle empty payload', async () => {
      await publishGameStateUpdate('empty-table', {});
      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'game_state_update',
        payload: {},
      });
    });

    it('should handle complex nested payload', async () => {
      const complexPayload = {
        gameState: {
          players: [
            { id: 'p1', stack: 100, cards: ['Ah', 'Kh'] },
            { id: 'p2', stack: 200, cards: ['Qd', 'Jd'] },
          ],
          communityCards: ['Th', '9h', '8h'],
          pot: 50,
          stage: 'turn',
        },
        seq: 42,
      };
      await publishGameStateUpdate('complex-table', complexPayload);
      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'game_state_update',
        payload: complexPayload,
      });
    });

    it('should handle special characters in tableId', async () => {
      await publishSeatClaimed('table-with-special_chars.123', { seatNumber: 1 });
      expect(mockChannel).toHaveBeenCalledWith('table:table-with-special_chars.123');
    });

    it('should handle null values in payload', async () => {
      const payload = { seatNumber: 1, playerId: null, chips: undefined };
      await publishSeatState('null-table', payload);
      expect(mockSend).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'seat_state',
        payload,
      });
    });
  });
});
