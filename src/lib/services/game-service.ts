// US-020: Active Games - Service Layer

import { Pool } from 'pg';
import { GameManager } from '../database/game-manager';
import { ActiveGameRecord, CreateRoomInput, GameRoomRecord, Paginated, StartGameInput, UpdateActiveGameInput } from '../../types/game';

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
    return this.manager.startGame(input);
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
