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
  buyIn?: number; // each entry's contribution to the prize pool (currency units); unset means free
  entryFee?: number; // charged on top of the buy-in for the house; not in the prize pool
  // Knockout: each entry and rebuy also puts `amount` on the player's head, paid to whoever knocks them out.
  // 'progressive' pays half and adds the other half to the knocker's own bounty.
  bounty?: { amount: number; type: 'standard' | 'progressive' };
  seatsPerTable?: number; // seats at each table, 2-9 (a game room's size); defaults to 9
  maxPlayers?: number; // registration closes at this many players; unset means no cap
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
    cost: number; // what a rebuy costs (currency units); goes to the prize pool less feePercent
    stack: number; // chips granted per rebuy
    feePercent?: number; // share of the cost kept by the house
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
