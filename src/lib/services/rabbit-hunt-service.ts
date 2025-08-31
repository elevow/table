import type { Pool } from 'pg';
import { RabbitHuntManager } from '../database/rabbit-hunt-manager';
import type { RequestRabbitHuntInput, ListRevealsQuery, RabbitHuntRecord, FeatureCooldown } from '../../types/rabbit-hunt';

export class RabbitHuntService {
  private mgr: RabbitHuntManager;

  constructor(pool: Pool) {
    this.mgr = new RabbitHuntManager(pool);
  }

  async requestReveal(input: RequestRabbitHuntInput): Promise<RabbitHuntRecord> {
    if (!input.handId) throw new Error('handId required');
    if (!input.userId) throw new Error('userId required');
    if (!input.street) throw new Error('street required');
    if (!Array.isArray(input.revealedCards)) throw new Error('revealedCards required');
    if (!Array.isArray(input.remainingDeck)) throw new Error('remainingDeck required');

    // Enforce basic cooldown check (feature: rabbit_hunt)
    const now = Date.now();
    const cooldown = await this.mgr.getCooldown(input.userId, 'rabbit_hunt');
    if (cooldown && new Date(cooldown.nextAvailable).getTime() > now) {
      throw new Error('Feature on cooldown');
    }

    // Record reveal and set next cooldown (simple 60s window)
    const record = await this.mgr.recordReveal(input);
    const next = new Date(now + 60_000).toISOString();
    await this.mgr.setCooldown(input.userId, 'rabbit_hunt', next);
    return record;
  }

  async listReveals(q: ListRevealsQuery): Promise<RabbitHuntRecord[]> {
    if (!q.handId) throw new Error('handId required');
    return this.mgr.listReveals(q);
  }

  async getCooldown(userId: string): Promise<FeatureCooldown | null> {
    if (!userId) throw new Error('userId required');
    return this.mgr.getCooldown(userId, 'rabbit_hunt');
  }
}
