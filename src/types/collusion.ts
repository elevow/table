export interface BettingPattern {
  playerId: string;
  hands: number;
  vpip: number; // voluntary put $ in pot (% of hands)
  pfr: number; // preflop raise or pre-aggression rate
  aggression: number; // (bets+raises)/calls
  suspicious?: boolean;
  notes?: string;
}

export interface PlayerGrouping {
  players: [string, string];
  coHands: number;
  ratio: number; // fraction of shared hands over the max hands for either player
  suspicious?: boolean;
  reason?: string;
}

export interface FoldingPattern {
  target: string; // player who folds
  vsPlayer: string; // aggressor
  opportunities: number; // times target faced aggression from vsPlayer
  foldToAggPct: number; // opportunities folded / opportunities
  suspicious?: boolean;
}

export interface ChipDumpingMetric {
  from: string;
  to: string;
  totalAmount: number;
  occurrences: number;
  suspicious?: boolean;
  reason?: string;
}

export interface SecurityAlert {
  id: string;
  type: 'betting' | 'grouping' | 'folding' | 'chip-dump';
  severity: 'low' | 'medium' | 'high';
  message: string;
  at: number;
  involved: string[];
}

export interface Evidence {
  type: 'hand' | 'pair-stats' | 'summary';
  description: string;
  data?: any;
}

export interface CollusionDetection {
  patterns: {
    betting: BettingPattern[];
    grouping: PlayerGrouping[];
    folding: FoldingPattern[];
    chipDumping: ChipDumpingMetric[];
  };
  alerts: SecurityAlert[];
  confidence: number;
  evidence: Evidence[];
}
