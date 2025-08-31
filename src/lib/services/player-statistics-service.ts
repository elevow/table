import type { Pool } from 'pg';
import { PlayerStatisticsManager } from '../database/player-statistics-manager';
import type { LeaderboardMetric, PlayerStatisticsDelta } from '../../types/player-statistics';

export class PlayerStatisticsService {
  private mgr: PlayerStatisticsManager;
  constructor(pool: Pool) {
    this.mgr = new PlayerStatisticsManager(pool);
  }

  async getOrCreate(userId: string) {
    if (!userId) throw new Error('userId is required');
    return this.mgr.ensureExists(userId);
  }

  async update(userId: string, delta: PlayerStatisticsDelta) {
    if (!userId) throw new Error('userId is required');
    if (!delta || typeof delta !== 'object') throw new Error('delta is required');
    const numericFields: (keyof PlayerStatisticsDelta)[] = ['handsPlayed', 'handsWon', 'totalProfit', 'biggestPot'];
    for (const f of numericFields) {
      const v: any = (delta as any)[f];
      if (v != null && typeof v !== 'number') throw new Error(`${String(f)} must be a number`);
    }
    return this.mgr.updateStats(userId, delta);
  }

  async recordAchievement(userId: string, type: string, metadata?: any) {
    if (!userId) throw new Error('userId is required');
    if (!type) throw new Error('type is required');
    return this.mgr.recordAchievement(userId, type, metadata);
  }

  async listAchievements(userId: string, limit?: number, offset?: number) {
    if (!userId) throw new Error('userId is required');
    const l = Math.max(1, Math.min(100, Number(limit ?? 50)));
    const o = Math.max(0, Number(offset ?? 0));
    return this.mgr.listAchievements(userId, l, o);
  }

  async leaderboard(metric: LeaderboardMetric, limit?: number) {
    const allowed: LeaderboardMetric[] = ['total_profit', 'hands_won', 'hands_played', 'biggest_pot'];
    if (!allowed.includes(metric)) throw new Error('invalid metric');
    const l = Math.max(1, Math.min(100, Number(limit ?? 10)));
    return this.mgr.getLeaderboard(metric, l);
  }
}
