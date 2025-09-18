import { describe, it, beforeEach, expect, jest } from '@jest/globals';
import { GameManager } from '../game-manager';

const mockPool = { query: jest.fn() } as any;

describe('GameManager (US-020)', () => {
  let mgr: GameManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mgr = new GameManager(mockPool);
  });

  it('creates a room and lists rooms with pagination', async () => {
    (mockPool.query as jest.Mock)
      // Check for existing room ID (should return empty)
      .mockImplementationOnce(async () => ({ rows: [] }))
      // Check if user exists (should return one row)
      .mockImplementationOnce(async () => ({ rowCount: 1, rows: [{ id: '550e8400-e29b-41d4-a716-446655440000' }] }))
      // Insert room and return the created room
      .mockImplementationOnce(async () => ({ 
        rows: [{ 
          id: 'r1', 
          name: 'Table 1', 
          game_type: 'NLH', 
          max_players: 6, 
          blind_levels: { sb: 1, bb: 2 }, 
          created_by: '550e8400-e29b-41d4-a716-446655440000', 
          created_at: new Date(), 
          status: 'waiting', 
          configuration: null 
        }] 
      }))
      // Count total rooms
      .mockImplementationOnce(async () => ({ rows: [{ total: '1' }] }))
      // List rooms
      .mockImplementationOnce(async () => ({ 
        rows: [{ 
          id: 'r1', 
          name: 'Table 1', 
          game_type: 'NLH', 
          max_players: 6, 
          blind_levels: { sb: 1, bb: 2 }, 
          created_by: '550e8400-e29b-41d4-a716-446655440000', 
          created_at: new Date(), 
          status: 'waiting', 
          configuration: null 
        }] 
      }));

    const created = await mgr.createRoom({ name: 'Table 1', gameType: 'NLH', maxPlayers: 6, blindLevels: { sb: 1, bb: 2 }, createdBy: '550e8400-e29b-41d4-a716-446655440000' });
    expect(created.name).toBe('Table 1');
    const rooms = await mgr.listRooms(1, 10);
    expect(rooms.total).toBe(1);
    expect(rooms.items[0].status).toBe('waiting');
  });

  it('updates room status', async () => {
    (mockPool.query as jest.Mock)
      .mockImplementationOnce(async () => ({ 
        rows: [{ 
          id: 'r1', 
          name: 'T', 
          game_type: 'NLH', 
          max_players: 6, 
          blind_levels: {}, 
          created_by: '550e8400-e29b-41d4-a716-446655440000', 
          created_at: new Date(), 
          status: 'active', 
          configuration: null 
        }] 
      }));
    const updated = await mgr.updateRoomStatus('r1', 'active');
    expect(updated.status).toBe('active');
  });

  it('starts, updates, gets by room, and ends a game', async () => {
    (mockPool.query as jest.Mock)
      // start insert
      .mockImplementationOnce(async () => ({ rows: [{ id: 'g1', room_id: 'r1', current_hand_id: null, dealer_position: 0, current_player_position: 1, pot: 0, state: null, last_action_at: new Date() }] }))
      // update room status to active
      .mockImplementationOnce(async () => ({ 
        rows: [{ 
          id: 'r1', 
          name: 'T', 
          game_type: 'NLH', 
          max_players: 6, 
          blind_levels: {}, 
          created_by: '550e8400-e29b-41d4-a716-446655440000', 
          created_at: new Date(), 
          status: 'active', 
          configuration: null 
        }] 
      }))
      // update game
      .mockImplementationOnce(async () => ({ rows: [{ id: 'g1', room_id: 'r1', current_hand_id: 'h1', dealer_position: 1, current_player_position: 2, pot: 10, state: { stage: 'flop' }, last_action_at: new Date() }] }))
      // get by room
      .mockImplementationOnce(async () => ({ rows: [{ id: 'g1', room_id: 'r1', current_hand_id: 'h1', dealer_position: 1, current_player_position: 2, pot: 10, state: { stage: 'flop' }, last_action_at: new Date() }] }))
      // select room for endGame
      .mockImplementationOnce(async () => ({ rows: [{ room_id: 'r1' }] }))
      // delete active
      .mockImplementationOnce(async () => ({ rows: [] }))
      // update room back to waiting
      .mockImplementationOnce(async () => ({ rows: [{ id: 'r1', name: 'T', game_type: 'NLH', max_players: 6, blind_levels: {}, created_by: 'u1', created_at: new Date(), status: 'waiting', configuration: null }] }));

    const started = await mgr.startGame({ roomId: 'r1', dealerPosition: 0, currentPlayerPosition: 1 });
    expect(started.roomId).toBe('r1');

    const updated = await mgr.updateActiveGame({ id: 'g1', currentHandId: 'h1', dealerPosition: 1, currentPlayerPosition: 2, pot: 10, state: { stage: 'flop' } });
    expect(updated.currentHandId).toBe('h1');

    const found = await mgr.getActiveGameByRoom('r1');
    expect(found?.id).toBe('g1');

    await expect(mgr.endGame('g1')).resolves.toBeUndefined();
  });
});
