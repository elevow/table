export type RegistrationEventType = 'register' | 'rebuy' | 'addOn' | 'reentry';

export interface TimelineEntry {
  at: number; // epoch ms
  type: RegistrationEventType;
  userId?: string;
}

export interface EliminationRecord {
  userId: string;
  at: number; // epoch ms
  place: number; // finishing place at time of elimination
  eliminatedBy?: string;
  bounty?: number; // bounty cash the knocker won
}

export interface PrizeDistribution {
  place: number;
  amount: number;
}

export interface TournamentStats {
  totalRegistrations: number;
  totalEliminations: number;
  remainingPlayers: number;
  currentLevelIndex: number;
}

export interface TournamentReporting {
  registration: {
    total: number;
    timeline: TimelineEntry[];
    rebuys?: number;
  };
  eliminations: EliminationRecord[];
  prizePool: {
    total: number;
    distributions: PrizeDistribution[];
  };
  bounties?: {
    type: 'standard' | 'progressive';
    amount: number; // bounty bought with each entry and rebuy
    total: number; // all bounty money put up
    winnings: Record<string, number>; // bounty cash won, by player
    outstanding: Record<string, number>; // bounty still on each player's head
  };
  statistics: TournamentStats;
}
