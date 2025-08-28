import { describe, test, expect } from '@jest/globals';
import { GameHistoryManager } from '../game-history-manager';

// Small integration-style test to exercise JSONB probes and index usage intent

type QueryCall = { text: string; params?: any[] };

class StubClient {
  public calls: QueryCall[] = [];
  async query(text: string, params?: any[]) {
    this.calls.push({ text, params });

    // Simulate EXPLAIN ANALYZE response when requested
    if (text.trim().toUpperCase().startsWith('EXPLAIN')) {
      return {
        rows: [
          { 'QUERY PLAN': 'Bitmap Index Scan on game_history using idx_game_history_action_sequence_gin' },
          { 'QUERY PLAN': '  Recheck Cond: (action_sequence @> $1::jsonb)' },
          { 'QUERY PLAN': '  Heap Blocks: exact=42' }
        ],
        rowCount: 3
      };
    }

    // Basic count query mock (handles any count query)
    if (text.toLowerCase().includes('select count(*) from game_history')) {
      return { rows: [{ count: 0 }], rowCount: 1 };
    }

    // Basic select query mock
    if (text.toLowerCase().startsWith('select gh.* from game_history')) {
      return { rows: [], rowCount: 0 };
    }

    // Default
    return { rows: [], rowCount: 0 };
  }
  release() {/* no-op */}
}

class StubPool {
  private client = new StubClient();
  async connect() { return this.client; }
  getClient() { return this.client; }
}

describe('GameHistoryManager.getPlayerGameHistory JSONB optimization', () => {
  test('uses JSONB containment operators and supports index-friendly EXPLAIN', async () => {
    const pool = new StubPool();
    // Cast to any to satisfy constructor typing from pg.Pool
    const manager = new GameHistoryManager(pool as unknown as any);

    // Exercise the method
    const res = await manager.getPlayerGameHistory('player-123', { limit: 10, offset: 0 });

    // Validate shape
    expect(res).toHaveProperty('records');
    expect(Array.isArray(res.records)).toBe(true);

    const client = pool.getClient();
    const calls = client.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);

    // Capture the SELECT query (second call)
  const selectCall = calls.find(c => c.text.trim().toLowerCase().startsWith('select gh.* from game_history'))!;
    expect(selectCall).toBeDefined();

    // Ensure JSONB containment is used instead of LIKE
    expect(selectCall.text).toContain('action_sequence @>');
    expect(selectCall.text).toContain('results @>');
    expect(selectCall.text.toLowerCase()).not.toContain('like');

    // Non-prod EXPLAIN ANALYZE check (simulated)
    const explainSql = `EXPLAIN ANALYZE ${selectCall.text}`;
    const explain = await client.query(explainSql, selectCall.params);
    const explainText = explain.rows.map((r: any) => Object.values(r)[0]).join('\n');

    // Assert plan indicates index usage on JSONB via GIN
    expect(explainText).toMatch(/Index Scan|Bitmap Index Scan/i);
    expect(explainText).toMatch(/idx_game_history_action_sequence_gin|idx_game_history_results_gin/);
  });
});
