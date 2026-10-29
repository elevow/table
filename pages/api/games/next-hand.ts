import type { NextApiRequest, NextApiResponse } from 'next';
import { publishGameStateUpdate, publishAwaitingDealerChoice, publishRebuyPrompt } from '../../../src/lib/realtime/publisher';
import { nextSeq } from '../../../src/lib/realtime/sequence';
import { clearRunItState, enrichStateWithRunIt } from '../../../src/lib/poker/run-it-twice-manager';
import { sanitizeStateForPlayer, sanitizeStateForBroadcast } from '../../../src/lib/poker/state-sanitizer';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';
import { fetchRoomRebuyLimit, fetchRoomRebuyAmount } from '../../../src/lib/shared/rebuy-limit';
import { getPlayerRebuyInfo } from '../../../src/lib/shared/rebuy-tracker';
import {
  clearPendingRebuy,
  hasPendingRebuy,
  pendingRebuyCount,
  setPendingRebuy,
} from '../../../src/lib/server/rebuy-state';
import { autoStandPlayer } from '../../../src/lib/server/rebuy-actions';
import { getOrRestoreEngine, persistEngineState, STALE_STATE_RESPONSE } from '../../../src/lib/poker/engine-persistence';
import * as GameSeats from '../../../src/lib/shared/game-seats';
import { getDealerChoiceChooserId } from '../../../src/lib/poker/dealer-choice';
import { getPool } from '../../../src/lib/database/pool';
import { GameService } from '../../../src/lib/services/game-service';
import { defaultBettingModeForVariant } from '../../../src/lib/game/variant-mapping';
import type { BettingMode, GameVariant } from '../../../src/types/poker';
import { ALL_VARIANTS } from '../../../src/lib/poker/variant-rules';

// Type definitions for room configuration from database
interface RoomConfiguration {
  variant?: string;
  bettingMode?: BettingMode;
  chosenVariant?: string;
}

interface BlindLevels {
  sb?: number;
  smallBlind?: number;
  bb?: number;
  bigBlind?: number;
}

// Helper function to safely extract numeric value from blinds
function extractBlindValue(blinds: BlindLevels, ...keys: (keyof BlindLevels)[]): number {
  for (const key of keys) {
    const value = blinds[key];
    if (typeof value === 'number' && !isNaN(value)) {
      return value;
    }
  }
  return 0;
}

const DEFAULT_DEALERS_CHOICE_VARIANTS: GameVariant[] = [...ALL_VARIANTS];

const NEXT_HAND_LOCK_KEY = '__NEXT_HAND_LOCKS__';

function getNextHandLocks(): Set<string> {
  const g = globalThis as any;
  if (!g[NEXT_HAND_LOCK_KEY]) {
    g[NEXT_HAND_LOCK_KEY] = new Set<string>();
  }
  return g[NEXT_HAND_LOCK_KEY] as Set<string>;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tableId, playerId: claimedPlayerId, variant: rawVariant } = req.body;

    const playerId = await requirePlayer(req, res, claimedPlayerId);
    if (!playerId) return;
    
    // Validate variant if provided
    const isValidVariant = (v: unknown): v is GameVariant => 
      typeof v === 'string' && DEFAULT_DEALERS_CHOICE_VARIANTS.includes(v as GameVariant);
    const variant: GameVariant | undefined = isValidVariant(rawVariant) ? rawVariant : undefined;

    if (!tableId) {
      return res.status(400).json({ error: 'Missing tableId' });
    }

    // Get the active game engine from memory or restore from database
    const g: any = global as any;
    const engine = await getOrRestoreEngine(tableId);
    
    // First check in-memory cache for roomConfig
    let roomConfig = g?.roomConfigs?.get(tableId);
    
    // If roomConfig not in memory, try to restore it from the database
    if (!roomConfig) {
      try {
        const pool = getPool();
        const gameService = new GameService(pool);
        const room = await gameService.getRoomById(tableId);
        
        if (room) {
          const config = (room.configuration || {}) as RoomConfiguration;
          const blinds = (room.blindLevels || {}) as BlindLevels;
          
          // Reconstruct roomConfig from database room record
          // Note: variant could be 'dealers-choice' which extends beyond GameVariant type
          const variantFromDb = config.variant;
          const bettingModeFromDb = config.bettingMode;
          const isDealersChoiceDb = variantFromDb === 'dealers-choice';
          const resolvedVariant = variantFromDb || 'texas-holdem';
          
          roomConfig = {
            variant: resolvedVariant,
            bettingMode: bettingModeFromDb || defaultBettingModeForVariant(resolvedVariant as Parameters<typeof defaultBettingModeForVariant>[0]),
            smallBlind: extractBlindValue(blinds, 'sb', 'smallBlind') || 1,
            bigBlind: extractBlindValue(blinds, 'bb', 'bigBlind') || 2,
            mode: isDealersChoiceDb ? 'dealers-choice' : 'fixed',
            allowedVariants: isDealersChoiceDb ? DEFAULT_DEALERS_CHOICE_VARIANTS : undefined,
            chosenVariant: isDealersChoiceDb ? (config.chosenVariant || 'texas-holdem') : undefined,
          };
          
          // Cache the restored roomConfig in memory for subsequent requests
          if (!g.roomConfigs) {
            g.roomConfigs = new Map<string, any>();
          }
          g.roomConfigs.set(tableId, roomConfig);
          console.log(`[next-hand] Restored roomConfig for table ${tableId} from database`);
        }
      } catch (error) {
        console.warn('[next-hand] Failed to restore roomConfig from database:', error);
      }
    }
    
    if (!engine || !roomConfig) {
      return res.status(404).json({ error: 'No active game or room configuration found for this table' });
    }

    const isDealersChoice = roomConfig.variant === 'dealers-choice' || roomConfig.mode === 'dealers-choice';
    const allowedVariants = Array.isArray(roomConfig.allowedVariants) && roomConfig.allowedVariants.length > 0
      ? roomConfig.allowedVariants
      : DEFAULT_DEALERS_CHOICE_VARIANTS;

    const persistRoomConfig = () => {
      if (!g.roomConfigs) {
        g.roomConfigs = new Map<string, any>();
      }
      g.roomConfigs.set(tableId, roomConfig);
    };

    const locks = getNextHandLocks();
    if (locks.has(tableId)) {
      return res.status(409).json({ error: 'Next hand already being started' });
    }
    locks.add(tableId);
    try {
      // Players who sat down since the game started, or stood up and came back, join from this hand
      if (typeof engine.syncSeatedPlayers === 'function') {
        try {
          const seats = await GameSeats.loadPersistedRoomSeats(tableId) || GameSeats.getRoomSeats(tableId);
          engine.syncSeatedPlayers(Object.entries(seats || {})
            .filter(([, a]) => !!a?.playerId)
            .map(([seatNumber, a]) => ({ id: a!.playerId, name: a!.playerName, seatNumber: Number(seatNumber), chips: Number(a!.chips) || 0 })));
        } catch (err) {
          console.warn('[next-hand] Could not bring seated players into the game:', err);
        }
      }
      const currentState = typeof engine.getState === 'function' ? engine.getState() : undefined;
      const awaitingDealerChoiceStage = currentState?.stage === 'awaiting-dealer-choice';
      const showdownStage = currentState?.stage === 'showdown';
      if (!currentState || (!awaitingDealerChoiceStage && !showdownStage)) {
        return res.status(409).json({ error: 'Hand still in progress', gameState: currentState });
      }
      const playerCount = Array.isArray(currentState.players) ? currentState.players.length : 0;
      if (playerCount < 2) {
        return res.status(409).json({ error: 'Need at least two players to start the next hand', gameState: currentState });
      }
      if (!currentState.players.some((p: any) => p?.id === playerId)) {
        return res.status(403).json({ error: 'Only a player at this table can start the next hand' });
      }
      if (currentState.paused) {
        return res.status(409).json({ error: 'The host has paused the game', code: 'PAUSED' });
      }
      // Sitting-out players are not dealt in, so the table waits until two players sit in
      if (typeof engine.canStartNewHand === 'function' && !engine.canStartNewHand()) {
        return res.status(409).json({ error: 'Waiting for at least two players to sit in', code: 'NOT_ENOUGH_PLAYERS_SITTING_IN' });
      }
      // Only the announced chooser may pick the variant, and only while the game waits for that choice
      if (isDealersChoice && variant) {
        if (!awaitingDealerChoiceStage) {
          return res.status(409).json({ error: 'Game is not waiting for a dealer variant choice' });
        }
        if (getDealerChoiceChooserId(currentState) !== playerId) {
          return res.status(403).json({ error: 'Only the dealer can choose the variant' });
        }
      }

      // Check for busted players and issue rebuy prompts
      // Busted players the table is waiting on, with what their rebuy prompt shows
      const waitingFor: Array<Record<string, unknown>> = [];
      const handleBustedPlayers = async (): Promise<boolean> => {
        const players = Array.isArray(currentState.players) ? currentState.players : [];
        const busted = players.filter((p: any) => (Number(p.stack) || 0) <= 0);
        if (!busted.length) {
          return pendingRebuyCount(tableId) === 0;
        }
        const rebuyLimit = await fetchRoomRebuyLimit(tableId);
        const rebuyChips = await fetchRoomRebuyAmount(tableId);
        let promptsIssued = 0;
        for (const player of busted) {
          if (!player?.id) continue;
          const record = getPlayerRebuyInfo(tableId, player.id);
          const rebuysUsed = record?.rebuys ?? 0;
          const numericLimit = rebuyLimit === 'unlimited' ? Number.POSITIVE_INFINITY : rebuyLimit;
          if (rebuyLimit !== 'unlimited' && rebuysUsed >= numericLimit) {
            await autoStandPlayer(null, tableId, player.id, 'rebuy_exhausted');
            clearPendingRebuy(tableId, player.id);
            continue;
          }
          const payload = {
            tableId,
            playerId: player.id,
            playerName: player.name,
            rebuysUsed,
            rebuyLimit,
            baseChips: rebuyChips,
            remaining: rebuyLimit === 'unlimited' ? 'unlimited' : Math.max((rebuyLimit as number) - rebuysUsed, 0),
          };
          // Every caller learns who the table waits for; the busted player's own client can show
          // the prompt even if it missed the broadcast below
          waitingFor.push(payload);
          if (hasPendingRebuy(tableId, player.id)) continue;
          setPendingRebuy(tableId, player.id, {
            issuedAt: Date.now(),
            rebuysUsed,
            rebuyLimit,
          });
          await publishRebuyPrompt(tableId, payload);
          promptsIssued += 1;
        }
        return pendingRebuyCount(tableId) === 0 && promptsIssued === 0;
      };

      const rebuyReady = await handleBustedPlayers();
      if (!rebuyReady) {
        return res.status(200).json({ success: true, awaitingRebuyDecisions: true, pending: pendingRebuyCount(tableId), waitingFor });
      }

      const applyVariantAndStart = async ({ chosenVariant }: { chosenVariant?: GameVariant } = {}) => {
        let mutated = false;
        if (chosenVariant) {
          if (typeof engine.setVariant === 'function') {
            engine.setVariant(chosenVariant);
          }
          // Omaha games play pot limit and razz fixed limit; other games keep the room's betting mode
          const variantDefault = defaultBettingModeForVariant(chosenVariant);
          const nextMode = variantDefault !== 'no-limit' ? variantDefault : (roomConfig.bettingMode || 'no-limit');
          if (typeof engine.setBettingMode === 'function') {
            engine.setBettingMode(nextMode);
          }
          roomConfig.chosenVariant = chosenVariant;
          mutated = true;
        }
        if (mutated) {
          persistRoomConfig();
        }

        // Clear Run-It-Twice state for new hand
        clearRunItState(tableId);

        engine.startNewHand();

        // Persist engine state for serverless recovery
        if ((await persistEngineState(tableId, engine)) === 'conflict') {
          return res.status(409).json(STALE_STATE_RESPONSE);
        }

        const gameState = engine.getState();
        const enrichedState = enrichStateWithRunIt(tableId, gameState);
        // Sanitize state for broadcast - hide all hole cards unless showdown/all-in
        const broadcastSafeState = sanitizeStateForBroadcast(enrichedState);
        const seq = nextSeq(tableId);

        await publishGameStateUpdate(tableId, {
          gameState: broadcastSafeState,
          seq,
          lastAction: { action: 'next_hand_started', playerId },
          timestamp: new Date().toISOString(),
        });

        // Sanitize the response for the requesting player - hide other players' hole cards
        // unless it's showdown or an all-in situation
        const sanitizedState = sanitizeStateForPlayer(enrichedState, playerId);
        return res.status(200).json({ success: true, gameState: sanitizedState });
      };

      const promptDealerChoice = async () => {
        let state = currentState;
        if (!state || state.stage !== 'awaiting-dealer-choice') {
          if (typeof (engine as any)?.pauseForDealerChoice === 'function') {
            state = (engine as any).pauseForDealerChoice();
          } else if (state) {
            state.stage = 'awaiting-dealer-choice';
            state.activePlayer = '';
            state.currentBet = 0;
            state.minRaise = state.bigBlind;
          }
          // Persist the pause so a restored engine still accepts the dealer's choice
          if ((await persistEngineState(tableId, engine)) === 'conflict') {
            return res.status(409).json(STALE_STATE_RESPONSE);
          }
        }
        const dealerId = getDealerChoiceChooserId(state);

        await publishAwaitingDealerChoice(tableId, {
          dealerId: dealerId || playerId,
          allowedVariants,
          current: roomConfig.chosenVariant || allowedVariants[0] || 'texas-holdem',
        });
        return res.status(200).json({ success: true, awaitingChoice: true });
      };

      if (isDealersChoice) {
        if (variant) {
          return applyVariantAndStart({ chosenVariant: variant });
        }

        if (awaitingDealerChoiceStage) {
          return res.status(200).json({ success: true, awaitingChoice: true });
        }

        // A round is players + 1 hands, so the next chooser is also the next dealer. The count
        // comes from the saved game state; server memory doesn't survive across instances.
        const roundLength = (playerCount > 0 ? playerCount : 1) + 1;
        const handsThisRound = Number(currentState.dealersChoiceHandCount) || 0;

        if (handsThisRound >= roundLength) {
          return promptDealerChoice();
        }

        return applyVariantAndStart();
      }

      // Regular game: start next hand with same variant
      return applyVariantAndStart();
    } finally {
      getNextHandLocks().delete(tableId);
    }
  } catch (error) {
    console.error('Error starting next hand:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
