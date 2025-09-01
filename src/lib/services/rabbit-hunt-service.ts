import type { Pool } from 'pg';
import { RabbitHuntManager } from '../database/rabbit-hunt-manager';
import { GameManager } from '../database/game-manager';
import { createPokerEngine } from '../poker/engine-factory';
import type { ActiveGameRecord } from '../../types/game';
import { PokerEngine } from '../poker/poker-engine';
import type { Card } from '../../types/poker';
import type { RequestRabbitHuntInput, ListRevealsQuery, RabbitHuntRecord, FeatureCooldown } from '../../types/rabbit-hunt';

export class RabbitHuntService {
  private mgr: RabbitHuntManager;
  private gameMgr: GameManager;

  constructor(pool: Pool) {
    this.mgr = new RabbitHuntManager(pool);
    this.gameMgr = new GameManager(pool);
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

  // US-031: Service-level preview that uses the engine to compute reveal and deck snapshot
  async preview(params: {
    roomId: string;
    street: 'flop' | 'turn' | 'river';
    knownCards?: string[]; // optional known cards to exclude (DB format)
    communityCards?: string[]; // optional community snapshot (DB format)
    callerUserId?: string; // optional caller (for RLS/permissions)
  }): Promise<{ street: 'flop' | 'turn' | 'river'; revealedCards: string[]; remainingDeck: string[] }>
  {
    if (!params.roomId) throw new Error('roomId required');
    if (!params.street) throw new Error('street required');
    const game: ActiveGameRecord | null = params.callerUserId
      ? await this.gameMgr.getActiveGameByRoom(params.roomId, params.callerUserId)
      : await this.gameMgr.getActiveGameByRoom(params.roomId);
    if (!game) throw new Error('No active game for room');

    // Prepare players placeholder: we only need blinds to construct engine; state can be minimal
    const state = (game.state || {}) as any;
    const players = (state.players ?? []).length > 0 ? state.players : [
      { id: 'sb', name: 'sb', position: 1, stack: 100, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 },
      { id: 'bb', name: 'bb', position: 2, stack: 100, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 },
    ];

    const engine = createPokerEngine({
      tableId: game.id,
      players,
      smallBlind: state.smallBlind ?? 1,
      bigBlind: state.bigBlind ?? 2,
      state: { bettingMode: state.bettingMode, requireRunItTwiceUnanimous: !!state.requireRunItTwiceUnanimous },
    });

    // Convert DB strings to Card[] for known/community, then prep the engine deck
    const toCard = (s: string) => PokerEngine.fromDbCard(s);
    const known: Card[] = (params.knownCards ?? []).map(toCard);
    const community: Card[] = (params.communityCards ?? state.communityCards ?? []).map(toCard);
    engine.prepareRabbitPreview({ community, known });

    const out = engine.previewRabbitHunt(params.street);
    return {
      street: out.street,
      revealedCards: out.cards.map(PokerEngine.toDbCard),
      remainingDeck: out.remainingDeck.map(PokerEngine.toDbCard),
    };
  }
}
