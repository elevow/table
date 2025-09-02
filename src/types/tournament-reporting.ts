export type RegistrationEventType = 'register' | 'rebuy' | 'addOn';

export interface TimelineEntry {
  at: number; // epoch ms
  type: RegistrationEventType;
  userId?: string;
}

export interface EliminationRecord {
  userId: string;
  at: number; // epoch ms
  place: number; // finishing place at time of elimination
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
  statistics: TournamentStats;
}
