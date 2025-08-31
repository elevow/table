import type { Pool } from 'pg';
import type {
  PlayerStatisticsRecord,
  PlayerStatisticsRow,
  PlayerStatisticsDelta,
  AchievementRecord,
  AchievementRow,
  LeaderboardEntry,
  LeaderboardMetric,
} from '../../types/player-statistics';

function toNumber(n: number | string | null | undefined): number {
  if (n == null) return 0;
  return typeof n === 'string' ? parseFloat(n) : n;
}

function mapStatsRow(r: PlayerStatisticsRow): PlayerStatisticsRecord {
  return {
    id: r.id,
    userId: r.user_id,
    handsPlayed: Number(r.hands_played),
    handsWon: Number(r.hands_won),
    totalProfit: toNumber(r.total_profit),
    biggestPot: toNumber(r.biggest_pot),
    lastUpdated: r.last_updated,
    gameSpecificStats: r.game_specific_stats,
  };
}

function mapAchievementRow(r: AchievementRow): AchievementRecord {
  return {
    id: r.id,
    userId: r.user_id,
    achievementType: r.achievement_type,
    achievedAt: r.achieved_at,
    metadata: r.metadata,
  };
}

export class PlayerStatisticsManager {
  constructor(private pool: Pool) {}

  async getByUserId(userId: string): Promise<PlayerStatisticsRecord | null> {
    const res = await this.pool.query('SELECT * FROM player_statistics WHERE user_id = $1', [userId]);
    if (!res.rows[0]) return null;
    return mapStatsRow(res.rows[0] as PlayerStatisticsRow);
  }

  async ensureExists(userId: string): Promise<PlayerStatisticsRecord> {
    const existing = await this.getByUserId(userId);
    if (existing) return existing;
    const res = await this.pool.query(
      `INSERT INTO player_statistics (user_id, hands_played, hands_won, total_profit, biggest_pot)
       VALUES ($1, 0, 0, 0, 0)
       RETURNING *`,
      [userId],
    );
    return mapStatsRow(res.rows[0] as PlayerStatisticsRow);
  }

  async updateStats(userId: string, delta: PlayerStatisticsDelta): Promise<PlayerStatisticsRecord> {
    // Fetch current to compute biggest_pot set-if-greater
    const current = await this.ensureExists(userId);
    const incHandsPlayed = delta.handsPlayed ?? 0;
    const incHandsWon = delta.handsWon ?? 0;
    const incProfit = delta.totalProfit ?? 0;
    const newBiggest = delta.biggestPot != null ? Math.max(current.biggestPot, delta.biggestPot) : current.biggestPot;

    const res = await this.pool.query(
      `UPDATE player_statistics
       SET hands_played = hands_played + $2,
           hands_won = hands_won + $3,
           total_profit = total_profit + $4,
           biggest_pot = $5,
           last_updated = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId, incHandsPlayed, incHandsWon, incProfit, newBiggest],
    );
    return mapStatsRow(res.rows[0] as PlayerStatisticsRow);
  }

  async recordAchievement(userId: string, type: string, metadata?: any): Promise<AchievementRecord> {
    const res = await this.pool.query(
      `INSERT INTO achievements (user_id, achievement_type, metadata)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, type, metadata ?? null],
    );
    return mapAchievementRow(res.rows[0] as AchievementRow);
  }

  async listAchievements(userId: string, limit = 50, offset = 0): Promise<AchievementRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM achievements WHERE user_id = $1 ORDER BY achieved_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return (res.rows as AchievementRow[]).map(mapAchievementRow);
  }

  async getLeaderboard(metric: LeaderboardMetric, limit = 10): Promise<LeaderboardEntry[]> {
    const column = metric; // trusted from union type
    const res = await this.pool.query(
      `SELECT user_id, ${column} as value
       FROM player_statistics
       ORDER BY ${column} DESC NULLS LAST
       LIMIT $1`,
      [limit],
    );
    return (res.rows as any[]).map((r, idx) => ({ userId: r.user_id, value: toNumber(r.value), rank: idx + 1 }));
  }
}
