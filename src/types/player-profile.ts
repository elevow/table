// US-009: Player Profile Storage - TypeScript Types and Interfaces

export interface Player {
  id: string;
  username: string;
  email: string;
  passwordHash?: string; // Only for server-side operations
  avatarUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  lastLogin?: Date;
  bankroll: number;
  stats: PlayerStats;
  isActive: boolean;
  emailVerified: boolean;
  verificationToken?: string;
  resetToken?: string;
  resetTokenExpires?: Date;
}

export interface PlayerStats {
  // General gameplay stats
  totalHands: number;
  totalProfit: number;
  biggestWin: number;
  biggestLoss: number;
  totalSessionTime: number; // in minutes
  
  // Poker-specific stats
  vpip: number; // Voluntary Put In Pot percentage
  pfr: number; // Pre-flop Raise percentage
  aggressionFactor: number;
  
  // Achievement and progress stats
  achievements: string[];
  level: number;
  experience: number;
  
  // Behavioral stats
  averageSessionLength: number;
  gamesPerWeek: number;
  preferredStakes: string[];
  
  // Additional custom stats
  [key: string]: any;
}

export interface BankrollTransaction {
  id: string;
  playerId: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  transactionType: TransactionType;
  description?: string;
  gameId?: string;
  createdAt: Date;
  metadata: Record<string, any>;
}

export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  GAME_WIN = 'game_win',
  GAME_LOSS = 'game_loss',
  RAKE = 'rake',
  BONUS = 'bonus',
  REFUND = 'refund',
  ADMIN_ADJUSTMENT = 'admin_adjustment'
}

export interface PlayerGameStats {
  id: string;
  playerId: string;
  gameType: string;
  stakesLevel: string;
  handsPlayed: number;
  totalProfit: number;
  biggestWin: number;
  biggestLoss: number;
  vpip: number;
  pfr: number;
  aggressionFactor: number;
  totalSessionTime: number;
  lastPlayed?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlayerAchievement {
  id: string;
  playerId: string;
  achievementType: string;
  achievementName: string;
  description?: string;
  earnedAt: Date;
  metadata: Record<string, any>;
}

export interface PlayerPreferences {
  id: string;
  playerId: string;
  category: PreferenceCategory;
  preferences: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export enum PreferenceCategory {
  UI = 'ui',
  GAME = 'game',
  NOTIFICATIONS = 'notifications',
  PRIVACY = 'privacy',
  SOUND = 'sound',
  DISPLAY = 'display'
}

export interface PlayerSummary {
  player: Player;
  totalHandsPlayed: number;
  totalProfit: number;
  recentActivity: BankrollTransaction[];
  gameStats: PlayerGameStats[];
  achievements: PlayerAchievement[];
  preferences: PlayerPreferences[];
}

export interface CreatePlayerRequest {
  username: string;
  email: string;
  password: string;
  avatarUrl?: string;
  initialDeposit?: number;
}

export interface UpdatePlayerRequest {
  username?: string;
  email?: string;
  avatarUrl?: string;
  stats?: Partial<PlayerStats>;
}

export interface BankrollUpdateRequest {
  playerId: string;
  amount: number;
  transactionType: TransactionType;
  description?: string;
  gameId?: string;
  metadata?: Record<string, any>;
}

export interface BankrollUpdateResponse {
  success: boolean;
  previousBalance: number;
  newBalance: number;
  transactionId: string;
}

export interface PlayerQueryOptions {
  includeStats?: boolean;
  includeRecentActivity?: boolean;
  includeAchievements?: boolean;
  includePreferences?: boolean;
  activityLimit?: number;
}

export interface PlayerFilters {
  username?: string;
  email?: string;
  isActive?: boolean;
  emailVerified?: boolean;
  minBankroll?: number;
  maxBankroll?: number;
  createdAfter?: Date;
  createdBefore?: Date;
  lastLoginAfter?: Date;
}

export interface PaginationOptions {
  page: number;
  limit: number;
  sortBy?: 'username' | 'email' | 'bankroll' | 'createdAt' | 'lastLogin';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedPlayersResponse {
  players: Player[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Database connection and configuration types
export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  poolSize?: number;
  idleTimeoutMs?: number;
}

export interface PlayerProfileError extends Error {
  code: string;
  details?: Record<string, any>;
}

// Validation schemas for runtime type checking
export const PlayerValidationRules = {
  username: {
    minLength: 3,
    maxLength: 50,
    pattern: /^[a-zA-Z0-9_-]+$/
  },
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  password: {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: false
  },
  bankroll: {
    min: 0,
    max: 999999999.99,
    precision: 2
  }
} as const;
