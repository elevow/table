import type { NextApiRequest, NextApiResponse } from 'next';
import { BASE_TURN_MS, DEFAULT_TIME_BANKS, DEFAULT_TIME_BANK_SECONDS } from '../../../src/lib/shared/turn-clock';
import { PokerEngine } from '../../../src/lib/poker/poker-engine';
import * as GameSeats from '../../../src/lib/shared/game-seats';
import { publishGameStateUpdate, publishAwaitingDealerChoice } from '../../../src/lib/realtime/publisher';
import { getPool } from '../../../src/lib/database/pool';
import { GameService } from '../../../src/lib/services/game-service';
import { resolveVariantAndMode, defaultBettingModeForVariant } from '../../../src/lib/game/variant-mapping';
import { nextSeq } from '../../../src/lib/realtime/sequence';
import { clearRunItState, enrichStateWithRunIt } from '../../../src/lib/poker/run-it-twice-manager';
import { sanitizeStateForPlayer, sanitizeStateForBroadcast } from '../../../src/lib/poker/state-sanitizer';
import { getLastActionAt, getOrRestoreEngine, persistEngineState } from '../../../src/lib/poker/engine-persistence';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';
import type { MixedGameEntry, TableState } from '../../../src/types/poker';
import { ALL_VARIANTS, HORSE_GAMES, parseHandsPerGame, parseMixedGames } from '../../../src/lib/poker/variant-rules';

// Socket.io server type (simplified to avoid external dependency)
type SocketIOServer = {
  to: (room: string) => { emit: (event: string, data: unknown) => void };
};

// A hand with no activity for this long counts as abandoned and can be replaced by a new game
const ABANDONED_HAND_MS = 10 * 60 * 1000;

/**
 * True when the table has a hand in progress that has seen recent activity.
 * Without a last-action time (no database) an in-progress hand is treated as live.
 */
async function hasLiveHand(tableId: string, existingState: TableState | undefined): Promise<boolean> {
  const stage = existingState?.stage;
  if (!stage || stage === 'showdown' || stage === 'awaiting-dealer-choice') return false;
  const lastActionAt = await getLastActionAt(tableId);
  return !lastActionAt || Date.now() - lastActionAt.getTime() < ABANDONED_HAND_MS;
}

const DEFAULT_TURN_SECONDS = BASE_TURN_MS / 1000;

type RoomGameSettings = {
  variant?: string;
  bettingMode?: string;
  smallBlind: number;
  bigBlind: number;
  allowRunItTwice: boolean;
  allowStraddle: boolean;
  // Chips each player antes in Hold'em and Omaha hands; 0 = no antes
  ante: number;
  // 7-2 bounty in chips (Hold'em only); 0 = off
  sevenDeuceBounty: number;
  // Mixed games: the games played in turn and how many hands each lasts
  mixedGames: MixedGameEntry[] | null;
  handsPerGame: number;
  // Clock: base time per decision, time banks per player and the length of each
  turnTimeSeconds?: number;
  timeBanks?: number;
  timeBankSeconds?: number;
};

/** A non-negative chip amount from configuration; anything else counts as 0 (off). */
function chipAmount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function positiveNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/** The game type, betting mode, blinds and table options of the room; null if there is no such room. */
async function loadRoomGameSettings(tableId: string): Promise<RoomGameSettings | null> {
  const service = new GameService(getPool() as any);
  const room = await service.getRoomById(tableId);
  if (!room) return null;
  const config = (room.configuration || {}) as Record<string, unknown>;
  const blinds = (room.blindLevels || {}) as Record<string, unknown>;
  return {
    variant: typeof config.variant === 'string' ? config.variant : undefined,
    bettingMode: typeof config.bettingMode === 'string' ? config.bettingMode : undefined,
    smallBlind: positiveNumber(blinds.sb, blinds.smallBlind) ?? 1,
    bigBlind: positiveNumber(blinds.bb, blinds.bigBlind) ?? 2,
    allowRunItTwice: config.allowRunItTwice === true,
    allowStraddle: config.allowStraddle === true,
    ante: chipAmount(config.ante),
    sevenDeuceBounty: chipAmount(config.sevenDeuceBounty),
    mixedGames: parseMixedGames(config.mixedGames, defaultBettingModeForVariant),
    handsPerGame: parseHandsPerGame(config.handsPerGame),
    turnTimeSeconds: positiveNumber(config.turnTimeSeconds),
    timeBanks: Number.isFinite(Number(config.timeBanks)) ? Number(config.timeBanks) : undefined,
    timeBankSeconds: positiveNumber(config.timeBankSeconds),
  };
}

function getIo(res: NextApiResponse): SocketIOServer | null {
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

  // Game type, betting mode and blinds come from the room record; any sent in the body are ignored
  const { tableId, playerId: claimedPlayerId, seatedPlayers: clientSeatedPlayers } = (req.body || {}) as {
    tableId?: string;
    playerId?: string;
    seatedPlayers?: Array<{ seatNumber: number; playerId: string; playerName: string; chips: number }>;
  };
  const playerId = await requirePlayer(req, res, claimedPlayerId);
  if (!playerId) return;
  if (!tableId) return res.status(400).json({ error: 'Missing tableId' });

  let roomSettings: RoomGameSettings | null;
  try {
    roomSettings = await loadRoomGameSettings(tableId);
  } catch (e) {
    console.warn('[games/start] Room lookup failed:', (e as any)?.message || e);
    return res.status(503).json({ error: 'Unable to load room settings' });
  }
  if (!roomSettings) return res.status(404).json({ error: 'Room not found' });

  try {
    // Starting replaces the table's engine, so refuse while a hand is being played
    const existingEngine = await getOrRestoreEngine(tableId);
    const existingState = existingEngine && typeof existingEngine.getState === 'function' ? existingEngine.getState() : undefined;
    if (await hasLiveHand(tableId, existingState)) {
      return res.status(409).json({ error: 'A hand is already in progress' });
    }

    // Try to get seats from in-memory store first (socket mode), then fallback to client-provided seats (Supabase/HTTP mode)
    let seatedPlayers: Array<{ seatNumber: number; playerId: string; playerName: string; chips: number }>;
    
    const seats = await GameSeats.loadPersistedRoomSeats(tableId) || GameSeats.getRoomSeats(tableId);
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
      // Reject before trusting client seats so a non-seated caller cannot overwrite the seat map
      if (!clientSeatedPlayers.some(p => p.playerId === playerId)) {
        return res.status(403).json({ error: 'Only a seated player can start the game' });
      }
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
      await GameSeats.persistRoomSeats(tableId, newSeats);
    } else {
      return res.status(400).json({ error: 'Need at least two seated players to start a game' });
    }

    if (seatedPlayers.length < 2) {
      return res.status(400).json({ error: 'Need at least two seated players to start a game' });
    }

    if (!seatedPlayers.some(p => p.playerId === playerId)) {
      return res.status(403).json({ error: 'Only a seated player can start the game' });
    }

    // Seat chips are the buy-in and are not updated during play, so players already in the
    // current game keep their engine stacks; otherwise a restart would reset everyone's chips.
    // A player who stood up cashed out; if they sat back down, their seat holds the new buy-in
    const existingStacks = new Map<string, number>(
      (existingState?.players ?? [])
        .filter(p => !existingEngine?.isRemoved?.(p.id))
        .map(p => [p.id, Number(p.stack) || 0])
    );
    seatedPlayers = seatedPlayers.map(p =>
      existingStacks.has(p.playerId) ? { ...p, chips: existingStacks.get(p.playerId) as number } : p
    );
    if (seatedPlayers.some(p => p.chips <= 0)) {
      return res.status(409).json({ error: 'Waiting for busted players to rebuy or leave' });
    }

    // Determine blinds and variant/mode from the room (centralized mapping)
    const { smallBlind, bigBlind } = roomSettings;
    const { variant: resolvedVariant, bettingMode: resolvedMode } = resolveVariantAndMode({
      variant: roomSettings.variant,
      bettingMode: roomSettings.bettingMode,
    });
  const isDealersChoice = resolvedVariant === 'dealers-choice';
    // Mixed games start with the first game of the list (HORSE if the room's list is unusable)
    const mixedGames = resolvedVariant === 'mixed' ? (roomSettings.mixedGames || HORSE_GAMES) : null;
    const engineVariant = mixedGames ? mixedGames[0].variant : resolvedVariant;
    const engineMode = mixedGames ? mixedGames[0].bettingMode : resolvedMode;

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
    const engine = new PokerEngine(tableId, engPlayers as any, smallBlind, bigBlind, { variant: engineVariant as any, bettingMode: engineMode });
    engine.setAllowRunItTwice(roomSettings.allowRunItTwice);
    engine.setAllowStraddle(roomSettings.allowStraddle);
    // Rooms created before these settings existed get the defaults
    engine.configureClock({
      turnSeconds: roomSettings.turnTimeSeconds ?? DEFAULT_TURN_SECONDS,
      timeBanks: roomSettings.timeBanks ?? DEFAULT_TIME_BANKS,
      timeBankSeconds: roomSettings.timeBankSeconds ?? DEFAULT_TIME_BANK_SECONDS,
    });
    engine.setAnte(roomSettings.ante);
    engine.setSevenDeuceBounty(roomSettings.sevenDeuceBounty);
    if (mixedGames) engine.setMixedGame(mixedGames, roomSettings.handsPerGame);
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
    
    // Clear Run-It-Twice state for new hand
    clearRunItState(tableId);
    
    // Store room configuration for next-hand API
    const allowedDcVariants = [...ALL_VARIANTS];
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
      
      // Persist full engine state for serverless recovery
      await persistEngineState(tableId, engine);
    } catch (e) {
      // Swallow persistence errors to keep local dev flows working without DB
      try { console.warn('[games/start] DB persistence skipped:', (e as any)?.message || e); } catch {}
    }

    // Broadcast initial state via Supabase for supabase-only mode
    try {
      const enrichedState = enrichStateWithRunIt(tableId, gameState);
      // Sanitize state for broadcast - hide all hole cards unless showdown/all-in
      const broadcastSafeState = sanitizeStateForBroadcast(enrichedState);
      const seqStart = nextSeq(tableId);
      await publishGameStateUpdate(tableId, {
        gameState: broadcastSafeState,
        lastAction: { action: 'game_started', startedBy: playerId },
        timestamp: new Date().toISOString(),
        seq: seqStart,
        variant: resolvedVariant,
        bettingMode: resolvedMode,
      });
    } catch { /* Swallow broadcast errors */ }

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
          suggestedBettingMode: defaultBettingModeForVariant('texas-holdem'),
        };
        const seqChoice = nextSeq(tableId);
        await publishAwaitingDealerChoice(tableId, { ...payload, seq: seqChoice });
        const io = getIo(res);
        if (io) io.to(`table_${tableId}`).emit('awaiting_dealer_choice', { ...payload, timestamp: new Date().toISOString(), seq: seqChoice });
      } catch { /* Swallow broadcast errors */ }
    }

    // Also emit over socket if available (hybrid compatibility)
    try {
      const io = getIo(res);
      if (io) {
        const enrichedState = enrichStateWithRunIt(tableId, gameState);
        // Sanitize state for broadcast - hide all hole cards unless showdown/all-in
        const broadcastSafeState = sanitizeStateForBroadcast(enrichedState);
        const seqStartEcho = nextSeq(tableId);
        io.to(`table_${tableId}`).emit('game_started', { startedBy: playerId, playerName: seatedPlayers.find(p => p.playerId === playerId)?.playerName || 'Unknown Player', seatedPlayers, gameState: broadcastSafeState, timestamp: new Date().toISOString(), seq: seqStartEcho });
      }
    } catch { /* Swallow broadcast errors */ }

    const enrichedFinalState = enrichStateWithRunIt(tableId, gameState);
    // Sanitize the response for the requesting player - hide other players' hole cards
    // unless it's showdown or an all-in situation
    const sanitizedState = sanitizeStateForPlayer(enrichedFinalState, playerId);
    return res.status(201).json({ success: true, gameState: sanitizedState });
  } catch (e: unknown) {
    let errorMessage = 'Failed to start game';
    if (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
      errorMessage = (e as { message: string }).message;
    }
    return res.status(400).json({ error: errorMessage });
  }
}
