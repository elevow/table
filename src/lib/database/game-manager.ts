// US-020: Active Games & Game Rooms - Data Access Layer

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { ActiveGameRecord, CreateRoomInput, GameRoomRecord, Paginated, StartGameInput, UpdateActiveGameInput } from '../../types/game';

class GameError extends Error {
  code: string;
  details?: Record<string, any>;
  constructor(message: string, code = 'UNKNOWN_ERROR', details?: Record<string, any>) {
    super(message);
    this.name = 'GameError';
    this.code = code;
    this.details = details;
  }
}

export class GameManager {
  constructor(private pool: Pool) {}

  // Rooms
  async createRoom(input: CreateRoomInput): Promise<GameRoomRecord> {
    const id = uuidv4();
    // created_by references users(id). In dev or non-auth flows, the provided createdBy may not be a valid/existing UUID.
    // We'll validate format and existence; if not valid or missing, store NULL (the column is nullable with ON DELETE SET NULL semantics elsewhere).
    const isValidUuid = (v: string | undefined): boolean => !!v && /^(?!00000000-0000-0000-0000-000000000000)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    let createdByValue: string | null = null;
    if (isValidUuid(input.createdBy)) {
      try {
        const exists = await this.pool.query(`SELECT 1 FROM users WHERE id = $1 LIMIT 1`, [input.createdBy]);
        if (exists.rowCount && exists.rowCount > 0) {
          createdByValue = input.createdBy;
        }
      } catch {
        // If the users table isn't present or query fails, fallback to NULL to avoid breaking room creation
        createdByValue = null;
      }
    }
    let res;
    try {
      res = await this.pool.query(
        `INSERT INTO game_rooms (id, name, game_type, max_players, blind_levels, created_by, configuration, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'waiting') RETURNING *`,
        [id, input.name, input.gameType, input.maxPlayers, JSON.stringify(input.blindLevels), createdByValue, input.configuration ?? null]
      );
    } catch (e: any) {
      // Map common errors to clearer messages
      const code = e?.code as string | undefined;
      if (code === '42P01') {
        // undefined_table
        throw new Error('Database not initialized: table game_rooms is missing. Apply the SQL in docs/README order and retry.');
      }
      if (code === '08001' || code === 'ECONNREFUSED') {
        throw new Error('Database connection failed. Check your PG connection env (POOL_DATABASE_URL or DIRECT_DATABASE_URL).');
      }
      throw e;
    }
    return this.mapRoom(res.rows[0]);
  }

  async listRooms(page = 1, limit = 20): Promise<Paginated<GameRoomRecord>> {
    const offset = (page - 1) * limit;
    const count = await this.pool.query(`SELECT COUNT(*) AS total FROM game_rooms`);
    const total = parseInt(count.rows?.[0]?.total || '0', 10);
    const rows = await this.pool.query(
      `SELECT * FROM game_rooms ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const items = rows.rows.map(r => this.mapRoom(r));
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async updateRoomStatus(roomId: string, status: 'waiting' | 'active' | 'closed'): Promise<GameRoomRecord> {
    const res = await this.pool.query(
      `UPDATE game_rooms SET status = $1 WHERE id = $2 RETURNING *`,
      [status, roomId]
    );
    if (!res.rows[0]) throw new GameError('Room not found', 'NOT_FOUND');
    return this.mapRoom(res.rows[0]);
  }

  async getRoomById(roomId: string): Promise<GameRoomRecord | null> {
    const res = await this.pool.query(`SELECT * FROM game_rooms WHERE id = $1 LIMIT 1`, [roomId]);
    if (!res.rows[0]) return null;
    return this.mapRoom(res.rows[0]);
  }

  // Active Games
  async startGame(input: StartGameInput): Promise<ActiveGameRecord> {
    const id = uuidv4();
    const res = await this.pool.query(
      `INSERT INTO active_games (id, room_id, current_hand_id, dealer_position, current_player_position, pot, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        id,
        input.roomId,
        input.currentHandId ?? null,
        input.dealerPosition,
        input.currentPlayerPosition,
        input.pot ?? 0,
        input.state ? JSON.stringify(input.state) : null,
      ]
    );
    await this.updateRoomStatus(input.roomId, 'active');
    return this.mapActive(res.rows[0]);
  }

  async updateActiveGame(input: UpdateActiveGameInput): Promise<ActiveGameRecord> {
    // Build dynamic update set
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (input.currentHandId !== undefined) { sets.push(`current_hand_id = $${idx++}`); vals.push(input.currentHandId); }
    if (input.dealerPosition !== undefined) { sets.push(`dealer_position = $${idx++}`); vals.push(input.dealerPosition); }
    if (input.currentPlayerPosition !== undefined) { sets.push(`current_player_position = $${idx++}`); vals.push(input.currentPlayerPosition); }
    if (input.pot !== undefined) { sets.push(`pot = $${idx++}`); vals.push(input.pot); }
    if (input.state !== undefined) { sets.push(`state = $${idx++}`); vals.push(input.state ? JSON.stringify(input.state) : null); }
    sets.push(`last_action_at = NOW()`);

    const res = await this.pool.query(
      `UPDATE active_games SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      [...vals, input.id]
    );
    if (!res.rows[0]) throw new GameError('Active game not found', 'NOT_FOUND');
    return this.mapActive(res.rows[0]);
  }

  async endGame(id: string): Promise<void> {
    // Obtain room to set its status back to waiting/closed
    const g = await this.pool.query(`SELECT room_id FROM active_games WHERE id = $1`, [id]);
    const roomId = g.rows?.[0]?.room_id;
    await this.pool.query(`DELETE FROM active_games WHERE id = $1`, [id]);
    if (roomId) {
      await this.updateRoomStatus(roomId, 'waiting');
    }
  }

  async getActiveGameByRoom(roomId: string, callerUserId?: string): Promise<ActiveGameRecord | null> {
    if (callerUserId) {
      const { withRlsUserContext } = await import('./rls-context');
      return withRlsUserContext(this.pool, { userId: callerUserId }, async (client) => {
        const res = await client.query(`SELECT * FROM active_games WHERE room_id = $1 LIMIT 1`, [roomId]);
        if (!res.rows[0]) return null;
        return this.mapActive(res.rows[0]);
      });
    }
    const res = await this.pool.query(`SELECT * FROM active_games WHERE room_id = $1 LIMIT 1`, [roomId]);
    if (!res.rows[0]) return null;
    return this.mapActive(res.rows[0]);
  }

  private mapRoom(row: any): GameRoomRecord {
    return {
      id: row.id,
      name: row.name,
      gameType: row.game_type,
      maxPlayers: row.max_players,
      blindLevels: row.blind_levels,
      createdBy: row.created_by,
      createdAt: row.created_at,
      status: row.status,
      configuration: row.configuration ?? null,
    };
  }

  private mapActive(row: any): ActiveGameRecord {
    return {
      id: row.id,
      roomId: row.room_id,
      currentHandId: row.current_hand_id,
      dealerPosition: row.dealer_position,
      currentPlayerPosition: row.current_player_position,
      pot: Number(row.pot),
      state: row.state ?? null,
      lastActionAt: row.last_action_at,
    };
  }
}
