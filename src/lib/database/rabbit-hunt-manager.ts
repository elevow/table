import type { Pool } from 'pg';
import type {
  RabbitHuntRow,
  RabbitHuntRecord,
  FeatureCooldownRow,
  FeatureCooldown,
  RequestRabbitHuntInput,
  ListRevealsQuery,
} from '../../types/rabbit-hunt';

function mapReveal(row: RabbitHuntRow): RabbitHuntRecord {
  return {
    id: row.id,
    handId: row.hand_id,
    requestedBy: row.requested_by,
    revealedCards: row.revealed_cards ?? [],
    remainingDeck: row.remaining_deck ?? [],
    revealedAt: row.revealed_at,
    street: row.street,
  };
}

function mapCooldown(row: FeatureCooldownRow): FeatureCooldown {
  return {
    id: row.id,
    userId: row.user_id,
    featureType: row.feature_type,
    lastUsed: row.last_used,
    nextAvailable: row.next_available,
  };
}

export class RabbitHuntManager {
  constructor(private pool: Pool) {}

  async recordReveal(input: RequestRabbitHuntInput): Promise<RabbitHuntRecord> {
    const res = await this.pool.query(
      `INSERT INTO rabbit_hunt_history (hand_id, requested_by, revealed_cards, remaining_deck, street)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.handId, input.userId, input.revealedCards, input.remainingDeck, input.street]
    );
    return mapReveal(res.rows[0] as RabbitHuntRow);
  }

  async listReveals(q: ListRevealsQuery): Promise<RabbitHuntRecord[]> {
    const limit = Math.max(1, Math.min(200, Number(q.limit ?? 50)));
    const res = await this.pool.query(
      `SELECT * FROM rabbit_hunt_history
       WHERE hand_id = $1
       ORDER BY revealed_at ASC
       LIMIT $2`,
      [q.handId, limit]
    );
    return (res.rows as RabbitHuntRow[]).map(mapReveal);
  }

  async getCooldown(userId: string, featureType: string): Promise<FeatureCooldown | null> {
    const res = await this.pool.query(
      `SELECT * FROM feature_cooldowns WHERE user_id = $1 AND feature_type = $2`,
      [userId, featureType]
    );
    if (!res.rows[0]) return null;
    return mapCooldown(res.rows[0] as FeatureCooldownRow);
  }

  async setCooldown(userId: string, featureType: string, nextAvailable: string): Promise<FeatureCooldown> {
    const res = await this.pool.query(
      `INSERT INTO feature_cooldowns (user_id, feature_type, last_used, next_available)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (user_id, feature_type)
       DO UPDATE SET last_used = NOW(), next_available = EXCLUDED.next_available
       RETURNING *`,
      [userId, featureType, nextAvailable]
    );
    return mapCooldown(res.rows[0] as FeatureCooldownRow);
  }
}
