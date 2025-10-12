// US-020: Active Games - Service Layer

import { Pool } from 'pg';
import { GameManager } from '../database/game-manager';
import { ActiveGameRecord, CreateRoomInput, GameRoomRecord, Paginated, StartGameInput, UpdateActiveGameInput } from '../../types/game';
import { validateTournamentConfig } from '../tournament/tournament-utils';

export class GameService {
  private manager: GameManager;
  constructor(pool: Pool) {
    this.manager = new GameManager(pool);
  }

  async createRoom(input: CreateRoomInput): Promise<GameRoomRecord> {
    this.require(input.name, 'name');
    this.require(input.gameType, 'gameType');
    this.requireNumber(input.maxPlayers, 'maxPlayers');
    this.require(input.createdBy, 'createdBy');
    // Validate optional tournament configuration if present
    const maybeTournament = (input.configuration && (input.configuration as any).tournament) as
      | { preset?: string; config?: any }
      | undefined;
    if (maybeTournament?.config) {
      const result = validateTournamentConfig(maybeTournament.config);
      if (!result.valid) {
        throw new Error(`Invalid tournament config: ${result.errors.join(', ')}`);
      }
    }
    return this.manager.createRoom(input);
  }

  async listRooms(page = 1, limit = 20): Promise<Paginated<GameRoomRecord>> {
    const { p, l } = this.normalizePagination(page, limit);
    return this.manager.listRooms(p, l);
  }

  async startGame(input: StartGameInput): Promise<ActiveGameRecord> {
    this.require(input.roomId, 'roomId');
    this.requireNumber(input.dealerPosition, 'dealerPosition');
    this.requireNumber(input.currentPlayerPosition, 'currentPlayerPosition');
    // If the room has a configuration specifying bettingMode, persist it in initial state
    const room = await this.manager.getRoomById(input.roomId);
    let state = input.state;
    const bettingMode = (room?.configuration?.bettingMode as 'no-limit' | 'pot-limit' | undefined);
    const requireRitUnanimous = !!room?.configuration?.requireRunItTwiceUnanimous;
  const variant = room?.configuration?.variant as undefined | 'texas-holdem' | 'omaha' | 'omaha-hi-lo' | 'seven-card-stud' | 'seven-card-stud-hi-lo';
    // Only include non-defaults to preserve backward-compat visuals/equality
    if (bettingMode && bettingMode !== 'no-limit') {
      state = { ...(state || {}), bettingMode };
    }
    if (requireRitUnanimous) {
      state = { ...(state || {}), requireRunItTwiceUnanimous: true };
    }
    if (variant) {
      state = { ...(state || {}), variant };
    }
    return this.manager.startGame({ ...input, state });
  }

  async updateActiveGame(input: UpdateActiveGameInput): Promise<ActiveGameRecord> {
    this.require(input.id, 'id');
    return this.manager.updateActiveGame(input);
  }

  async endGame(id: string): Promise<void> {
    this.require(id, 'id');
    return this.manager.endGame(id);
  }

  async getActiveGameByRoom(roomId: string, callerUserId?: string): Promise<ActiveGameRecord | null> {
    this.require(roomId, 'roomId');
    if (callerUserId !== undefined) {
      return this.manager.getActiveGameByRoom(roomId, callerUserId);
    }
    return this.manager.getActiveGameByRoom(roomId);
  }

  async getRoomById(roomId: string): Promise<GameRoomRecord | null> {
    this.require(roomId, 'roomId');
    return this.manager.getRoomById(roomId);
  }

  private require(value: string | undefined, name: string): void {
    if (!value || typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Missing or invalid ${name}`);
    }
  }

  private requireNumber(value: number | undefined, name: string): void {
    if (!Number.isFinite(value as number)) {
      throw new Error(`Missing or invalid ${name}`);
    }
  }

  private normalizePagination(page?: number, limit?: number): { p: number; l: number } {
    const p = Number.isFinite(page as number) && (page as number) > 0 ? (page as number) : 1;
    const l = Number.isFinite(limit as number) && (limit as number) > 0 && (limit as number) <= 100 ? (limit as number) : 20;
    return { p, l };
  }
}
