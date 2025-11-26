import { randomInt } from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';
import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { WebSocketManager } from '../../src/lib/websocket-manager';
import { GameService } from '../../src/lib/services/game-service';
import { getPool } from '../../src/lib/database/pool';
import { publishSeatClaimed, publishSeatState, publishSeatVacated } from '../../src/lib/realtime/publisher';
import { RunItTwicePrompt, TableState, Card, GameStage } from '../../src/types/poker';
import { HandInterface } from '../../src/types/poker-engine';
import {
  getRunItState,
  clearRunItState,
  disableRunItPrompt,
  enrichStateWithRunIt,
  isAutoRunoutEligible,
  maybeCreateRunItPrompt,
  determineRunItTwicePrompt,
  normalizeHandForComparison,
  RunItTwiceState,
} from '../../src/lib/poker/run-it-twice-manager';

// Extend the response type to include the socket server
interface NextApiResponseServerIO extends NextApiResponse {
  socket: any & {
    server: HttpServer & {
      io?: SocketServer;
    };
  };
}

const emitGameStateUpdate = (io: SocketServer, tableId: string, state: TableState | any, lastAction: any) => {
  const enriched = enrichStateWithRunIt(tableId, state);
  io.to(`table_${tableId}`).emit('game_state_update', {
    gameState: enriched,
    lastAction,
    timestamp: new Date().toISOString(),
  });
};

const revealAllHoleCards = (engine: any, state: TableState): TableState => {
  try {
    const engineState = engine?.getState?.();
    if (!engineState) return state;
    const enginePlayers = Array.isArray(engineState.players) ? engineState.players : [];
    const mergedPlayers = Array.isArray(state.players)
      ? state.players.map((player: any) => {
          const engPlayer = enginePlayers.find((ep: any) => ep.id === player.id);
          const engCards = Array.isArray(engPlayer?.holeCards) ? engPlayer.holeCards : [];
          if (!engCards.length) return player;
          const alreadyVisible = Array.isArray(player.holeCards) && player.holeCards.length >= engCards.length;
          if (alreadyVisible) return player;
          return { ...player, holeCards: engCards };
        })
      : state.players;
    return { ...state, players: mergedPlayers } as TableState;
  } catch {
    return state;
  }
};

// Import shared game seats management
import * as GameSeats from '../../src/lib/shared/game-seats';
import { fetchRoomRebuyLimit } from '../../src/lib/shared/rebuy-limit';
import { getPlayerRebuyInfo, recordBuyin } from '../../src/lib/shared/rebuy-tracker';
import {
  BASE_REBUY_CHIPS,
  clearPendingRebuy,
  getPendingRebuys,
  getRebuyAvailability,
  hasPendingRebuy,
  pendingRebuyCount,
  setPendingRebuy
} from '../../src/lib/server/rebuy-state';
import { autoStandPlayer, applyRebuy } from '../../src/lib/server/rebuy-actions';

// Initialize seat management handlers
function initializeSeatHandlers(res: NextApiResponseServerIO) {
  const io = res.socket.server.io;
  if (!io) return;

  // [auto-runout] env-gated debug helper for this runtime path
  const autoRunoutDebug = !!process.env.AUTO_RUNOUT_DEBUG;
  const logAutoRunout = (tableId: string, gameState: any, context: string) => {
    if (!autoRunoutDebug) return;
    try {
      const players = Array.isArray(gameState?.players) ? gameState.players : [];
      const activeCount = players.filter((p: any) => !(p.isFolded || (p as any).folded)).length;
      const anyAllIn = players.some((p: any) => !(p.isFolded || (p as any).folded) && p.isAllIn);
      const nonAllInCount = players.filter((p: any) => !(p.isFolded || (p as any).folded) && !p.isAllIn).length;
      const communityLen = Array.isArray(gameState?.communityCards) ? gameState.communityCards.length : 0;
      const need = Math.max(0, 5 - communityLen);
      const stage = gameState?.stage;
      console.log('[auto-runout]', context, { tableId, stage, activeCount, anyAllIn, nonAllInCount, need, communityLen });
      if (activeCount >= 2 && anyAllIn && nonAllInCount <= 1 && need > 0 && stage !== 'showdown') {
        console.log('[auto-runout] gating met in socketio.ts (note: this route does not auto-reveal streets)');
      } else {
        console.log('[auto-runout] gating not met in socketio.ts');
      }
    } catch (e) {
      console.log('[auto-runout] debug error in socketio.ts', e);
    }
  };

  // Support hot-reload: version the handlers and rebind when changed
  const HANDLERS_VERSION = 10; // bump to force reinit after code changes
  if (io._handlersVersion !== HANDLERS_VERSION) {
    if (io._seatHandlersAdded) {
      try {
        console.log(`Rebinding Socket.IO handlers (old version=${io._handlersVersion}, new=${HANDLERS_VERSION})`);
        io.removeAllListeners('connection');
      } catch (e) {
        console.warn('Failed to remove previous connection listeners:', e);
      }
      io._seatHandlersAdded = false;
    }
    io._handlersVersion = HANDLERS_VERSION;
  } else if (io._seatHandlersAdded) {
    // Already initialized with current version
    return;
  }
  
  console.log('Adding seat management handlers...');

  // Debug flag for verbose seat flow diagnostics
  const seatDebug = (() => {
    const v = String(process.env.SEAT_DEBUG || '').toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  })();
  const dlog = (...args: any[]) => {
    if (seatDebug) {
      try { console.log('[seat-debug]', ...args); } catch {}
    }
  };

  // Auto next-hand scheduler (per table)
  const NEXT_HAND_DELAY_MS = 5000;
  if (!(global as any).nextHandTimers) {
    (global as any).nextHandTimers = new Map<string, NodeJS.Timeout>();
  }
  const nextHandTimers: Map<string, NodeJS.Timeout> = (global as any).nextHandTimers;

  // Auto-runout timers per table (street reveals)
  if (!(global as any).autoRunoutTimers) {
    (global as any).autoRunoutTimers = new Map<string, NodeJS.Timeout[]>();
  }
  const autoRunoutTimers: Map<string, NodeJS.Timeout[]> = (global as any).autoRunoutTimers;

  const clearAutoRunout = (tableId: string) => {
    const arr = autoRunoutTimers.get(tableId);
    if (arr && arr.length) {
      console.log('[auto-runout] clearing timers (socketio)', { tableId, count: arr.length });
      arr.forEach(t => clearTimeout(t));
    }
    autoRunoutTimers.delete(tableId);
  };

  const scheduleAutoRunout = (tableId: string) => {
    try {
      // Require active engine
      if (!(global as any).activeGames || !(global as any).activeGames.has(tableId)) return;
      const engine = (global as any).activeGames.get(tableId);
      const state = engine?.getState?.() || {};
      const variant = state?.variant;
      if (variant === 'seven-card-stud' || variant === 'seven-card-stud-hi-lo' || variant === 'five-card-stud') {
        if (autoRunoutDebug) console.log('[auto-runout] skip: variant not supported in socketio', { tableId, variant });
        return;
      }
      const communityLen = Array.isArray(state.communityCards) ? state.communityCards.length : 0;
      if (!isAutoRunoutEligible(state)) {
        if (autoRunoutDebug) console.log('[auto-runout] not scheduling (socketio): gating not met', { tableId, stage: state.stage, communityLen });
        return;
      }
      if (autoRunoutTimers.has(tableId) && autoRunoutTimers.get(tableId)!.length > 0) {
        if (autoRunoutDebug) console.log('[auto-runout] not scheduling (socketio): timers already active', { tableId });
        return;
      }

      const pendingPrompt = getRunItState(tableId).prompt;
      if (pendingPrompt) {
        if (autoRunoutDebug) console.log('[auto-runout] awaiting existing Run It Twice prompt', { tableId, promptPlayer: pendingPrompt.playerId });
        clearAutoRunout(tableId);
        return;
      }
      const promptState = (() => {
        try {
          const engineState = engine?.getState?.();
          const enginePlayers = Array.isArray(engineState?.players) ? engineState.players : [];
          if (!enginePlayers.length) return state;
          const mergedPlayers = (Array.isArray(state.players) ? state.players : []).map((player: any) => {
            const engPlayer = enginePlayers.find((ep: any) => ep.id === player.id);
            const engCards = Array.isArray(engPlayer?.holeCards) ? engPlayer.holeCards : [];
            if (!engCards.length) return player;
            const alreadyVisible = Array.isArray(player.holeCards) && player.holeCards.length >= engCards.length;
            if (alreadyVisible) return player;
            return { ...player, holeCards: engCards };
          });
          return { ...state, players: mergedPlayers };
        } catch {
          return state;
        }
      })();
      const prompt = maybeCreateRunItPrompt(tableId, promptState);
      if (prompt) {
        if (autoRunoutDebug) console.log('[auto-runout] issuing Run It Twice prompt', { tableId, promptPlayer: prompt.playerId });
        clearAutoRunout(tableId);
        const promptState = { ...state, activePlayer: prompt.playerId };
        emitGameStateUpdate(io, tableId, promptState, { action: 'run_it_twice_prompt', playerId: prompt.playerId });
        return;
      }

      const players = Array.isArray(state.players) ? state.players : [];

      // Prepare engine for deterministic previews
      try {
        const known: any[] = [];
        players.forEach((p: any) => (p.holeCards || []).forEach((c: any) => known.push(c)));
        const comm = Array.isArray(state.communityCards) ? state.communityCards : [];
        engine.prepareRabbitPreview?.({ community: comm, known });
      } catch {}

      // Hide action UI immediately
      try {
        const lockedState = { ...state, activePlayer: '' };
        emitGameStateUpdate(io, tableId, lockedState, { action: 'auto_runout_lock' });
      } catch {}

      const timers: NodeJS.Timeout[] = [];
    const steps: Array<'flop' | 'turn' | 'river'> = [];
    if (communityLen < 3) steps.push('flop');
    if (communityLen < 4) steps.push('turn');
    if (communityLen < 5) steps.push('river');

      let delay = 5000;
      for (const street of steps) {
        const t = setTimeout(() => {
          try {
            const currEngine = (global as any).activeGames.get(tableId);
            const prev = currEngine?.getState?.() || state;
            if (prev.stage === 'showdown') { clearAutoRunout(tableId); return; }
            if (autoRunoutDebug) console.log('[auto-runout] revealing (socketio)', { tableId, street });
            // preview cards and sync engine community
            const preview = currEngine?.previewRabbitHunt?.(street);
            const cards = preview?.cards || [];
            // Clone community BEFORE mutating engine state to avoid duplicating when building payload
            const baseCommunity = Array.isArray(prev?.communityCards) ? [...prev.communityCards] : [];
            try {
              const es = currEngine?.getState?.();
              if (es && Array.isArray(es.communityCards) && cards.length) {
                es.communityCards.push(...cards);
              }
            } catch {}
            // Build updated payload with hidden activePlayer
            const updated = { ...prev };
            updated.communityCards = [...baseCommunity, ...cards];
            updated.stage = street === 'flop' ? 'flop' : street === 'turn' ? 'turn' : 'river';
            (updated as any).activePlayer = '';
            emitGameStateUpdate(io, tableId, updated, { action: `auto_runout_${street}` });

            if (street === 'river') {
              const t2 = setTimeout(() => {
                try {
                  const eng = (global as any).activeGames.get(tableId);
                  if (autoRunoutDebug) console.log('[auto-runout] finalizing showdown (socketio)', { tableId });
                  try { eng?.finalizeToShowdown?.(); } catch {}
                  const finalState = eng?.getState?.() || updated;
                  emitGameStateUpdate(io, tableId, finalState, { action: 'auto_runout_showdown' });
                  if (finalState?.stage === 'showdown') {
                    scheduleNextHand(tableId);
                  }
                } finally {
                  clearAutoRunout(tableId);
                }
              }, 5000);
              timers.push(t2);
            }
          } catch {}
        }, delay);
        timers.push(t);
        delay += 5000;
      }

      autoRunoutTimers.set(tableId, timers);
      if (autoRunoutDebug) console.log('[auto-runout] scheduled timers (socketio)', { tableId, steps: steps.join(','), count: timers.length });
    } catch (e) {
      console.warn('scheduleAutoRunout (socketio) failed:', e);
    }
  };

  const scheduleNextHand = async (tableId: string) => {
    try {
      // Ensure a game exists and we're not already scheduled
      if (!(global as any).activeGames || !(global as any).activeGames.has(tableId)) {
        console.log(`[auto] Not scheduling: no active game for table ${tableId}`);
        return;
      }
      if (nextHandTimers.has(tableId)) {
        console.log(`[auto] Not scheduling: timer already exists for table ${tableId}`);
        return;
      }

      const engine = (global as any).activeGames.get(tableId);
      const state = engine?.getState?.() || {};
      // Only schedule from showdown state
      if (state.stage !== 'showdown') {
        console.log(`[auto] Not scheduling: stage is ${state.stage}, require showdown (table ${tableId})`);
        return;
      }

      const rebuyReady = await maybeHandleBustedPlayers(tableId, state);
      if (!rebuyReady) {
        console.log(`[rebuy] Pending decisions for table ${tableId}; deferring next hand`);
        return;
      }

      const schedulePlayers = Array.isArray(state.players) ? state.players.length : 0;
      console.log(`[auto] Scheduling next hand in ${NEXT_HAND_DELAY_MS}ms (table ${tableId}); players=${schedulePlayers}`);

      const timer = setTimeout(() => {
        try {
          if (!(global as any).activeGames || !(global as any).activeGames.has(tableId)) return;
          const engineNow = (global as any).activeGames.get(tableId);
          const curr = engineNow?.getState?.() || {};
          // If a new hand already started, skip
          if (curr.stage !== 'showdown') {
            console.log(`[auto] Timer fired but stage is ${curr.stage}; skipping start (table ${tableId})`);
            return;
          }
          const players = Array.isArray(curr.players) ? curr.players : [];
          const fundedPlayers = players.filter((p: any) => Number(p.stack) > 0);
          // Require at least two players to continue
          if (fundedPlayers.length < 2) {
            console.log(`[auto] Timer fired but not enough funded players (${fundedPlayers.length}) to start next hand (table ${tableId})`);
            return;
          }

          // Start next hand with a fresh engine instance to ensure latest logic (dev-friendly hot reload)
          console.log(`[auto] Starting next hand for table ${tableId}`);
          try { delete require.cache[require.resolve('../../src/lib/poker/poker-engine')]; } catch {}
          const { PokerEngine } = require('../../src/lib/poker/poker-engine');
          const sb = Number(curr.smallBlind) || 1;
          const bb = Number(curr.bigBlind) || 2;
          const variant = curr.variant || 'texas-holdem';
          const bettingMode = curr.bettingMode || (variant === 'omaha' || variant === 'omaha-hi-lo' ? 'pot-limit' : 'no-limit');
          // Rebuild players preserving id, name, position, and stack
          const rebuilt = fundedPlayers.map((p: any) => ({
            id: p.id,
            name: p.name || p.id,
            position: p.position,
            stack: p.stack,
            currentBet: 0,
            hasActed: false,
            isFolded: false,
            isAllIn: false,
            timeBank: p.timeBank ?? 30,
            holeCards: [],
          }));
          const freshEngine = new PokerEngine(tableId, rebuilt, sb, bb, { variant, bettingMode });
          // Preserve dealer position continuity by setting last dealer and allowing startNewHand() to rotate
          try { (freshEngine as any).state.dealerPosition = curr.dealerPosition ?? 0; } catch {}
          freshEngine.startNewHand();
          clearRunItState(tableId);
          (global as any).activeGames.set(tableId, freshEngine);
          const newState = freshEngine.getState();
          emitGameStateUpdate(io, tableId, newState, { action: 'auto_next_hand' });
          console.log(`[auto] Emitted game_state_update auto_next_hand (stage=${newState?.stage}, pot=${newState?.pot}) for table ${tableId}`);
        } catch (e) {
          console.error('Auto next hand failed:', e);
        } finally {
          nextHandTimers.delete(tableId);
        }
      }, NEXT_HAND_DELAY_MS);

      nextHandTimers.set(tableId, timer);
    } catch (err) {
      console.error('scheduleNextHand error:', err);
    }
  };

  const maybeHandleBustedPlayers = async (tableId: string, state: TableState): Promise<boolean> => {
    try {
      const players = Array.isArray(state.players) ? state.players : [];
      const busted = players.filter(p => (Number((p as any).stack) || 0) <= 0);
      if (!busted.length) {
        return pendingRebuyCount(tableId) === 0;
      }
      const rebuyLimit = await fetchRoomRebuyLimit(tableId);
      let promptsIssued = 0;
      for (const player of busted) {
        if (!player?.id) continue;
        if (hasPendingRebuy(tableId, player.id)) continue;
        const record = getPlayerRebuyInfo(tableId, player.id);
        const rebuysUsed = record?.rebuys ?? 0;
        const numericLimit = rebuyLimit === 'unlimited' ? Number.POSITIVE_INFINITY : rebuyLimit;
        if (rebuyLimit !== 'unlimited' && rebuysUsed >= numericLimit) {
          await autoStandPlayer(io, tableId, player.id, 'rebuy_exhausted');
          clearPendingRebuy(tableId, player.id);
          continue;
        }
        setPendingRebuy(tableId, player.id, {
          issuedAt: Date.now(),
          rebuysUsed,
          rebuyLimit,
        });
        const payload = {
          tableId,
          playerId: player.id,
          playerName: player.name,
          rebuysUsed,
          rebuyLimit,
          baseChips: BASE_REBUY_CHIPS,
          remaining: rebuyLimit === 'unlimited' ? 'unlimited' : Math.max((rebuyLimit as number) - rebuysUsed, 0),
        };
        io.to(`table_${tableId}`).emit('rebuy_prompt', payload);
        promptsIssued += 1;
      }
      return pendingRebuyCount(tableId) === 0 && promptsIssued === 0;
    } catch (err) {
      console.warn('maybeHandleBustedPlayers failed:', err);
      return true;
    }
  };
  
  io.on('connection', (socket: any) => {
    console.log('Client connected for seat management:', socket.id);

    // Handle joining a table
    socket.on('join_table', (data: { tableId: string; playerId: string }) => {
      // console.log('Player joining table:', data);
      const { tableId, playerId } = data;
      
      // Join the table room
      socket.join(`table_${tableId}`);
      
      // Store player info on socket
      socket.tableId = tableId;
      socket.playerId = playerId;
      
      // console.log(`Player ${playerId} joined table ${tableId}`);
    });

    // Handle seat claim requests
  socket.on('claim_seat', async (data: { tableId: string; seatNumber: number; playerId: string; playerName: string; chips: number }) => {
      const { tableId, seatNumber, playerId, playerName, chips } = data;
      const reqId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
      // Initial receive log
      try {
        const roomsArr = Array.from((socket.rooms || new Set<string>()) as Set<string>);
        dlog('claim_seat received', { reqId, socketId: socket.id, tableId, seatNumber, playerId, playerName, chips, rooms: roomsArr });
      } catch {}
      
      // Initialize and get game seats for this table
      const seats = GameSeats.initializeRoomSeats(tableId);
      try {
        const occupied = Object.entries(seats).filter(([, a]) => a).map(([n]) => Number(n));
        const existingSeat = Object.entries(seats).find(([, a]) => a?.playerId === playerId);
        dlog('pre-check seats', { reqId, tableId, occupied, existingSeat: existingSeat ? Number(existingSeat[0]) : null });
      } catch {}
      
      // Check if seat is available
      if (seats[seatNumber] !== null) {
        dlog('seat_claim_failed', { reqId, reason: 'occupied', tableId, seatNumber, playerId });
        socket.emit('seat_claim_failed', { 
          error: 'Seat already occupied', 
          seatNumber,
          reqId
        });
        return;
      }
      
      // Check if player already has a seat
      const playerCurrentSeat = Object.entries(seats).find(([_, assignment]) => 
        assignment?.playerId === playerId
      );
      
      if (playerCurrentSeat) {
        dlog('seat_claim_failed', { reqId, reason: 'already_seated', tableId, requested: seatNumber, current: parseInt(playerCurrentSeat[0]), playerId });
        socket.emit('seat_claim_failed', { 
          error: 'Player already has a seat', 
          seatNumber: parseInt(playerCurrentSeat[0]),
          reqId
        });
        return;
      }
      
      const rebuyLimit = await fetchRoomRebuyLimit(tableId);
      const previousRecord = getPlayerRebuyInfo(tableId, playerId);
      const isInitial = !previousRecord;
      const rebuysUsed = previousRecord?.rebuys ?? 0;
      const numericLimit = rebuyLimit === 'unlimited' ? Number.POSITIVE_INFINITY : rebuyLimit;

      if (!isInitial && rebuysUsed >= numericLimit) {
        const message = rebuyLimit === 'unlimited'
          ? 'Rebuy not available for this table.'
          : `Rebuy limit (${rebuyLimit}) reached for this room.`;
        dlog('seat_claim_failed', { reqId, reason: 'rebuy_limit', tableId, playerId, rebuysUsed, rebuyLimit });
        socket.emit('seat_claim_failed', {
          error: message,
          rebuyLimit,
          rebuysUsed,
          reqId,
        });
        return;
      }

      // Claim the seat
      seats[seatNumber] = { playerId, playerName, chips };
      GameSeats.setRoomSeats(tableId, seats);
      
      const seatPayload = { seatNumber, playerId, playerName, chips };
      // Broadcast to all players in the table
      io.to(`table_${tableId}`).emit('seat_claimed', seatPayload);
      try {
        const roomSize = res.socket.server.io?.sockets?.adapter?.rooms?.get?.(`table_${tableId}`)?.size ?? undefined;
        dlog('seat_claimed broadcast', { reqId, tableId, seatNumber, playerId, roomSize });
      } catch {}

      // Mirror into Supabase realtime for socket-less clients
      try {
        await Promise.all([
          publishSeatClaimed(tableId, seatPayload),
          publishSeatState(tableId, { seats })
        ]);
      } catch (pubErr) {
        console.warn('Seat claim Supabase publish failed (socketio):', pubErr);
      }
      
      recordBuyin(tableId, playerId);

      console.log(`Seat ${seatNumber} claimed by ${playerName} (${playerId}) at table ${tableId}`);
    });

    // Handle stand up requests
    socket.on('stand_up', async (data: { tableId: string; seatNumber: number; playerId: string }) => {
      console.log('Stand up request:', data);
      const { tableId, seatNumber, playerId } = data;
      
      const seats = GameSeats.getRoomSeats(tableId);
      if (!seats || Object.keys(seats).length === 0) {
        socket.emit('stand_up_failed', { error: 'Table not found' });
        return;
      }
      
      // Verify the player owns this seat
      if (seats[seatNumber]?.playerId !== playerId) {
        socket.emit('stand_up_failed', { error: 'Not your seat' });
        return;
      }
      
  // Vacate the seat
      seats[seatNumber] = null;
      GameSeats.setRoomSeats(tableId, seats);
      
      const vacatedPayload = { seatNumber, playerId };
      // Broadcast to all players in the table
      io.to(`table_${tableId}`).emit('seat_vacated', vacatedPayload);
      
      console.log(`Seat ${seatNumber} vacated by ${playerId} at table ${tableId}`);

      try {
        await Promise.all([
          publishSeatVacated(tableId, vacatedPayload),
          publishSeatState(tableId, { seats })
        ]);
      } catch (pubErr) {
        console.warn('Seat vacate Supabase publish failed (socketio stand_up):', pubErr);
      }

      // If a game is active, auto-fold the standing player and mark for removal next hand
      try {
        if ((global as any).activeGames && (global as any).activeGames.has(tableId)) {
          const engine = (global as any).activeGames.get(tableId);
          if (engine && typeof engine.removePlayer === 'function') {
            engine.removePlayer(playerId);
            let gameState = engine.getState();
            // Safety: if only one remains, settle now
            const activeCount = (gameState.players || []).filter((p: any) => !(p.isFolded || (p as any).folded)).length;
            if (activeCount === 1 && gameState.stage !== 'showdown' && typeof engine.ensureWinByFoldIfSingle === 'function') {
              engine.ensureWinByFoldIfSingle();
              gameState = engine.getState();
            }
            emitGameStateUpdate(io, tableId, gameState, { playerId, action: 'auto_fold_on_stand_up' });
            // If hand ended, schedule next
            if (gameState?.stage === 'showdown') {
              scheduleNextHand(tableId);
            }
          }
        }
      } catch (e) {
        console.warn('Auto-fold on stand_up failed:', e);
      }
    });

    // Handle seat state requests
    socket.on('get_seat_state', (data: { tableId: string }) => {
      console.log('Seat state request:', data);
      const { tableId } = data;
      
      // Initialize if not exists and get seats
      const seats = GameSeats.initializeRoomSeats(tableId);
      
      // Send current seat state to requesting client
      socket.emit('seat_state', { seats });
      
      console.log(`Sent seat state for table ${tableId}:`, seats);
    });

    // Handle player leaving the table (auto-fold if mid-hand)
    socket.on('leave_table', async (tableIdRaw: string) => {
      try {
        const tableId = tableIdRaw || socket.tableId;
        const playerId = socket.playerId;
        if (!tableId || !playerId) return;

        // Leave Socket.IO room
        socket.leave(`table_${tableId}`);

        // Vacate seat if seated
        try {
          const seats = GameSeats.getRoomSeats(tableId);
          if (seats) {
            const entry = Object.entries(seats).find(([, a]) => a?.playerId === playerId);
            if (entry) {
              const [seatStr] = entry;
              const seatNumber = parseInt(seatStr, 10);
              seats[seatNumber] = null;
              GameSeats.setRoomSeats(tableId, seats);
              const vacPayload = { seatNumber, playerId };
              io.to(`table_${tableId}`).emit('seat_vacated', vacPayload);
              try {
                await Promise.all([
                  publishSeatVacated(tableId, vacPayload),
                  publishSeatState(tableId, { seats })
                ]);
              } catch (pubErr) {
                console.warn('Seat vacate Supabase publish failed (leave_table):', pubErr);
              }
              console.log(`Player ${playerId} left; vacated seat ${seatNumber} at table ${tableId}`);
            }
          }
        } catch (e) {
          console.warn('leave_table seat cleanup failed:', e);
        }

        // If a game is active, auto-fold the leaving player and mark for removal next hand
        try {
          if ((global as any).activeGames && (global as any).activeGames.has(tableId)) {
            const engine = (global as any).activeGames.get(tableId);
            if (engine && typeof engine.removePlayer === 'function') {
              engine.removePlayer(playerId);
              let gameState = engine.getState();
              const activeCount = (gameState.players || []).filter((p: any) => !(p.isFolded || (p as any).folded)).length;
              if (activeCount === 1 && gameState.stage !== 'showdown' && typeof engine.ensureWinByFoldIfSingle === 'function') {
                engine.ensureWinByFoldIfSingle();
                gameState = engine.getState();
              }
              emitGameStateUpdate(io, tableId, gameState, { playerId, action: 'auto_fold_on_leave' });
              // [auto-runout] debug after auto-fold emit
              logAutoRunout(tableId, gameState, 'after leave_table auto_fold emit');
              if (gameState?.stage === 'showdown') {
                scheduleNextHand(tableId);
              }
            }
          }
        } catch (e) {
          console.warn('Auto-fold on leave_table failed:', e);
        }
      } catch (err) {
        console.error('leave_table handler error:', err);
      }
    });

      socket.on('rebuy_decision', async (data: { tableId: string; playerId: string; decision: 'yes' | 'no' }) => {
        try {
          const { tableId, playerId, decision } = data || ({} as any);
          if (!tableId || !playerId || (decision !== 'yes' && decision !== 'no')) {
            socket.emit('rebuy_decision_failed', { error: 'Invalid parameters' });
            return;
          }
          if (socket.playerId && socket.playerId !== playerId) {
            socket.emit('rebuy_decision_failed', { error: 'Cannot decide for another player' });
            return;
          }

          if (decision === 'yes') {
            const availability = await getRebuyAvailability(tableId, playerId);
            if (!availability.canRebuy) {
              socket.emit('rebuy_decision_failed', { error: 'Rebuy limit reached' });
              return;
            }
            const { record } = await applyRebuy(io, emitGameStateUpdate, tableId, playerId, BASE_REBUY_CHIPS);
            clearPendingRebuy(tableId, playerId);
            socket.emit('rebuy_ack', { tableId, playerId, status: 'accepted', rebuysUsed: record.rebuys, stack: BASE_REBUY_CHIPS });
            io.to(`table_${tableId}`).emit('rebuy_result', {
              tableId,
              playerId,
              status: 'accepted',
              rebuysUsed: record.rebuys,
              stack: BASE_REBUY_CHIPS,
            });
          } else {
            clearPendingRebuy(tableId, playerId);
            await autoStandPlayer(io, tableId, playerId, 'rebuy_declined');
            socket.emit('rebuy_ack', { tableId, playerId, status: 'declined' });
            io.to(`table_${tableId}`).emit('rebuy_result', { tableId, playerId, status: 'declined' });
          }

          scheduleNextHand(tableId);
        } catch (err: any) {
          console.error('rebuy_decision failed:', err);
          socket.emit('rebuy_decision_failed', { error: err?.message || 'Rebuy failed' });
        }
      });

    // Handle game start requests
  socket.on('start_game', async (data: { tableId: string; playerId: string; seatedPlayers: any[] }) => {
      console.log('Game start request:', data);
      const { tableId, playerId, seatedPlayers } = data;
      
      // Validate that the player is seated and there are enough players
      if (seatedPlayers.length < 2) {
        socket.emit('game_start_failed', { error: 'Not enough players to start game' });
        return;
      }
      
      try {
        // Import poker engine dynamically and clear from require cache to ensure latest code after edits (dev-friendly)
        try {
          delete require.cache[require.resolve('../../src/lib/poker/game-state-manager')];
        } catch {}
        try {
          delete require.cache[require.resolve('../../src/lib/poker/poker-engine')];
        } catch {}
        const { PokerEngine } = require('../../src/lib/poker/poker-engine');
        const { Player } = require('../../src/types/poker');
        
        // Convert seated players to Player objects required by poker engine
        // Sort by seat number to ensure consistent position ordering
        const sortedSeatedPlayers = seatedPlayers.sort((a, b) => a.seatNumber - b.seatNumber);
        
        const players = sortedSeatedPlayers.map((seated, index) => ({
          id: seated.playerId,
          name: seated.playerName,
          position: index + 1, // Use 1-based indexing: 1, 2, 3, ... (position 1 = small blind, position 2 = big blind)
          stack: seated.chips || 20, // Default $20 stack
          currentBet: 0,
          hasActed: false,
          isFolded: false,
          isAllIn: false,
          timeBank: 30, // 30 seconds to act
          holeCards: []
        }));
        
        // Determine blinds and variant/mode from room configuration if available
        let smallBlind = 1;
        let bigBlind = 2;
  let variant: 'texas-holdem' | 'omaha' | 'omaha-hi-lo' | 'seven-card-stud' | 'seven-card-stud-hi-lo' | 'five-card-stud' = 'texas-holdem';
        let bettingMode: 'no-limit' | 'pot-limit' = 'no-limit';
        try {
          // Attempt to load room by id using GameService
          const pool = getPool();
          const service = new GameService(pool as any);
          const room = await service.getRoomById(tableId);
          if (room && room.blindLevels) {
            const bl = room.blindLevels as any;
            // Support either { sb, bb } or { small, big } shapes
            const sb = Number(bl.sb ?? bl.small);
            const bb = Number(bl.bb ?? bl.big);
            if (Number.isFinite(sb) && Number.isFinite(bb) && sb > 0 && bb >= sb * 2) {
              smallBlind = parseFloat(sb.toFixed(2));
              bigBlind = parseFloat(bb.toFixed(2));
            } else if (Number.isFinite(sb) && Number.isFinite(bb) && sb > 0 && bb > sb) {
              // Looser validation if exact 2x isn't enforced in room config
              smallBlind = parseFloat(sb.toFixed(2));
              bigBlind = parseFloat(bb.toFixed(2));
            } else {
              console.warn(`Invalid room blindLevels for table ${tableId}; using defaults 1/2`, bl);
            }
          }
          // Pull variant and betting mode from room configuration if provided
          const cfg = (room?.configuration || {}) as any;
          if (cfg.variant === 'omaha' || cfg.variant === 'omaha-hi-lo' || cfg.variant === 'texas-holdem' || cfg.variant === 'seven-card-stud' || cfg.variant === 'seven-card-stud-hi-lo' || cfg.variant === 'five-card-stud') {
            variant = cfg.variant;
          }
          if (cfg.bettingMode === 'no-limit' || cfg.bettingMode === 'pot-limit') {
            bettingMode = cfg.bettingMode;
          } else if (variant === 'omaha' || variant === 'omaha-hi-lo') {
            // Default Omaha variants to pot-limit when not explicitly set
            bettingMode = 'pot-limit';
          }
        } catch (e) {
          console.warn('Failed to load room-configured blinds; defaulting to 1/2:', e);
        }

        // Create poker engine instance with resolved blind structure
        const pokerEngine = new PokerEngine(tableId, players, smallBlind, bigBlind, {
          variant,
          bettingMode
        });
        
  // Start a new hand
  pokerEngine.startNewHand();
  clearRunItState(tableId);
        
  // Get the current game state
  const gameState = pokerEngine.getState();
  const initialState = enrichStateWithRunIt(tableId, gameState);
        
        // Store the poker engine instance (you might want to use a proper storage solution)
        if (!(global as any).activeGames) {
          (global as any).activeGames = new Map();
        }
        (global as any).activeGames.set(tableId, pokerEngine);
        
        // Get player name who started the game
        const playerInfo = seatedPlayers.find(p => p.playerId === playerId);
        const playerName = playerInfo?.playerName || 'Unknown Player';
        
        // Broadcast game start to all players in the table with initial game state
        io.to(`table_${tableId}`).emit('game_started', {
          startedBy: playerId,
          playerName: playerName,
          seatedPlayers: seatedPlayers,
          gameState: initialState,
          timestamp: new Date().toISOString()
        });
        
  console.log(`${variant} game started at table ${tableId} by ${playerName} (${playerId}) with ${seatedPlayers.length} players (mode=${bettingMode}, blinds=${smallBlind}/${bigBlind})`);
        console.log('Initial game state:', {
          stage: gameState.stage,
          activePlayer: gameState.activePlayer,
          pot: gameState.pot,
          currentBet: gameState.currentBet,
          communityCards: gameState.communityCards.length
        });
        // [auto-runout] debug: show gating details at hand start
        logAutoRunout(tableId, gameState, 'after start_game');
        
      } catch (error) {
        console.error('Error starting poker game:', error);
        socket.emit('game_start_failed', { error: 'Failed to initialize poker game' });
      }
    });

    // Handle player actions (bet, call, raise, fold, check)
    socket.on('player_action', (data: { tableId: string; playerId: string; action: string; amount?: number }) => {
      console.log('Player action:', data);
      const { tableId, playerId, action, amount } = data;
      
      try {
        // Get the active poker game
        if (!(global as any).activeGames || !(global as any).activeGames.has(tableId)) {
          socket.emit('action_failed', { error: 'No active game found' });
          return;
        }
        
        const pokerEngine = (global as any).activeGames.get(tableId);
        const beforeActionState = pokerEngine?.getState?.();
        const preActionCommunity: Card[] = Array.isArray(beforeActionState?.communityCards)
          ? beforeActionState.communityCards.map((card: Card) => ({ ...card }))
          : [];
        const preActionStage: GameStage | undefined = beforeActionState?.stage;
        
        // Create player action object
        const playerAction = {
          type: action as 'bet' | 'call' | 'raise' | 'fold' | 'check',
          playerId: playerId,
          tableId: tableId,
          amount: amount || 0,
          timestamp: Date.now()
        };
        
        // Process the action through the poker engine
        pokerEngine.handleAction(playerAction);
        // Defensive: if action caused everyone else to fold, end hand immediately
        if (typeof pokerEngine.ensureWinByFoldIfSingle === 'function') {
          pokerEngine.ensureWinByFoldIfSingle();
        }
  // Get updated game state
  let gameState = pokerEngine.getState();
  // [auto-runout] debug after applying action
  logAutoRunout(tableId, gameState, 'after player_action apply');
        // Extra safety: if we still have only one active player but stage hasn't advanced, apply a hard-settlement fallback to prevent any further dealing
        let activeCount = (gameState.players || []).filter((p: any) => !(p.isFolded || (p as any).folded)).length;
        if (activeCount === 1 && gameState.stage !== 'showdown') {
          console.log(`[safety] Forcing win-by-fold settlement (stage=${gameState.stage}, pot=${gameState.pot}, currentBet=${gameState.currentBet})`);
          if (typeof pokerEngine.ensureWinByFoldIfSingle === 'function') {
            pokerEngine.ensureWinByFoldIfSingle();
            gameState = pokerEngine.getState();
            console.log(`[safety] Post-settlement (stage=${gameState.stage}, pot=${gameState.pot}, currentBet=${gameState.currentBet})`);
          }
          // If still not settled, perform server-side hard settlement and start next hand using a fresh engine
          if (gameState.stage !== 'showdown') {
            try {
              const playersArr = Array.isArray(gameState.players) ? [...gameState.players] : [];
              const winner = playersArr.find((p: any) => !(p.isFolded || (p as any).folded));
              if (winner) {
                // Compute conservation baseline
                const betsTotal = playersArr.reduce((sum, p: any) => sum + (p.currentBet || 0), 0);
                const potBefore = Number(gameState.pot) || 0;
                const stacksTotal = playersArr.reduce((sum, p: any) => sum + (Number(p.stack) || 0), 0);
                const includeOutstandingBets = potBefore === 0 ? betsTotal : 0;
                const initialTotal = stacksTotal + potBefore + includeOutstandingBets;
                // Clear bets and pot, award delta to winner
                const clearedPlayers = playersArr.map((p: any) => ({ ...p, currentBet: 0 }));
                let stacksAfter = clearedPlayers.reduce((sum, p: any) => sum + (Number(p.stack) || 0), 0);
                let delta = initialTotal - stacksAfter;
                const adjusted = clearedPlayers.map((p: any) => (
                  p.id === winner.id ? { ...p, stack: (Number(p.stack) || 0) + delta } : p
                ));
                // Rebuild fresh engine with corrected stacks and start next hand immediately
                try { delete require.cache[require.resolve('../../src/lib/poker/game-state-manager')]; } catch {}
                try { delete require.cache[require.resolve('../../src/lib/poker/poker-engine')]; } catch {}
                const { PokerEngine } = require('../../src/lib/poker/poker-engine');
                const sb = Number(gameState.smallBlind) || 1;
                const bb = Number(gameState.bigBlind) || 2;
                const variant = gameState.variant || 'texas-holdem';
                const bettingMode = gameState.bettingMode || (variant === 'omaha' || variant === 'omaha-hi-lo' ? 'pot-limit' : 'no-limit');
                const rebuiltPlayers = adjusted.map((p: any) => ({
                  id: p.id, name: p.name || p.id, position: p.position, stack: p.stack,
                  currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: p.timeBank ?? 30, holeCards: []
                }));
                const freshEngine = new PokerEngine(tableId, rebuiltPlayers, sb, bb, { variant, bettingMode });
                // Continue dealer rotation
                try { (freshEngine as any).state.dealerPosition = gameState.dealerPosition ?? 0; } catch {}
                freshEngine.startNewHand();
                clearRunItState(tableId);
                (global as any).activeGames.set(tableId, freshEngine);
                const newState = freshEngine.getState();
                emitGameStateUpdate(io, tableId, newState, { action: 'auto_next_hand' });
                console.log(`[auto] Emitted game_state_update auto_next_hand (stage=${newState?.stage}, pot=${newState?.pot}) for table ${tableId}`);
                return; // we've emitted next hand; stop normal emit below
              }
            } catch (fallbackErr) {
              console.warn('Hard settlement fallback failed:', fallbackErr);
            }
          }
        } else if (playerAction.type === 'fold' && gameState.stage !== 'showdown') {
          // Additional fallback: if the engine instance failed to register the fold yet, assume the acting player is folded
          try {
            const playersArr = Array.isArray(gameState.players) ? [...gameState.players] : [];
            const foldedMap: Record<string, boolean> = {};
            playersArr.forEach((p: any) => { foldedMap[p.id] = !!(p.isFolded || p.folded); });
            foldedMap[playerId] = true; // ensure actor is considered folded
            const actives2 = playersArr.filter((p: any) => !foldedMap[p.id]);
            if (actives2.length === 1) {
              console.log('[safety] Post-fold active count=1 but stage not showdown; applying hard-settlement (actor assumed folded)');
              const winner = actives2[0];
              // Compute baseline and settle
              const betsTotal = playersArr.reduce((sum, p: any) => sum + (p.currentBet || 0), 0);
              const potBefore = Number(gameState.pot) || 0;
              const stacksTotal = playersArr.reduce((sum, p: any) => sum + (Number(p.stack) || 0), 0);
              const includeOutstandingBets = potBefore === 0 ? betsTotal : 0;
              const initialTotal = stacksTotal + potBefore + includeOutstandingBets;
              const clearedPlayers = playersArr.map((p: any) => ({ ...p, currentBet: 0 }));
              let stacksAfter = clearedPlayers.reduce((sum, p: any) => sum + (Number(p.stack) || 0), 0);
              let delta = initialTotal - stacksAfter;
              const adjusted = clearedPlayers.map((p: any) => (
                p.id === winner.id ? { ...p, stack: (Number(p.stack) || 0) + delta } : p
              ));
              // Rebuild fresh engine and start next hand
              try { delete require.cache[require.resolve('../../src/lib/poker/poker-engine')]; } catch {}
              const { PokerEngine } = require('../../src/lib/poker/poker-engine');
              const sb = Number(gameState.smallBlind) || 1;
              const bb = Number(gameState.bigBlind) || 2;
              const variant = gameState.variant || 'texas-holdem';
              const bettingMode = gameState.bettingMode || (variant === 'omaha' || variant === 'omaha-hi-lo' ? 'pot-limit' : 'no-limit');
              const rebuiltPlayers = adjusted.map((p: any) => ({
                id: p.id, name: p.name || p.id, position: p.position, stack: p.stack,
                currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: p.timeBank ?? 30, holeCards: []
              }));
              const freshEngine = new PokerEngine(tableId, rebuiltPlayers, sb, bb, { variant, bettingMode });
              try { (freshEngine as any).state.dealerPosition = gameState.dealerPosition ?? 0; } catch {}
              freshEngine.startNewHand();
              clearRunItState(tableId);
              (global as any).activeGames.set(tableId, freshEngine);
              const newState = freshEngine.getState();
              emitGameStateUpdate(io, tableId, newState, { action: 'auto_next_hand' });
              console.log(`[auto] Emitted game_state_update auto_next_hand (stage=${newState?.stage}, pot=${newState?.pot}) for table ${tableId}`);
              return;
            }
          } catch (assumeErr) {
            console.warn('Assumed-fold settlement failed:', assumeErr);
          }
        }
        
        // Decide if we should lock UI and schedule auto-runout
        const postCommunityCount = Array.isArray(gameState.communityCards) ? gameState.communityCards.length : 0;
        const preCommunityCount = preActionCommunity.length;
        const boardAdvanced = postCommunityCount > preCommunityCount;
        const promptOptions = boardAdvanced
          ? {
              communityOverride: preActionCommunity,
              boardVisibleCount: preCommunityCount,
              stageOverride: preActionStage,
            }
          : undefined;

        const eligibleForAuto = isAutoRunoutEligible(gameState);
        let shouldScheduleAuto = eligibleForAuto;
        let issuedPrompt: RunItTwicePrompt | null = null;
        if (eligibleForAuto) {
          issuedPrompt = maybeCreateRunItPrompt(tableId, gameState, promptOptions);
          if (issuedPrompt) {
            shouldScheduleAuto = false;
            gameState = { ...gameState, activePlayer: issuedPrompt.playerId };
          }
        }
        const outState = shouldScheduleAuto ? { ...gameState, activePlayer: '' } : gameState;

        emitGameStateUpdate(io, tableId, outState, {
          playerId,
          action,
          amount
        });
        if (shouldScheduleAuto) {
          scheduleAutoRunout(tableId);
        }
        // [auto-runout] debug after broadcasting update
        logAutoRunout(tableId, gameState, 'after emit game_state_update');
        
        console.log(`Player ${playerId} performed ${action}${amount ? ` for ${amount}` : ''} at table ${tableId}`);

        // If hand is over, schedule next hand
        if (gameState?.stage === 'showdown') {
          scheduleNextHand(tableId);
        }
        
      } catch (error: any) {
        console.error('Error processing player action:', error);
        socket.emit('action_failed', { 
          error: error?.message || 'Failed to process action',
          playerId: playerId,
          action: action
        });
      }
    });

    socket.on('enable_run_it_twice', (
      { tableId, runs, playerId: requesterOverride }: { tableId: string; runs: number; playerId?: string },
      cb?: (resp: { success: boolean; error?: string }) => void
    ) => {
      try {
        if (!tableId || typeof runs !== 'number') {
          cb?.({ success: false, error: 'Invalid parameters' });
          return;
        }
        if (!(global as any).activeGames || !(global as any).activeGames.has(tableId)) {
          cb?.({ success: false, error: 'No active game' });
          return;
        }
        const pokerEngine = (global as any).activeGames.get(tableId);
        const state = pokerEngine?.getState?.();
        if (!state) {
          cb?.({ success: false, error: 'Table state unavailable' });
          return;
        }
        if (state.runItTwice?.enabled) {
          cb?.({ success: false, error: 'Run It Twice already enabled' });
          return;
        }
        const requesterId = requesterOverride || socket.playerId;
        if (!requesterId) {
          cb?.({ success: false, error: 'Unknown player' });
          return;
        }
        if (state.communityCards.length >= 5 || state.stage === 'showdown') {
          cb?.({ success: false, error: 'Too late to enable' });
          return;
        }
        const anyAllIn = (state.players || []).some((p: any) => !(p.isFolded || (p as any).folded) && p.isAllIn);
        if (!anyAllIn) {
          cb?.({ success: false, error: 'No all-in detected' });
          return;
        }
        const activePlayers = (state.players || []).filter((p: any) => !(p.isFolded || (p as any).folded)).length || 0;
        const maxRuns = Math.max(1, activePlayers);
        if (runs < 1 || runs > maxRuns) {
          cb?.({ success: false, error: `Runs must be 1-${maxRuns}` });
          return;
        }

        const meta = getRunItState(tableId);
        const prompt = meta.prompt;
        if (prompt) {
          if (prompt.playerId !== requesterId) {
            cb?.({ success: false, error: 'Not authorized for decision' });
            return;
          }
          if (runs <= 1) {
            disableRunItPrompt(tableId, true);
            const revealed = revealAllHoleCards(pokerEngine, state);
            const resumed = { ...revealed, activePlayer: '' };
            emitGameStateUpdate(io, tableId, resumed, { action: 'run_it_twice_declined', playerId: requesterId });
            scheduleAutoRunout(tableId);
            cb?.({ success: true });
            return;
          }
        } else if (runs === 1) {
          cb?.({ success: false, error: 'Multiple runs required' });
          return;
        }

        if (runs < 2) {
          cb?.({ success: false, error: 'Runs must be at least 2' });
          return;
        }

        pokerEngine.enableRunItTwice(runs);
        const updated = revealAllHoleCards(pokerEngine, pokerEngine.getState());
        disableRunItPrompt(tableId, true);
        emitGameStateUpdate(io, tableId, updated, { action: 'run_it_twice_enabled', playerId: requesterId, runs });
        io.to(`table_${tableId}`).emit('rit_enabled', { tableId, runs, rit: updated.runItTwice });
        scheduleAutoRunout(tableId);
        cb?.({ success: true });
      } catch (err: any) {
        cb?.({ success: false, error: err?.message || 'Failed to enable Run It Twice' });
      }
    });

    // Allow clients to explicitly request settlement when only one player remains (defensive fallback)
    socket.on('force_settlement', (data: { tableId: string }) => {
      try {
        const { tableId } = data || ({} as any);
        if (!tableId) return;
        if (!(global as any).activeGames || !(global as any).activeGames.has(tableId)) {
          return;
        }
        const pokerEngine = (global as any).activeGames.get(tableId);
        if (typeof pokerEngine.ensureWinByFoldIfSingle === 'function') {
          const before = pokerEngine.getState();
          const activeCount = (before.players || []).filter((p: any) => !(p.isFolded || (p as any).folded)).length;
          if (activeCount === 1 && before.stage !== 'showdown') {
            console.log(`[client] force_settlement requested; applying (stage=${before.stage}, pot=${before.pot})`);
            pokerEngine.ensureWinByFoldIfSingle();
            const after = pokerEngine.getState();
            emitGameStateUpdate(io, tableId, after, { action: 'force_settlement' });
            // If hand is over, schedule next hand
            if (after?.stage === 'showdown') {
              scheduleNextHand(tableId);
            }
          }
        }
      } catch (err) {
        console.error('force_settlement failed:', err);
      }
    });

    // Client fallback: request starting the next hand after a delay on their side
    socket.on('request_next_hand', (data: { tableId: string }) => {
      try {
        const { tableId } = data || ({} as any);
        if (!tableId) return;
        if (!(global as any).activeGames || !(global as any).activeGames.has(tableId)) return;
        const engine = (global as any).activeGames.get(tableId);
        const state = engine?.getState?.() || {};
        console.log(`[auto] request_next_hand received (stage=${state?.stage}, players=${Array.isArray(state?.players) ? state.players.length : 0}) for table ${tableId}`);
        if (state.stage !== 'showdown') {
          console.log(`[auto] request_next_hand ignored: stage=${state.stage} (table ${tableId})`);
          return;
        }
        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length < 2) {
          console.log(`[auto] request_next_hand ignored: not enough players (${players.length}) (table ${tableId})`);
          return;
        }
        console.log(`[auto] request_next_hand accepted: starting next hand now (table ${tableId})`);
        engine.startNewHand();
        clearRunItState(tableId);
        const newState = engine.getState();
        emitGameStateUpdate(io, tableId, newState, { action: 'request_next_hand' });
        console.log(`[auto] Emitted game_state_update request_next_hand (stage=${newState?.stage}, pot=${newState?.pot}) for table ${tableId}`);
      } catch (err) {
        console.error('request_next_hand failed:', err);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      
      // Optional: Handle cleanup if player disconnects
      if (socket.tableId && socket.playerId) {
        console.log(`Player ${socket.playerId} disconnected from table ${socket.tableId}`);
      }
    });
  });
  
  // Mark handlers as added
  io._seatHandlersAdded = true;
  console.log('Seat management handlers added successfully');
}

export default function handler(req: NextApiRequest, res: NextApiResponseServerIO) {
  // Only initialize Socket.IO server once
  if (!res.socket.server.io) {
    console.log('Initializing Socket.IO server...');
    
    // Get the HTTP server from the Next.js response
    const httpServer = res.socket.server;
    
    // Initialize WebSocketManager (this will create the Socket.IO server)
    const wsManager = WebSocketManager.getInstance(httpServer, {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
      pingInterval: 25000,
      transport: 'websocket'
    });

  // Store the Socket.IO server instance for other API routes
    res.socket.server.io = wsManager.getSocketServer();
    
    // Initialize seat management handlers
    initializeSeatHandlers(res);
    
    console.log('Socket.IO server initialized successfully');
  } else {
    console.log('Socket.IO server already running');
    // Re-run handler initialization to support hot-reload / new event bindings
    try {
      initializeSeatHandlers(res);
    } catch (e) {
      console.warn('Re-initialization of seat handlers failed:', e);
    }
  }
  // For Engine.IO polling/handshake requests, do not write a response here.
  // Let the Socket.IO server attached to the HTTP server produce the output.
  const rawUrl = req.url || '';
  let isEngineIo = false;
  try {
    const u = new URL(rawUrl, 'http://localhost');
    isEngineIo = u.searchParams.has('EIO') && u.searchParams.has('transport');
  } catch {
    isEngineIo = rawUrl.includes('EIO=') && rawUrl.includes('transport=');
  }
  if (isEngineIo) {
    try {
      if (process.env.DEBUG_ENGINE_IO) {
        console.log('[socketio] passthrough Engine.IO frame', rawUrl);
      }
    } catch {}
    return; // externalResolver=true tells Next not to expect a response body here
  }

  // For simple probes (like warm-up fetches), return a tiny OK JSON
  res.status(200).json({ status: 'Socket.IO server running' });
}

// Disable body parsing for this endpoint
export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};
