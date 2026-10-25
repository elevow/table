import type { NextApiResponse } from 'next';
import * as GameSeats from '../shared/game-seats';
import { publishSeatClaimed, publishSeatState, publishSeatVacated, publishTableEvent } from '../realtime/publisher';
import { fetchRoomRebuyLimit } from '../shared/rebuy-limit';
import { fetchRoomBuyIn } from '../shared/buyin-amount';
import { getPlayerRebuyInfo, recordBuyin } from '../shared/rebuy-tracker';
import { getOrRestoreEngine, persistEngineState } from '../poker/engine-persistence';
import { recordLedger } from './chip-ledger';
import { advanceSeatOffer, freeSeatNumbers, loadRoom, updateRoomConfig, type TableExtrasConfig } from './room-config';
import { broadcastGameState } from './game-action-pipeline';
import { finishHand } from './hand-records';

export type SeatClaimResult = { status: number; body: Record<string, unknown> };

/**
 * Seat a player: checks the seat is free and the rebuy limit, stacks them with the room's buy-in,
 * saves and announces the seat, and records the buy-in in the ledger.
 */
export async function performSeatClaim(roomId: string, seatNumber: number, playerId: string, playerName: string): Promise<SeatClaimResult> {
  const seats = await GameSeats.loadPersistedRoomSeats(roomId) || GameSeats.initializeRoomSeats(roomId);

  if (seats[seatNumber] !== null && seats[seatNumber] !== undefined) {
    return { status: 409, body: { error: 'Seat already occupied', seatNumber } };
  }
  const existing = Object.entries(seats).find(([, a]) => a?.playerId === playerId);
  if (existing) {
    return { status: 409, body: { error: 'Player already has a seat', seatNumber: Number(existing[0]) } };
  }

  const rebuyLimit = await fetchRoomRebuyLimit(roomId);
  const buyInAmount = await fetchRoomBuyIn(roomId);
  const previous = getPlayerRebuyInfo(roomId, playerId);
  const isInitial = !previous;
  const rebuysUsed = previous?.rebuys ?? 0;
  const numericLimit = rebuyLimit === 'unlimited' ? Number.POSITIVE_INFINITY : rebuyLimit;
  if (!isInitial && rebuysUsed >= numericLimit) {
    const message = rebuyLimit === 'unlimited'
      ? 'Rebuys are currently unavailable.'
      : `Rebuy limit (${rebuyLimit}) reached for this room.`;
    return { status: 403, body: { error: message, rebuyLimit, rebuysUsed } };
  }

  // Stack size always comes from the room's buy-in; a client-sent chip count is ignored
  const chipAmount = buyInAmount;
  seats[seatNumber] = { playerId, playerName, chips: chipAmount };
  GameSeats.setRoomSeats(roomId, seats);
  if (!await GameSeats.persistRoomSeats(roomId, seats)) {
    seats[seatNumber] = null;
    GameSeats.setRoomSeats(roomId, seats);
    return { status: 503, body: { error: 'Unable to persist seat assignment' } };
  }

  const seatPayload = { seatNumber, playerId, playerName, chips: chipAmount };
  try {
    await Promise.all([publishSeatClaimed(roomId, seatPayload), publishSeatState(roomId, { seats })]);
  } catch (pubErr) {
    console.warn('Seat claim Supabase publish failed:', pubErr);
  }

  const rebuyRecord = recordBuyin(roomId, playerId);
  await recordLedger({ roomId, playerId, playerName, kind: isInitial ? 'buy_in' : 'rebuy', amount: chipAmount });

  // A waitlisted player who sits down leaves the waitlist (and their offer, if it was theirs)
  const room = await loadRoom(roomId).catch(() => null);
  const config = (room?.configuration || {}) as TableExtrasConfig;
  if ((config.waitlist || []).some(w => w.playerId === playerId) || config.seatOffer?.playerId === playerId) {
    await updateRoomConfig(roomId, {
      waitlist: (config.waitlist || []).filter(w => w.playerId !== playerId),
      seatOffer: config.seatOffer?.playerId === playerId ? null : config.seatOffer ?? null,
    });
    await publishTableEvent(roomId, { type: 'waitlist' }).catch(() => {});
  }

  return { status: 200, body: { ok: true, ...seatPayload, seats, rebuyCount: rebuyRecord.rebuys } };
}

/**
 * Offer free seats to the waitlist (and drop anyone whose offer lapsed). Announces any change.
 */
export async function syncWaitlist(roomId: string): Promise<void> {
  try {
    const room = await loadRoom(roomId);
    if (!room) return;
    const seats = await GameSeats.loadPersistedRoomSeats(roomId) || GameSeats.getRoomSeats(roomId);
    const config = room.configuration as TableExtrasConfig;
    const next = advanceSeatOffer(config, freeSeatNumbers(seats, room.maxPlayers), Date.now());
    if (!next.changed) return;
    await updateRoomConfig(roomId, { waitlist: next.waitlist, seatOffer: next.seatOffer });
    await publishTableEvent(roomId, {
      type: next.seatOffer ? 'waitlist_offer' : 'waitlist',
      ...(next.seatOffer ? { playerId: next.seatOffer.playerId, seatNumber: next.seatOffer.seatNumber, expiresAt: next.seatOffer.expiresAt } : {}),
    }).catch(() => {});
  } catch (err) {
    console.warn('[seat-actions] Waitlist update failed:', err);
  }
}

/**
 * A player leaves the table (stands up or is removed by the host): folded out of any hand in
 * progress and taken out of the game from the next hand, seat vacated, chips recorded as cashed
 * out, and the seat offered to the waitlist.
 */
export async function leaveTable(opts: {
  roomId: string;
  playerId: string;
  reason: string;
  res: NextApiResponse;
}): Promise<{ seatNumber: number | null; cashedOut: number }> {
  const { roomId, playerId, reason, res } = opts;
  const seats = await GameSeats.loadPersistedRoomSeats(roomId) || GameSeats.getRoomSeats(roomId);
  const entry = Object.entries(seats).find(([, a]) => a?.playerId === playerId);
  const seatNumber = entry ? Number(entry[0]) : null;
  const assignment = entry ? entry[1] : null;
  let cashedOut = Number(assignment?.chips) || 0;

  // Fold them out of the game; their stack in the game is what they leave with
  try {
    const engine = await getOrRestoreEngine(roomId);
    const gamePlayer = engine?.getState().players.find(p => p.id === playerId);
    if (engine && gamePlayer) {
      engine.removePlayer(playerId);
      let state = engine.getState();
      const active = state.players.filter(p => !p.isFolded).length;
      if (active === 1 && state.stage !== 'showdown') {
        engine.ensureWinByFoldIfSingle();
        state = engine.getState();
      }
      cashedOut = state.players.find(p => p.id === playerId)?.stack ?? 0;
      await persistEngineState(roomId, engine);
      await broadcastGameState(roomId, res, state, { playerId, action: reason === 'kicked' ? 'removed_by_host' : 'auto_fold_on_stand_up' });
      if (state.stage === 'showdown') await finishHand(roomId, state);
    }
  } catch (err) {
    console.warn('[seat-actions] Could not fold leaving player out of the game:', err);
  }

  if (seatNumber !== null) {
    seats[seatNumber] = null;
    GameSeats.setRoomSeats(roomId, seats);
    await GameSeats.persistRoomSeats(roomId, seats);
    try {
      await Promise.all([
        publishSeatVacated(roomId, { seatNumber, playerId, reason }),
        publishSeatState(roomId, { seats }),
      ]);
    } catch (pubErr) {
      console.warn('Seat vacate Supabase publish failed:', pubErr);
    }
    await recordLedger({ roomId, playerId, playerName: assignment?.playerName, kind: 'cash_out', amount: cashedOut });
  }

  await syncWaitlist(roomId);
  return { seatNumber, cashedOut };
}
