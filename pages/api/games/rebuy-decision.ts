import type { NextApiRequest, NextApiResponse } from 'next';
import { publishRebuyResult, publishSeatState, publishSeatVacated, publishGameStateUpdate } from '../../../src/lib/realtime/publisher';
import {
  BASE_REBUY_CHIPS,
  clearPendingRebuy,
  getRebuyAvailability,
  pendingRebuyCount,
} from '../../../src/lib/server/rebuy-state';
import { recordBuyin } from '../../../src/lib/shared/rebuy-tracker';
import * as GameSeats from '../../../src/lib/shared/game-seats';
import { nextSeq } from '../../../src/lib/realtime/sequence';
import { clearRunItState, enrichStateWithRunIt } from '../../../src/lib/poker/run-it-twice-manager';

/**
 * After a rebuy decision, check if we can start the next hand.
 * We need at least 2 players with chips > 0 and no pending rebuy prompts.
 */
async function maybeStartNextHand(tableId: string, engine: any): Promise<boolean> {
  if (!engine || typeof engine.getState !== 'function') {
    return false;
  }

  const state = engine.getState();
  if (!state || !Array.isArray(state.players)) {
    return false;
  }

  // Only auto-start if we're in showdown stage (hand is over)
  if (state.stage !== 'showdown') {
    return false;
  }

  // Count players with money
  const playersWithMoney = state.players.filter((p: any) => (Number(p.stack) || 0) > 0);
  const pendingCount = pendingRebuyCount(tableId);

  console.log(`[rebuy-decision] Players with money: ${playersWithMoney.length}, pending rebuys: ${pendingCount}`);

  // Need at least 2 players with money and no pending rebuy decisions
  if (playersWithMoney.length >= 2 && pendingCount === 0) {
    console.log(`[rebuy-decision] Starting next hand for table ${tableId}`);
    
    // Clear Run-It-Twice state for new hand
    clearRunItState(tableId);

    // Start the next hand
    if (typeof engine.startNewHand === 'function') {
      engine.startNewHand();
      
      const newState = engine.getState();
      const enrichedState = enrichStateWithRunIt(tableId, newState);
      const sequence = nextSeq(tableId);

      await publishGameStateUpdate(tableId, {
        gameState: enrichedState,
        seq: sequence,
        lastAction: { action: 'next_hand_started', playerId: 'system', reason: 'rebuy_complete' },
        timestamp: new Date().toISOString(),
      });

      return true;
    }
  }

  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tableId, playerId, decision } = req.body;

    if (!tableId || !playerId || (decision !== 'yes' && decision !== 'no')) {
      return res.status(400).json({ error: 'Missing or invalid parameters' });
    }

    const g: any = global as any;
    const engine = g?.activeGames?.get(tableId);

    if (decision === 'yes') {
      const availability = await getRebuyAvailability(tableId, playerId);
      if (!availability.canRebuy) {
        return res.status(403).json({ error: 'Rebuy limit reached', ...availability });
      }

      // Record the rebuy
      const trackerRecord = recordBuyin(tableId, playerId);
      clearPendingRebuy(tableId, playerId);

      // Update player stack in game engine if available
      if (engine && typeof engine.getState === 'function') {
        const state = engine.getState();
        if (state && Array.isArray(state.players)) {
          const player = state.players.find((p: any) => p.id === playerId);
          if (player) {
            player.stack = BASE_REBUY_CHIPS;
            player.currentBet = 0;
            player.isAllIn = false;
            player.isFolded = false;
            player.hasActed = false;
          }
        }
      }

      // Update seat assignment
      const seats = GameSeats.getRoomSeats(tableId);
      for (const [seatStr, assignment] of Object.entries(seats)) {
        if (assignment && assignment.playerId === playerId) {
          const seatNumber = parseInt(seatStr, 10);
          seats[seatNumber] = {
            playerId: assignment.playerId,
            playerName: assignment.playerName,
            chips: BASE_REBUY_CHIPS,
          };
          GameSeats.setRoomSeats(tableId, seats);
          await publishSeatState(tableId, { seats });
          break;
        }
      }

      await publishRebuyResult(tableId, {
        tableId,
        playerId,
        status: 'accepted',
        rebuysUsed: trackerRecord.rebuys,
        stack: BASE_REBUY_CHIPS,
      });

      // Check if we can start the next hand now
      const handStarted = await maybeStartNextHand(tableId, engine);

      return res.status(200).json({
        success: true,
        status: 'accepted',
        rebuysUsed: trackerRecord.rebuys,
        stack: BASE_REBUY_CHIPS,
        nextHandStarted: handStarted,
      });
    } else {
      // Player declined rebuy - stand them up
      clearPendingRebuy(tableId, playerId);

      // Remove player from game engine
      if (engine && typeof engine.getState === 'function') {
        const state = engine.getState();
        if (state && Array.isArray(state.players)) {
          // Remove player from the players array immediately if in showdown
          if (state.stage === 'showdown') {
            const idx = state.players.findIndex((p: any) => p.id === playerId);
            if (idx !== -1) {
              state.players.splice(idx, 1);
              console.log(`[rebuy-decision] Removed player ${playerId} from game (was at index ${idx})`);
            }
          }
        }
        // Also mark for removal at next hand start (in case stage changes)
        if (typeof engine.removePlayer === 'function') {
          engine.removePlayer(playerId);
        }
      }

      // Vacate seat
      const seats = GameSeats.getRoomSeats(tableId);
      for (const [seatStr, assignment] of Object.entries(seats)) {
        if (assignment?.playerId === playerId) {
          const seatNumber = parseInt(seatStr, 10);
          seats[seatNumber] = null;
          GameSeats.setRoomSeats(tableId, seats);
          await publishSeatVacated(tableId, { seatNumber, playerId, reason: 'rebuy_declined' });
          await publishSeatState(tableId, { seats });
          break;
        }
      }

      await publishRebuyResult(tableId, {
        tableId,
        playerId,
        status: 'declined',
      });

      // Check if we can start the next hand now (remaining players may have enough)
      const handStarted = await maybeStartNextHand(tableId, engine);

      return res.status(200).json({ success: true, status: 'declined', nextHandStarted: handStarted });
    }
  } catch (error) {
    console.error('Error processing rebuy decision:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
