// US-021: Hand History - Data Access Layer

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  GameHistoryRecord,
  CreateGameHistoryRequest,
  GameHistoryQueryOptions,
  GameHistoryFilters,
  PaginatedGameHistoryResponse,
  GameHistoryRow,
  RunItTwiceOutcomeInput,
  RunItTwiceOutcomeRecord,
  RunItTwiceOutcomeRow,
} from '../../types/game-history';

export class HandHistoryManager {
  constructor(private pool: Pool) {}

  async createHandHistory(req: CreateGameHistoryRequest): Promise<GameHistoryRecord> {
    const query = `
      INSERT INTO hand_history (
        id, game_id, hand_number, community_cards, player_cards, actions, started_at, ended_at, winners, pot_distribution
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const id = uuidv4();
    const values = [
      id,
      req.tableId, // mapping existing shape: tableId -> game_id
      req.handId,  // hand_number
      req.communityCards,
      JSON.stringify({}), // player_cards not modeled; keep as empty for now
      JSON.stringify(req.actionSequence),
      req.startedAt,
      req.endedAt,
      JSON.stringify(req.results.winners),
      JSON.stringify(req.results.pot),
    ];

    const client = await this.pool.connect();
    try {
      const res = await client.query(query, values);
      const row = res.rows[0];
      // Map back reusing GameHistoryRecord structure for consistency with existing code base
      return {
        id,
        tableId: req.tableId,
        handId: String(req.handId),
        actionSequence: req.actionSequence,
        communityCards: req.communityCards,
        results: req.results,
        startedAt: req.startedAt,
        endedAt: req.endedAt,
      };
    } finally {
      client.release();
    }
  }

  async addRunItTwiceOutcome(input: RunItTwiceOutcomeInput): Promise<RunItTwiceOutcomeRecord> {
    const query = `
      INSERT INTO run_it_twice_outcomes (
        id, hand_id, board_number, community_cards, winners, pot_amount
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const id = uuidv4();
    const values = [
      id,
      input.handId,
      input.boardNumber,
      input.communityCards,
      JSON.stringify(input.winners),
      input.potAmount,
    ];
    const client = await this.pool.connect();
    try {
      const res = await client.query(query, values);
      const row: RunItTwiceOutcomeRow = res.rows[0];
      return {
        id: row.id,
        handId: row.hand_id,
        boardNumber: row.board_number,
        communityCards: row.community_cards,
        winners: typeof row.winners === 'string' ? JSON.parse(row.winners) : (row as any).winners,
        potAmount: typeof row.pot_amount === 'string' ? parseFloat(row.pot_amount) : (row.pot_amount as number),
      };
    } finally {
      client.release();
    }
  }

  async listRunItTwiceOutcomes(handId: string): Promise<RunItTwiceOutcomeRecord[]> {
    const client = await this.pool.connect();
    try {
      const res = await client.query('SELECT * FROM run_it_twice_outcomes WHERE hand_id = $1 ORDER BY board_number ASC', [handId]);
      return res.rows.map((row: RunItTwiceOutcomeRow) => ({
        id: row.id,
        handId: row.hand_id,
        boardNumber: row.board_number,
        communityCards: row.community_cards,
        winners: typeof row.winners === 'string' ? JSON.parse(row.winners) : (row as any).winners,
        potAmount: typeof row.pot_amount === 'string' ? parseFloat(row.pot_amount) : (row.pot_amount as number),
      }));
    } finally {
      client.release();
    }
  }
}
