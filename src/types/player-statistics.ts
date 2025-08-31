// US-022: Player Statistics & Achievements - Type Definitions

export type LeaderboardMetric = 'total_profit' | 'hands_won' | 'hands_played' | 'biggest_pot';

export interface PlayerStatisticsRecord {
  id: string;
  userId: string;
  handsPlayed: number;
  handsWon: number;
  totalProfit: number; // DECIMAL in DB, use number in app
  biggestPot: number;  // DECIMAL in DB, use number in app
  lastUpdated: Date;
  gameSpecificStats?: any;
}

export interface PlayerStatisticsRow {
  id: string;
  user_id: string;
  hands_played: number | string;
  hands_won: number | string;
  total_profit: number | string;
  biggest_pot: number | string;
  last_updated: Date;
  game_specific_stats?: any;
}

export interface PlayerStatisticsDelta {
  handsPlayed?: number; // increment by value
  handsWon?: number;    // increment by value
  totalProfit?: number; // increment by value (can be negative)
  biggestPot?: number;  // set-if-greater
}

export interface AchievementRecord {
  id: string;
  userId: string;
  achievementType: string;
  achievedAt: Date;
  metadata?: any;
}

export interface AchievementRow {
  id: string;
  user_id: string;
  achievement_type: string;
  achieved_at: Date;
  metadata?: any;
}

export interface LeaderboardEntry {
  userId: string;
  value: number;
  rank: number;
}
