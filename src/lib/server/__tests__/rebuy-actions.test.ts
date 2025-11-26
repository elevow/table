// Mock database layer to avoid pg TextEncoder issue
jest.mock('../../database/pool', () => ({
  getPool: jest.fn(),
}));

jest.mock('../../services/game-service', () => ({
  getRoomConfig: jest.fn(),
}));

// Mock dependencies before importing
jest.mock('../../realtime/publisher', () => ({
  publishSeatState: jest.fn().mockResolvedValue(undefined),
  publishSeatVacated: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../shared/game-seats', () => ({
  getRoomSeats: jest.fn(),
  setRoomSeats: jest.fn(),
}));

jest.mock('../../shared/rebuy-tracker', () => ({
  recordBuyin: jest.fn(),
}));

import { autoStandPlayer, applyRebuy } from '../rebuy-actions';
import { BASE_REBUY_CHIPS } from '../rebuy-state';
import { publishSeatState, publishSeatVacated } from '../../realtime/publisher';
import * as GameSeats from '../../shared/game-seats';
import { recordBuyin } from '../../shared/rebuy-tracker';

const mockPublishSeatState = publishSeatState as jest.MockedFunction<typeof publishSeatState>;
const mockPublishSeatVacated = publishSeatVacated as jest.MockedFunction<typeof publishSeatVacated>;
const mockGetRoomSeats = GameSeats.getRoomSeats as jest.MockedFunction<typeof GameSeats.getRoomSeats>;
const mockSetRoomSeats = GameSeats.setRoomSeats as jest.MockedFunction<typeof GameSeats.setRoomSeats>;
const mockRecordBuyin = recordBuyin as jest.MockedFunction<typeof recordBuyin>;

describe('rebuy-actions', () => {
  let mockIo: any;
  let mockEmitGameStateUpdate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset global activeGames
    (global as any).activeGames = undefined;

    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    mockEmitGameStateUpdate = jest.fn();
  });

  describe('autoStandPlayer', () => {
    it('should vacate a player seat and broadcast via Socket.IO and Supabase', async () => {
      const seats: Record<number, any> = {
        1: { playerId: 'player-1', playerName: 'Alice', chips: 100 },
        2: { playerId: 'player-2', playerName: 'Bob', chips: 200 },
        3: null,
      };
      mockGetRoomSeats.mockReturnValue(seats);

      await autoStandPlayer(mockIo, 'table-123', 'player-1', 'busted');

      // Should update seats
      expect(mockSetRoomSeats).toHaveBeenCalledWith('table-123', expect.objectContaining({
        1: null,
        2: { playerId: 'player-2', playerName: 'Bob', chips: 200 },
      }));

      // Should emit via Socket.IO
      expect(mockIo.to).toHaveBeenCalledWith('table_table-123');
      expect(mockIo.emit).toHaveBeenCalledWith('seat_vacated', {
        seatNumber: 1,
        playerId: 'player-1',
        reason: 'busted',
      });

      // Should publish via Supabase
      expect(mockPublishSeatVacated).toHaveBeenCalledWith('table-123', {
        seatNumber: 1,
        playerId: 'player-1',
        reason: 'busted',
      });
      expect(mockPublishSeatState).toHaveBeenCalledWith('table-123', { seats: expect.any(Object) });
    });

    it('should use default reason when not provided', async () => {
      const seats: Record<number, any> = {
        1: { playerId: 'player-1', playerName: 'Alice', chips: 50 },
      };
      mockGetRoomSeats.mockReturnValue(seats);

      await autoStandPlayer(mockIo, 'table-1', 'player-1');

      expect(mockIo.emit).toHaveBeenCalledWith('seat_vacated', expect.objectContaining({
        reason: 'auto_stand',
      }));
    });

    it('should do nothing if player is not seated', async () => {
      const seats: Record<number, any> = {
        1: { playerId: 'other-player', playerName: 'Bob', chips: 100 },
        2: null,
      };
      mockGetRoomSeats.mockReturnValue(seats);

      await autoStandPlayer(mockIo, 'table-1', 'non-existent-player');

      expect(mockSetRoomSeats).not.toHaveBeenCalled();
      expect(mockIo.emit).not.toHaveBeenCalled();
      expect(mockPublishSeatVacated).not.toHaveBeenCalled();
    });

    it('should work when io is null (Supabase-only mode)', async () => {
      const seats: Record<number, any> = {
        1: { playerId: 'player-1', playerName: 'Alice', chips: 100 },
      };
      mockGetRoomSeats.mockReturnValue(seats);

      await autoStandPlayer(null, 'table-supabase', 'player-1', 'rebuy_declined');

      // Should still update seats
      expect(mockSetRoomSeats).toHaveBeenCalled();

      // Should still publish via Supabase
      expect(mockPublishSeatVacated).toHaveBeenCalledWith('table-supabase', {
        seatNumber: 1,
        playerId: 'player-1',
        reason: 'rebuy_declined',
      });
      expect(mockPublishSeatState).toHaveBeenCalled();
    });

    it('should handle errors gracefully and not throw', async () => {
      mockGetRoomSeats.mockImplementation(() => {
        throw new Error('Database error');
      });

      // Should not throw
      await expect(autoStandPlayer(mockIo, 'table-err', 'player-1')).resolves.not.toThrow();
    });

    it('should find player in any seat position', async () => {
      const seats: Record<number, any> = {
        1: null,
        2: null,
        3: null,
        4: { playerId: 'player-in-seat-4', playerName: 'Charlie', chips: 500 },
        5: null,
        6: null,
      };
      mockGetRoomSeats.mockReturnValue(seats);

      await autoStandPlayer(mockIo, 'table-pos', 'player-in-seat-4', 'left');

      expect(mockIo.emit).toHaveBeenCalledWith('seat_vacated', {
        seatNumber: 4,
        playerId: 'player-in-seat-4',
        reason: 'left',
      });
    });
  });

  describe('applyRebuy', () => {
    beforeEach(() => {
      // Setup mock active game
      const mockPlayer = {
        id: 'player-1',
        stack: 0,
        currentBet: 50,
        isAllIn: true,
        isFolded: false,
        hasActed: true,
      };
      const mockState = {
        players: [mockPlayer],
        pot: 100,
        stage: 'showdown',
      };
      const mockEngine = {
        getState: jest.fn().mockReturnValue(mockState),
      };
      (global as any).activeGames = new Map([['table-active', mockEngine]]);
    });

    it('should apply rebuy and update player state', async () => {
      const seats: Record<number, any> = {
        1: { playerId: 'player-1', playerName: 'Alice', chips: 0 },
      };
      mockGetRoomSeats.mockReturnValue(seats);
      mockRecordBuyin.mockReturnValue({ buyins: 2, rebuys: 1, lastBuyinAt: Date.now() });

      const result = await applyRebuy(
        mockIo,
        mockEmitGameStateUpdate,
        'table-active',
        'player-1'
      );

      expect(result.chips).toBe(BASE_REBUY_CHIPS);
      expect(result.record.rebuys).toBe(1);

      // Verify player state was updated
      const engine = (global as any).activeGames.get('table-active');
      const state = engine.getState();
      const player = state.players[0];
      expect(player.stack).toBe(BASE_REBUY_CHIPS);
      expect(player.currentBet).toBe(0);
      expect(player.isAllIn).toBe(false);
      expect(player.isFolded).toBe(false);
      expect(player.hasActed).toBe(false);
    });

    it('should update seat chips and publish state', async () => {
      const seats: Record<number, any> = {
        1: { playerId: 'player-1', playerName: 'Alice', chips: 0 },
      };
      mockGetRoomSeats.mockReturnValue(seats);
      mockRecordBuyin.mockReturnValue({ buyins: 3, rebuys: 2, lastBuyinAt: Date.now() });

      await applyRebuy(mockIo, mockEmitGameStateUpdate, 'table-active', 'player-1');

      expect(mockSetRoomSeats).toHaveBeenCalledWith('table-active', expect.objectContaining({
        1: expect.objectContaining({ chips: BASE_REBUY_CHIPS }),
      }));

      expect(mockIo.emit).toHaveBeenCalledWith('seat_stack_updated', {
        seatNumber: 1,
        playerId: 'player-1',
        playerName: 'Alice',
        chips: BASE_REBUY_CHIPS,
      });

      expect(mockPublishSeatState).toHaveBeenCalled();
    });

    it('should emit game state update', async () => {
      const seats: Record<number, any> = {
        1: { playerId: 'player-1', playerName: 'Alice', chips: 0 },
      };
      mockGetRoomSeats.mockReturnValue(seats);
      mockRecordBuyin.mockReturnValue({ buyins: 2, rebuys: 1, lastBuyinAt: Date.now() });

      await applyRebuy(mockIo, mockEmitGameStateUpdate, 'table-active', 'player-1');

      expect(mockEmitGameStateUpdate).toHaveBeenCalledWith(
        mockIo,
        'table-active',
        expect.any(Object),
        { action: 'rebuy', playerId: 'player-1', amount: BASE_REBUY_CHIPS }
      );
    });

    it('should use custom chip amount when provided', async () => {
      const seats: Record<number, any> = {
        1: { playerId: 'player-1', playerName: 'Alice', chips: 0 },
      };
      mockGetRoomSeats.mockReturnValue(seats);
      mockRecordBuyin.mockReturnValue({ buyins: 2, rebuys: 1, lastBuyinAt: Date.now() });

      const customAmount = 50;
      const result = await applyRebuy(
        mockIo,
        mockEmitGameStateUpdate,
        'table-active',
        'player-1',
        customAmount
      );

      expect(result.chips).toBe(customAmount);

      const engine = (global as any).activeGames.get('table-active');
      const player = engine.getState().players[0];
      expect(player.stack).toBe(customAmount);
    });

    it('should throw error when no active game exists', async () => {
      (global as any).activeGames = new Map();

      await expect(
        applyRebuy(mockIo, mockEmitGameStateUpdate, 'no-game-table', 'player-1')
      ).rejects.toThrow('No active game available for this table');
    });

    it('should throw error when game state is unavailable', async () => {
      const mockEngine = {
        getState: jest.fn().mockReturnValue(null),
      };
      (global as any).activeGames = new Map([['bad-state-table', mockEngine]]);

      await expect(
        applyRebuy(mockIo, mockEmitGameStateUpdate, 'bad-state-table', 'player-1')
      ).rejects.toThrow('Table state unavailable');
    });

    it('should throw error when player is not in the game', async () => {
      const mockState = {
        players: [{ id: 'other-player', stack: 100 }],
      };
      const mockEngine = {
        getState: jest.fn().mockReturnValue(mockState),
      };
      (global as any).activeGames = new Map([['table-no-player', mockEngine]]);

      await expect(
        applyRebuy(mockIo, mockEmitGameStateUpdate, 'table-no-player', 'missing-player')
      ).rejects.toThrow('Player not seated in the active game');
    });

    it('should work without Socket.IO (Supabase-only mode)', async () => {
      const seats: Record<number, any> = {
        1: { playerId: 'player-1', playerName: 'Alice', chips: 0 },
      };
      mockGetRoomSeats.mockReturnValue(seats);
      mockRecordBuyin.mockReturnValue({ buyins: 2, rebuys: 1, lastBuyinAt: Date.now() });

      const result = await applyRebuy(
        null,
        mockEmitGameStateUpdate,
        'table-active',
        'player-1'
      );

      expect(result.chips).toBe(BASE_REBUY_CHIPS);
      expect(mockPublishSeatState).toHaveBeenCalled();
      // Game state update should not be called without io
      expect(mockEmitGameStateUpdate).not.toHaveBeenCalled();
    });

    it('should handle publishSeatState failure gracefully', async () => {
      const seats: Record<number, any> = {
        1: { playerId: 'player-1', playerName: 'Alice', chips: 0 },
      };
      mockGetRoomSeats.mockReturnValue(seats);
      mockRecordBuyin.mockReturnValue({ buyins: 2, rebuys: 1, lastBuyinAt: Date.now() });
      mockPublishSeatState.mockRejectedValueOnce(new Error('Supabase error'));

      // Should not throw, just log warning
      const result = await applyRebuy(
        mockIo,
        mockEmitGameStateUpdate,
        'table-active',
        'player-1'
      );

      expect(result.chips).toBe(BASE_REBUY_CHIPS);
    });

    it('should handle player in different seat positions', async () => {
      const mockState = {
        players: [{ id: 'player-in-seat-3', stack: 0, currentBet: 0, isAllIn: false, isFolded: false, hasActed: false }],
      };
      const mockEngine = { getState: jest.fn().mockReturnValue(mockState) };
      (global as any).activeGames = new Map([['table-pos', mockEngine]]);

      const seats: Record<number, any> = {
        1: null,
        2: null,
        3: { playerId: 'player-in-seat-3', playerName: 'Charlie', chips: 0 },
        4: null,
      };
      mockGetRoomSeats.mockReturnValue(seats);
      mockRecordBuyin.mockReturnValue({ buyins: 2, rebuys: 1, lastBuyinAt: Date.now() });

      await applyRebuy(mockIo, mockEmitGameStateUpdate, 'table-pos', 'player-in-seat-3');

      expect(mockIo.emit).toHaveBeenCalledWith('seat_stack_updated', {
        seatNumber: 3,
        playerId: 'player-in-seat-3',
        playerName: 'Charlie',
        chips: BASE_REBUY_CHIPS,
      });
    });

    it('should record the buyin in tracker', async () => {
      const seats: Record<number, any> = {
        1: { playerId: 'player-1', playerName: 'Alice', chips: 0 },
      };
      mockGetRoomSeats.mockReturnValue(seats);
      mockRecordBuyin.mockReturnValue({ buyins: 4, rebuys: 3, lastBuyinAt: Date.now() });

      const result = await applyRebuy(mockIo, mockEmitGameStateUpdate, 'table-active', 'player-1');

      expect(mockRecordBuyin).toHaveBeenCalledWith('table-active', 'player-1');
      expect(result.record.rebuys).toBe(3);
    });
  });
});
