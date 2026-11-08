import { getPool } from '../../../src/lib/database/pool';
import { getAuthenticatedUserId } from '../../../src/lib/auth/auth-utils';
import { PlayerStatisticsManager } from '../../../src/lib/database/player-statistics-manager';
import { PLAYER_HANDS_SQL } from '../../../src/lib/server/hidden-hands';
import { groupSessions, type ProfitHand } from '../../../src/lib/shared/profit-sessions';
import { apiHandler } from '../../../src/lib/api/handler';
import { computeHudStats, type HudStats } from '../../../src/lib/shared/hud-stats';
import { PROFIT_HAND_LIMIT } from './profit';
import { HUD_HAND_LIMIT } from './hud';

export interface StatsSummary {
  handsPlayed: number;
  handsWon: number;
  profit: number;
  biggestPot: number;
  winnings: number;
  losses: number;
  sessions: number;
  timePlayedMs: number;
  // How you play (VPIP, PFR, 3-bet, aggression) over your most recent hands, as the HUD shows others
  hud: HudStats;
}

// This player's net in one hand, read out of the players list so nobody's cards leave the database
const MY_NET = `(SELECT (elem->>'net')::numeric FROM jsonb_array_elements(players) elem WHERE elem->>'id' = $1 LIMIT 1)`;

/**
 * GET /api/stats/summary
 *
 * The signed-in player's lifetime totals for the lobby. Hands, pots won, profit and biggest pot
 * come from the same table as the leaderboard, so the two always agree; winnings, losses and
 * sessions come from their hand records, like the profit graph.
 */
export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 60, message: 'Too many requests' } }, async (req, res) => {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  try {
    const pool = getPool();
    const [record, totals, recent, played] = await Promise.all([
      new PlayerStatisticsManager(pool).getByUserId(userId),
      pool.query(
        `SELECT COALESCE(SUM(GREATEST(net, 0)), 0) AS winnings, COALESCE(SUM(GREATEST(-net, 0)), 0) AS losses
         FROM (SELECT ${MY_NET} AS net FROM hand_records WHERE ${PLAYER_HANDS_SQL}) mine`,
        [userId]
      ),
      pool.query(
        `SELECT room_id, started_at, ended_at FROM hand_records
         WHERE ${PLAYER_HANDS_SQL}
         ORDER BY ended_at DESC
         LIMIT $2`,
        [userId, PROFIT_HAND_LIMIT]
      ),
      // Only the action lists, never cards
      pool.query(
        `SELECT actions, variant, kind FROM hand_records
         WHERE ${PLAYER_HANDS_SQL}
         ORDER BY ended_at DESC
         LIMIT $2`,
        [userId, HUD_HAND_LIMIT]
      ),
    ]);

    const hands: ProfitHand[] = recent.rows.map(row => ({
      handId: '',
      roomId: String(row.room_id),
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      endedAt: new Date(row.ended_at).toISOString(),
      net: 0,
    }));
    const sessions = groupSessions(hands);

    const summary: StatsSummary = {
      handsPlayed: record?.handsPlayed ?? 0,
      handsWon: record?.handsWon ?? 0,
      profit: record?.totalProfit ?? 0,
      biggestPot: record?.biggestPot ?? 0,
      winnings: Number(totals.rows[0]?.winnings) || 0,
      losses: Number(totals.rows[0]?.losses) || 0,
      sessions: sessions.length,
      timePlayedMs: sessions.reduce((sum, s) => sum + s.durationMs, 0),
      hud: computeHudStats(played.rows.map(row => {
        const actions = typeof row.actions === 'string' ? safeParse(row.actions) : row.actions;
        return { actions: Array.isArray(actions) ? actions : [], variant: row.variant, kind: row.kind };
      }), userId),
    };
    return res.status(200).json(summary);
  } catch (err) {
    console.error('Error loading stats summary:', err);
    return res.status(500).json({ error: 'Unable to load your statistics' });
  }
});

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return []; }
}
