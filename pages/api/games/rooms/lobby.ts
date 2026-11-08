import { getPool } from '../../../../src/lib/database/pool';
import { getSessionUser } from '../../../../src/lib/auth/auth-utils';
import { getUserAccess, hasPermission } from '../../../../src/lib/auth/access-control';
import { countSeatedInConfig } from '../../../../src/lib/shared/game-seats';
import { BETTING_MODE_LABELS, isBettingMode, variantLabel } from '../../../../src/lib/poker/variant-rules';
import { apiHandler } from '../../../../src/lib/api/handler';
import { envFlag } from '../../../../src/lib/config/env';

export interface LobbyTable {
  id: string;
  name: string;
  game: string;
  smallBlind: number | null;
  bigBlind: number | null;
  seated: number;
  maxPlayers: number;
  host: string | null;
  status: string;
  isPrivate: boolean;
  isHost: boolean;
  createdAt: string;
}

// Rooms are never closed automatically, so empty ones drop off the lobby after this long
const EMPTY_ROOM_HOURS = 6;

const SEATS = `CASE WHEN jsonb_typeof(r.configuration->'seats') = 'object' THEN r.configuration->'seats' ELSE '{}'::jsonb END`;
const COLUMNS = `r.id, r.name, r.max_players, r.blind_levels, r.status, r.created_at, r.created_by, r.configuration, u.username AS host_name`;

/** "No Limit Texas Hold'em", "Dealer's Choice", "Mixed games" */
function gameName(config: Record<string, any>): string {
  if (config.variant === 'dealers-choice') return 'Dealer\'s Choice';
  if (config.variant === 'mixed') return 'Mixed games';
  const variant = variantLabel(config.variant);
  return isBettingMode(config.bettingMode) ? `${BETTING_MODE_LABELS[config.bettingMode]} ${variant}` : variant;
}

function toLobbyTable(row: any, userId: string | null): LobbyTable {
  const config = row.configuration && typeof row.configuration === 'object' ? row.configuration : {};
  const blinds = row.blind_levels && typeof row.blind_levels === 'object' ? row.blind_levels : {};
  const maxPlayers = Math.min(9, Math.max(2, Number(row.max_players) || 9));
  return {
    id: String(row.id),
    name: String(row.name || 'Table'),
    game: gameName(config),
    smallBlind: Number(blinds.sb ?? blinds.smallBlind) || null,
    bigBlind: Number(blinds.bb ?? blinds.bigBlind) || null,
    seated: countSeatedInConfig(config, maxPlayers),
    maxPlayers,
    host: row.host_name ? String(row.host_name) : null,
    status: String(row.status || 'waiting'),
    isPrivate: config.visibility === 'private',
    isHost: !!userId && String(row.created_by) === userId,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * GET /api/games/rooms/lobby
 *
 * The dashboard's table lists:
 * - open: public tables that have someone seated or were created in the last few hours, busiest
 *   first (needs lobby.view)
 * - mine: the signed-in user's private tables, ones they host or joined through an invite link
 */
export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 120, message: 'Too many requests' } }, async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const access = await getUserAccess(user);
    // The e2e run has no tables to list
    if (envFlag('USE_MOCK_DB')) {
      return res.status(200).json({ open: [], mine: [], canView: hasPermission(access, 'lobby.view') });
    }
    const userId = user?.id ?? null;
    const pool = getPool();

    let open: LobbyTable[] = [];
    if (hasPermission(access, 'lobby.view')) {
      const result = await pool.query(
        `SELECT ${COLUMNS}
         FROM game_rooms r LEFT JOIN users u ON u.id = r.created_by
         WHERE COALESCE(r.configuration->>'visibility', 'public') <> 'private'
           AND COALESCE(r.status, 'waiting') <> 'closed'
           AND NOT COALESCE((r.configuration->>'closed')::boolean, false)
           AND (r.created_at > NOW() - INTERVAL '${EMPTY_ROOM_HOURS} hours'
                OR EXISTS (SELECT 1 FROM jsonb_each(${SEATS}) s WHERE jsonb_typeof(s.value) = 'object'))
         ORDER BY r.created_at DESC
         LIMIT 100`
      );
      open = result.rows
        .map(row => toLobbyTable(row, userId))
        .sort((a, b) => b.seated - a.seated || b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50);
    }

    let mine: LobbyTable[] = [];
    if (userId) {
      const result = await pool.query(
        `SELECT ${COLUMNS}
         FROM game_rooms r LEFT JOIN users u ON u.id = r.created_by
         WHERE r.configuration->>'visibility' = 'private'
           AND COALESCE(r.status, 'waiting') <> 'closed'
           AND NOT COALESCE((r.configuration->>'closed')::boolean, false)
           AND (r.created_by::text = $1
                OR (jsonb_typeof(r.configuration->'members') = 'array' AND r.configuration->'members' ? $1))
         ORDER BY r.created_at DESC
         LIMIT 20`,
        [userId]
      );
      mine = result.rows.map(row => toLobbyTable(row, userId));
    }

    return res.status(200).json({ open, mine, canView: hasPermission(access, 'lobby.view') });
  } catch (err) {
    console.error('Error loading lobby:', err);
    return res.status(500).json({ error: 'Unable to load tables' });
  }
});
