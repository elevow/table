export interface RabbitHuntRow {
  id: string;
  hand_id: string;
  requested_by: string;
  revealed_cards: string[] | null;
  remaining_deck: string[] | null;
  revealed_at: string;
  street: string;
}

export interface RabbitHuntRecord {
  id: string;
  handId: string;
  requestedBy: string;
  revealedCards: string[];
  remainingDeck: string[];
  revealedAt: string;
  street: string;
}

export interface FeatureCooldownRow {
  id: string;
  user_id: string;
  feature_type: string;
  last_used: string;
  next_available: string;
}

export interface FeatureCooldown {
  id: string;
  userId: string;
  featureType: string;
  lastUsed: string;
  nextAvailable: string;
}

export interface RequestRabbitHuntInput {
  handId: string;
  userId: string;
  street: string; // e.g., flop | turn | river
  revealedCards: string[]; // cards revealed by rabbit hunt
  remainingDeck: string[]; // remaining deck state after reveal
}

export interface ListRevealsQuery {
  handId: string;
  limit?: number;
}
