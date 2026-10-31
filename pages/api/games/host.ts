import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { logAdminAction, requirePlayerAccess, sendPermissionDenied } from '../../../src/lib/auth/access-control';
import { canOnTable, isTableOwner } from '../../../src/lib/auth/table-access';
import { getOrRestoreEngine, persistEngineState, STALE_STATE_RESPONSE } from '../../../src/lib/poker/engine-persistence';
import { sanitizeStateForPlayer } from '../../../src/lib/poker/state-sanitizer';
import { broadcastGameState } from '../../../src/lib/server/game-action-pipeline';
import { leaveTable, performSeatClaim, syncWaitlist } from '../../../src/lib/server/seat-actions';
import { loadRoom, updateRoomConfig, type TableExtrasConfig } from '../../../src/lib/server/room-config';
import { publishTableEvent } from '../../../src/lib/realtime/publisher';
import * as GameSeats from '../../../src/lib/shared/game-seats';
import { MIN_TURN_SECONDS, MAX_TURN_SECONDS } from '../../../src/lib/shared/turn-clock';
import { isStudVariant } from '../../../src/lib/poker/variant-rules';

type HostAction =
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'set-blinds'; smallBlind: number; bigBlind: number }
  | { action: 'allow-straddle'; allow: boolean }
  | { action: 'allow-run-it-twice'; allow: boolean }
  | { action: 'set-turn-time'; seconds: number }
  | { action: 'adjust-time-banks'; targetId: string; delta: number }
  | { action: 'bomb-pot'; anteBB: number | null }
  | { action: 'kick'; targetId: string }
  | { action: 'require-approval'; required: boolean }
  | { action: 'approve'; targetId: string }
  | { action: 'deny'; targetId: string };

// The host permission each action needs
const ACTION_PERMISSIONS: Record<HostAction['action'], string> = {
  'pause': 'room.start',
  'resume': 'room.start',
  'set-blinds': 'room.configure',
  'allow-straddle': 'room.configure',
  'allow-run-it-twice': 'room.configure',
  'set-turn-time': 'room.configure',
  'adjust-time-banks': 'room.configure',
  'bomb-pot': 'room.configure',
  'kick': 'room.kick_player',
  'require-approval': 'room.approve_seat',
  'approve': 'room.approve_seat',
  'deny': 'room.approve_seat',
};

/**
 * POST /api/games/host { tableId, action, ... }
 *
 * Controls for the room's host (its creator): pause and resume, change blinds for the next hand,
 * allow straddles and run it twice, schedule a bomb pot, remove a player, and approve who sits down.
 * Each needs its host permission; staff with admin.rooms.manage can use them on any table.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = (req.body || {}) as { tableId?: string; playerId?: string } & HostAction;
  const access = await requirePlayerAccess(req, res, body.playerId);
  if (!access) return;
  const hostId = access.userId;
  const tableId = body.tableId;
  if (!tableId) return res.status(400).json({ error: 'Missing tableId' });
  const permission = ACTION_PERMISSIONS[body.action];
  if (!permission) return res.status(400).json({ error: 'Unknown host action' });

  try {
    const room = await loadRoom(tableId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const auth = canOnTable(access, room, permission);
    if (!auth.allowed) {
      if (isTableOwner(access, room)) return sendPermissionDenied(res, permission, access);
      return res.status(403).json({ error: 'Only the host can do that' });
    }
    if (auth.asAdmin) {
      const { tableId: _t, playerId: _p, ...details } = body;
      await logAdminAction(hostId, `table.${body.action}`, 'room', tableId, details);
    }
    const config = room.configuration as TableExtrasConfig;

    // Settings that live on the room rather than in a running game
    switch (body.action) {
      case 'require-approval': {
        await updateRoomConfig(tableId, { requireSeatApproval: !!body.required });
        await publishTableEvent(tableId, { type: 'settings' }).catch(() => {});
        return res.status(200).json({ ok: true });
      }
      case 'approve':
      case 'deny': {
        const request = (config.seatRequests || []).find(r => r.playerId === body.targetId);
        if (!request) return res.status(404).json({ error: 'No such seat request' });
        await updateRoomConfig(tableId, { seatRequests: (config.seatRequests || []).filter(r => r.playerId !== body.targetId) });
        let result: { status: number; body: Record<string, unknown> } = { status: 200, body: { ok: true } };
        if (body.action === 'approve') {
          // The requested seat, or the first free one if it was taken meanwhile
          const seats = await GameSeats.loadPersistedRoomSeats(tableId) || GameSeats.getRoomSeats(tableId);
          let seat = request.seatNumber;
          if (seats[seat]) {
            const free = Object.keys(seats).map(Number).filter(n => n <= room.maxPlayers && !seats[n]);
            if (!free.length) return res.status(409).json({ error: 'No free seat for this player' });
            seat = free[0];
          }
          result = await performSeatClaim(tableId, seat, request.playerId, request.playerName);
        }
        await publishTableEvent(tableId, {
          type: 'seat_request_resolved',
          playerId: request.playerId,
          approved: body.action === 'approve' && result.status === 200,
        }).catch(() => {});
        return res.status(result.status).json(result.body);
      }
      case 'kick': {
        if (!body.targetId || body.targetId === hostId) return res.status(400).json({ error: 'Choose another player to remove' });
        const { seatNumber, cashedOut } = await leaveTable({ roomId: tableId, playerId: body.targetId, reason: 'kicked', res });
        // Also drop them from the waitlist and any pending request
        await updateRoomConfig(tableId, {
          waitlist: (config.waitlist || []).filter(w => w.playerId !== body.targetId),
          seatRequests: (config.seatRequests || []).filter(r => r.playerId !== body.targetId),
        });
        await publishTableEvent(tableId, { type: 'kicked', playerId: body.targetId }).catch(() => {});
        await syncWaitlist(tableId);
        return res.status(200).json({ ok: true, seatNumber, cashedOut });
      }
      case 'allow-straddle': {
        await updateRoomConfig(tableId, { allowStraddle: !!body.allow });
        await publishTableEvent(tableId, { type: 'settings' }).catch(() => {});
        break; // also applied to the running game below
      }
      case 'allow-run-it-twice': {
        await updateRoomConfig(tableId, { allowRunItTwice: !!body.allow });
        await publishTableEvent(tableId, { type: 'settings' }).catch(() => {});
        break; // also applied to the running game below
      }
      case 'set-blinds': {
        const sb = Number(body.smallBlind);
        const bb = Number(body.bigBlind);
        if (!(sb > 0) || !(bb >= sb)) return res.status(400).json({ error: 'Blinds must be positive and the big blind at least the small blind' });
        // New games at this table start with these blinds too
        await getPool().query(
          `UPDATE game_rooms SET blind_levels = COALESCE(blind_levels, '{}'::jsonb) || jsonb_build_object('sb', $2::numeric, 'bb', $3::numeric) WHERE id = $1`,
          [tableId, sb, bb]
        );
        const cached = (global as any).roomConfigs?.get?.(tableId);
        if (cached) Object.assign(cached, { smallBlind: sb, bigBlind: bb });
        break;
      }
      case 'set-turn-time': {
        const seconds = Number(body.seconds);
        if (!Number.isFinite(seconds) || seconds < MIN_TURN_SECONDS || seconds > MAX_TURN_SECONDS) {
          return res.status(400).json({ error: `Turn time must be ${MIN_TURN_SECONDS}-${MAX_TURN_SECONDS} seconds` });
        }
        // New games at this table use it too
        await updateRoomConfig(tableId, { turnTimeSeconds: Math.round(seconds) });
        break;
      }
      case 'adjust-time-banks':
        if (!body.targetId || !Number.isFinite(Number(body.delta)) || Number(body.delta) === 0) {
          return res.status(400).json({ error: 'Choose a player and how many time banks to add or remove' });
        }
        break;
      case 'pause':
      case 'resume':
      case 'bomb-pot':
        break;
      default:
        return res.status(400).json({ error: 'Unknown host action' });
    }

    // Changes to the running game
    const engine = await getOrRestoreEngine(tableId);
    if (!engine) {
      if (body.action === 'allow-straddle' || body.action === 'allow-run-it-twice' || body.action === 'set-blinds' || body.action === 'set-turn-time') {
        return res.status(200).json({ ok: true });
      }
      return res.status(404).json({ error: 'No active game found for this table' });
    }
    try {
      if (body.action === 'pause') engine.setPaused(true);
      else if (body.action === 'resume') engine.setPaused(false);
      else if (body.action === 'set-blinds') engine.setPendingBlinds(Number(body.smallBlind), Number(body.bigBlind));
      else if (body.action === 'allow-straddle') engine.setAllowStraddle(!!body.allow);
      else if (body.action === 'allow-run-it-twice') engine.setAllowRunItTwice(!!body.allow);
      else if (body.action === 'set-turn-time') engine.setTurnTime(Number(body.seconds));
      else if (body.action === 'adjust-time-banks') engine.adjustTimeBanks(body.targetId, Number(body.delta));
      else if (body.action === 'bomb-pot') {
        const variant = engine.getState().variant;
        if (body.anteBB !== null && isStudVariant(variant)) {
          return res.status(409).json({ error: 'Bomb pots are for Hold\'em and Omaha' });
        }
        engine.setBombPotNext(body.anteBB === null ? null : Number(body.anteBB));
      }
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || 'Cannot do that now' });
    }
    if ((await persistEngineState(tableId, engine)) === 'conflict') return res.status(409).json(STALE_STATE_RESPONSE);
    const state = await broadcastGameState(tableId, res, engine.getState(), { action: `host_${body.action}`, playerId: hostId });
    return res.status(200).json({ ok: true, gameState: sanitizeStateForPlayer(state, hostId) });
  } catch (err) {
    console.error('Error handling host action:', err);
    return res.status(500).json({ error: 'Unable to complete host action' });
  }
}
