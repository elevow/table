import type { NextApiRequest, NextApiResponse } from 'next';
import { PokerEngine } from '../../../src/lib/poker/poker-engine';
import * as GameSeats from '../../../src/lib/shared/game-seats';
import { publishGameStateUpdate, publishAwaitingDealerChoice } from '../../../src/lib/realtime/publisher';
import { getPool } from '../../../src/lib/database/pool';
import { GameService } from '../../../src/lib/services/game-service';
import { resolveVariantAndMode, defaultBettingModeForVariant } from '../../../src/lib/game/variant-mapping';
import { nextSeq } from '../../../src/lib/realtime/sequence';

function getIo(res: NextApiResponse): any | null {
  try {
    // @ts-ignore
    const io = (res as any)?.socket?.server?.io;
    return io || null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tableId, playerId, variant, bettingMode, sb, bb, seatedPlayers: clientSeatedPlayers } = (req.body || {}) as {
    tableId?: string;
    playerId?: string;
    variant?: string;
    bettingMode?: 'no-limit' | 'pot-limit';
    sb?: number;
    bb?: number;
    seatedPlayers?: Array<{ seatNumber: number; playerId: string; playerName: string; chips: number }>;
  };
  if (!tableId || !playerId) return res.status(400).json({ error: 'Missing tableId or playerId' });

  try {
    // Try to get seats from in-memory store first (socket mode), then fallback to client-provided seats (Supabase/HTTP mode)
    let seatedPlayers: Array<{ seatNumber: number; playerId: string; playerName: string; chips: number }>;
    
    const seats = GameSeats.getRoomSeats(tableId);
    const serverSeatedPlayers = Object.entries(seats)
      .filter(([_, a]) => !!a)
      .map(([seatNumber, a]) => ({
        seatNumber: parseInt(seatNumber, 10),
        playerId: (a as any).playerId as string,
        playerName: (a as any).playerName as string,
        chips: Number((a as any).chips) || 20,
      }))
      .sort((a, b) => a.seatNumber - b.seatNumber);

    // Use server seats if available, otherwise use client-provided seats
    if (serverSeatedPlayers.length >= 2) {
      seatedPlayers = serverSeatedPlayers;
    } else if (clientSeatedPlayers && clientSeatedPlayers.length >= 2) {
      seatedPlayers = clientSeatedPlayers;
      // Update the in-memory store with client seats for consistency
      const newSeats: any = {};
      clientSeatedPlayers.forEach(p => {
        newSeats[p.seatNumber] = {
          playerId: p.playerId,
          playerName: p.playerName,
          chips: p.chips
        };
      });
      GameSeats.setRoomSeats(tableId, newSeats);
    } else {
      return res.status(400).json({ error: 'Need at least two seated players to start a game' });
    }

    if (seatedPlayers.length < 2) {
      return res.status(400).json({ error: 'Need at least two seated players to start a game' });
    }

  // Determine blinds and variant/mode (centralized mapping)
    const smallBlind = typeof sb === 'number' ? sb : 1;
    const bigBlind = typeof bb === 'number' ? bb : 2;
  const { variant: resolvedVariant, bettingMode: resolvedMode } = resolveVariantAndMode({ variant, bettingMode });
  const isDealersChoice = resolvedVariant === 'dealers-choice';

    // Build engine players in seat order
    const engPlayers = seatedPlayers.map((p) => ({
      id: p.playerId,
      name: p.playerName || p.playerId,
      position: p.seatNumber,
      stack: p.chips,
      currentBet: 0,
      hasActed: false,
      isFolded: false,
      isAllIn: false,
      timeBank: 30,
      holeCards: [] as any[],
    }));

    // Ensure global storage
    const g: any = global as any;
    if (!g.activeGames) g.activeGames = new Map<string, PokerEngine>();
    if (!g.roomConfigs) g.roomConfigs = new Map<string, any>();

    // Create new engine for table (replace any existing)
    const engine = new PokerEngine(tableId, engPlayers as any, smallBlind, bigBlind, { variant: resolvedVariant as any, bettingMode: resolvedMode });
    let gameState: any;
    if (isDealersChoice) {
      if (typeof (engine as any)?.pauseForDealerChoice === 'function') {
        gameState = (engine as any).pauseForDealerChoice();
      } else {
        // Fallback for older engine builds
        gameState = engine.getState();
        (gameState as any).stage = 'awaiting-dealer-choice';
        gameState.activePlayer = '';
        gameState.pot = 0;
        gameState.currentBet = 0;
        gameState.minRaise = bigBlind;
        gameState.communityCards = [];
        gameState.players?.forEach((p: any) => {
          p.currentBet = 0;
          p.hasActed = false;
          p.isFolded = false;
          p.isAllIn = false;
          p.holeCards = [];
        });
      }
    } else {
      engine.startNewHand();
      gameState = engine.getState();
    }
    g.activeGames.set(tableId, engine);
    
    // Store room configuration for next-hand API
    const allowedDcVariants = ['texas-holdem','omaha','omaha-hi-lo','seven-card-stud','seven-card-stud-hi-lo','five-card-stud'];
    const roomConfigPayload: any = {
      variant: resolvedVariant,
      bettingMode: resolvedMode,
      smallBlind,
      bigBlind,
      mode: isDealersChoice ? 'dealers-choice' : 'fixed'
    };
    if (isDealersChoice) {
      roomConfigPayload.allowedVariants = allowedDcVariants;
      roomConfigPayload.chosenVariant = 'texas-holdem';
      roomConfigPayload.dcStepCount = 0;
    }
    g.roomConfigs.set(tableId, roomConfigPayload);

    // Optional: persist active game to DB if configured
    try {
      const pool = getPool();
      const service = new GameService(pool as any);
      const activeId = gameState.activePlayer;
      const active = Array.isArray(gameState.players) ? gameState.players.find((p: any) => p.id === activeId) : undefined;
      const currentPlayerPosition = active?.position ?? 1;
      const stateForDb: any = {};
      if (gameState?.variant) stateForDb.variant = gameState.variant;
      if (gameState?.bettingMode) stateForDb.bettingMode = gameState.bettingMode;
      await service.startGame({
        roomId: tableId,
        dealerPosition: Number(gameState.dealerPosition) || 0,
        currentPlayerPosition: Number(currentPlayerPosition) || 1,
        pot: Number(gameState.pot) || 0,
        state: Object.keys(stateForDb).length ? stateForDb : undefined,
      });
    } catch (e) {
      // Swallow persistence errors to keep local dev flows working without DB
      try { console.warn('[games/start] DB persistence skipped:', (e as any)?.message || e); } catch {}
    }

    // Broadcast initial state via Supabase for supabase-only mode
    try {
      const seqStart = nextSeq(tableId);
      await publishGameStateUpdate(tableId, {
        gameState,
        lastAction: { action: 'game_started', startedBy: playerId },
        timestamp: new Date().toISOString(),
        seq: seqStart,
        variant: resolvedVariant,
        bettingMode: resolvedMode,
      } as any);
    } catch {}

    // Additionally announce Dealer's Choice context ONLY if this is a Dealer's Choice table
    // Check if the room configuration specifies dealer's choice variant
    if (resolvedVariant === 'dealers-choice') {
      try {
        const rawDealerIdx = typeof gameState.dealerPosition === 'number' ? gameState.dealerPosition : 0;
        const playerCount = Array.isArray(gameState.players) ? gameState.players.length : 0;
        const dealerIdx = playerCount > 0 ? ((rawDealerIdx + 1) % playerCount) : rawDealerIdx;
        const dealerId = Array.isArray(gameState.players) && gameState.players[dealerIdx]?.id ? String(gameState.players[dealerIdx].id) : undefined;
  const allowed = allowedDcVariants;
        const payload = {
          dealerId,
          allowedVariants: allowed,
          current: 'texas-holdem', // Default to Texas Hold'em for first hand
          suggestedBettingMode: defaultBettingModeForVariant('texas-holdem' as any),
        };
        const seqChoice = nextSeq(tableId);
        await publishAwaitingDealerChoice(tableId, { ...payload, seq: seqChoice });
        const io = getIo(res);
        if (io) io.to(`table_${tableId}`).emit('awaiting_dealer_choice', { ...payload, timestamp: new Date().toISOString(), seq: seqChoice });
      } catch {}
    }

    // Also emit over socket if available (hybrid compatibility)
    try {
      const io = getIo(res);
      if (io) {
        const seqStartEcho = nextSeq(tableId);
        io.to(`table_${tableId}`).emit('game_started', { startedBy: playerId, playerName: seatedPlayers.find(p => p.playerId === playerId)?.playerName || 'Unknown Player', seatedPlayers, gameState, timestamp: new Date().toISOString(), seq: seqStartEcho });
      }
    } catch {}

    return res.status(201).json({ success: true, gameState });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || 'Failed to start game' });
  }
}
