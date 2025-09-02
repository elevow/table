/**
 * Tournament types and configuration models for US-057
 */

export type TournamentType = 'freezeout' | 'rebuy' | 'knockout' | 'satellite';

export interface BlindLevel {
  level: number;
  durationMinutes: number; // per-level duration in minutes
  smallBlind: number;
  bigBlind: number;
  ante?: number;
}

export interface BreakSchedule {
  afterLevel: number; // a break occurs after this level completes
  durationMinutes: number;
}

export interface PayoutTier {
  place: number; // 1 = winner, 2 = runner-up, etc.
  percentage: number; // 0 < percentage <= 100; typically tiers sum to ~100
}

export interface TournamentConfig {
  type: TournamentType;
  blindLevels: BlindLevel[];
  startingStack: number;
  payoutStructure: PayoutTier[];
  breaks: BreakSchedule[];
  lateRegistration: {
    enabled: boolean;
    endLevel: number; // last level where late registration is allowed
    endTime: number; // minutes from tournament start when late reg ends
  };
  // Optional rebuy/add-on rules
  rebuys?: {
    enabled: boolean;
    maxPerPlayer?: number; // 0/undefined = unlimited
    availableUntilLevel?: number; // inclusive
    cost: number; // buy-in cost for a rebuy (currency units)
    stack: number; // chips granted per rebuy
    feePercent?: number; // optional fee
  };
  addOn?: {
    enabled: boolean;
    availableAtBreakAfterLevel?: number; // add-on available at the break after this level
    cost: number;
    stack: number;
    feePercent?: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
