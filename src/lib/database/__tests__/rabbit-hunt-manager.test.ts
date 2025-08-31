import type { Pool } from 'pg';
import { RabbitHuntManager } from '../rabbit-hunt-manager';

const makePool = () => ({ query: jest.fn() }) as unknown as Pool;

describe('RabbitHuntManager (US-024)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('recordReveal inserts and maps', async () => {
    const pool = makePool();
    const query = (pool as any).query as jest.Mock;
    const row = {
      id: 'rh1', hand_id: 'h1', requested_by: 'u1', revealed_cards: ['Ah'], remaining_deck: ['2d'],
      revealed_at: new Date('2025-01-01T00:00:00Z').toISOString(), street: 'river',
    };
    query.mockResolvedValueOnce({ rows: [row] });
    const mgr = new RabbitHuntManager(pool);
    const rec = await mgr.recordReveal({ handId: 'h1', userId: 'u1', street: 'river', revealedCards: ['Ah'], remainingDeck: ['2d'] });
    expect(query).toHaveBeenCalledTimes(1);
    expect(rec).toEqual({
      id: 'rh1', handId: 'h1', requestedBy: 'u1', revealedCards: ['Ah'], remainingDeck: ['2d'], revealedAt: row.revealed_at, street: 'river',
    });
  });

  it('listReveals selects by hand with limit clamped', async () => {
    const pool = makePool();
    const query = (pool as any).query as jest.Mock;
    const rows = [{ id: 'rh1', hand_id: 'h1', requested_by: 'u1', revealed_cards: [], remaining_deck: [], revealed_at: new Date().toISOString(), street: 'flop' }];
    query.mockResolvedValueOnce({ rows });
    const mgr = new RabbitHuntManager(pool);
    await mgr.listReveals({ handId: 'h1', limit: 999 });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('FROM rabbit_hunt_history');
    expect(params).toEqual(['h1', 200]);
  });

  it('getCooldown returns null when not found', async () => {
    const pool = makePool();
    const query = (pool as any).query as jest.Mock;
    query.mockResolvedValueOnce({ rows: [] });
    const mgr = new RabbitHuntManager(pool);
    const cd = await mgr.getCooldown('u1', 'rabbit_hunt');
    expect(cd).toBeNull();
  });

  it('setCooldown upserts and maps', async () => {
    const pool = makePool();
    const query = (pool as any).query as jest.Mock;
    const row = { id: 'c1', user_id: 'u1', feature_type: 'rabbit_hunt', last_used: new Date().toISOString(), next_available: new Date().toISOString() };
    query.mockResolvedValueOnce({ rows: [row] });
    const mgr = new RabbitHuntManager(pool);
    const out = await mgr.setCooldown('u1', 'rabbit_hunt', row.next_available);
    expect(out.userId).toBe('u1');
    expect(out.featureType).toBe('rabbit_hunt');
  });
});
