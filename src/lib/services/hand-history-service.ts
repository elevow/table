// US-021: Hand History - Service Layer

import { Pool } from 'pg';
import { HandHistoryManager } from '../database/hand-history-manager';
import {
  CreateGameHistoryRequest,
  GameHistoryRecord,
  RunItTwiceOutcomeInput,
  RunItTwiceOutcomeRecord,
} from '../../types/game-history';

export class HandHistoryService {
  private manager: HandHistoryManager;
  constructor(pool: Pool) {
    this.manager = new HandHistoryManager(pool);
  }

  async recordHand(input: CreateGameHistoryRequest): Promise<GameHistoryRecord> {
    this.require(input.tableId, 'gameId');
    this.require(input.handId, 'handId');
    if (!Array.isArray(input.actionSequence) || input.actionSequence.length === 0) {
      throw new Error('Missing or invalid actionSequence');
    }
    if (!Array.isArray(input.communityCards)) {
      throw new Error('Missing or invalid communityCards');
    }
    if (!input.results) {
      throw new Error('Missing or invalid results');
    }
    if (!(input.startedAt instanceof Date) || !(input.endedAt instanceof Date) || input.startedAt >= input.endedAt) {
      throw new Error('Missing or invalid time range');
    }
    return this.manager.createHandHistory(input);
  }

  async getHandById(id: string): Promise<GameHistoryRecord | null> {
    this.require(id, 'id');
    // Reuse existing GameHistoryManager if desired in future; for now, not needed.
    // For simplicity, fetch via existing GameHistoryManager if schema differs.
    // Left intentionally minimal; consumers may use query endpoints for advanced retrieval.
    // Returning null path not implemented here.
    throw new Error('Not implemented: getHandById');
  }

  async addRunItTwiceOutcome(input: RunItTwiceOutcomeInput): Promise<RunItTwiceOutcomeRecord> {
    this.require(input.handId, 'handId');
    if (!Number.isInteger(input.boardNumber) || input.boardNumber < 1 || input.boardNumber > 2) {
      throw new Error('Missing or invalid boardNumber');
    }
    if (!Array.isArray(input.communityCards)) {
      throw new Error('Missing or invalid communityCards');
    }
    if (typeof input.potAmount !== 'number' || !Number.isFinite(input.potAmount)) {
      throw new Error('Missing or invalid potAmount');
    }
    return this.manager.addRunItTwiceOutcome(input);
  }

  async listRunItTwiceOutcomes(handId: string): Promise<RunItTwiceOutcomeRecord[]> {
    this.require(handId, 'handId');
    return this.manager.listRunItTwiceOutcomes(handId);
  }

  private require(value: string | undefined, name: string): void {
    if (!value || typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Missing or invalid ${name}`);
    }
  }
}
