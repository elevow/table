import type { NextApiRequest, NextApiResponse } from 'next';
import { publishGameStateUpdate, publishAwaitingDealerChoice, publishRebuyPrompt } from '../../../src/lib/realtime/publisher';
import { nextSeq } from '../../../src/lib/realtime/sequence';
import { clearRunItState, enrichStateWithRunIt } from '../../../src/lib/poker/run-it-twice-manager';
import { sanitizeStateForPlayer, sanitizeStateForBroadcast } from '../../../src/lib/poker/state-sanitizer';
import { fetchRoomRebuyLimit } from '../../../src/lib/shared/rebuy-limit';
import { getPlayerRebuyInfo } from '../../../src/lib/shared/rebuy-tracker';
import {
  BASE_REBUY_CHIPS,
  clearPendingRebuy,
  hasPendingRebuy,
  pendingRebuyCount,
  setPendingRebuy,
} from '../../../src/lib/server/rebuy-state';
import { autoStandPlayer } from '../../../src/lib/server/rebuy-actions';
import { getOrRestoreEngine, persistEngineState } from '../../../src/lib/poker/engine-persistence';
import type { GameVariant } from '../../../src/types/poker';

const DEFAULT_DEALERS_CHOICE_VARIANTS: GameVariant[] = ['texas-holdem', 'omaha', 'omaha-hi-lo', 'seven-card-stud', 'seven-card-stud-hi-lo', 'five-card-stud'];

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
    const { tableId, playerId, variant: rawVariant } = req.body;
    
    // Validate variant if provided
    const isValidVariant = (v: unknown): v is GameVariant => 
      typeof v === 'string' && DEFAULT_DEALERS_CHOICE_VARIANTS.includes(v as GameVariant);
    const variant: GameVariant | undefined = isValidVariant(rawVariant) ? rawVariant : undefined;

    if (!tableId || !playerId) {
      return res.status(400).json({ error: 'Missing tableId or playerId' });
    }

    // Get the active game engine from memory or restore from database
    const g: any = global as any;
    const engine = await getOrRestoreEngine(tableId);
    const roomConfig = g?.roomConfigs?.get(tableId);
    
    if (!engine || !roomConfig) {
      return res.status(404).json({ error: 'No active game or room configuration found for this table' });
    }

    const isDealersChoice = roomConfig.variant === 'dealers-choice' || roomConfig.mode === 'dealers-choice';
    const allowedVariants = Array.isArray(roomConfig.allowedVariants) && roomConfig.allowedVariants.length > 0
      ? roomConfig.allowedVariants
      : DEFAULT_DEALERS_CHOICE_VARIANTS;

    const persistRoomConfig = () => {
      if (g?.roomConfigs?.set) {
        g.roomConfigs.set(tableId, roomConfig);
      }
    };

    const locks = getNextHandLocks();
    if (locks.has(tableId)) {
      return res.status(409).json({ error: 'Next hand already being started' });
    }
    locks.add(tableId);
    try {
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

      // Check for busted players and issue rebuy prompts
      const handleBustedPlayers = async (): Promise<boolean> => {
        const players = Array.isArray(currentState.players) ? currentState.players : [];
        const busted = players.filter((p: any) => (Number(p.stack) || 0) <= 0);
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
            await autoStandPlayer(null, tableId, player.id, 'rebuy_exhausted');
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
          await publishRebuyPrompt(tableId, payload);
          promptsIssued += 1;
        }
        return pendingRebuyCount(tableId) === 0 && promptsIssued === 0;
      };

      const rebuyReady = await handleBustedPlayers();
      if (!rebuyReady) {
        return res.status(200).json({ success: true, awaitingRebuyDecisions: true, pending: pendingRebuyCount(tableId) });
      }

      const applyVariantAndStart = async ({ chosenVariant, dcStepCount }: { chosenVariant?: GameVariant; dcStepCount?: number } = {}) => {
        let mutated = false;
        if (chosenVariant) {
          if (typeof engine.setVariant === 'function') {
            engine.setVariant(chosenVariant);
          }
          const nextMode = (chosenVariant === 'omaha' || chosenVariant === 'omaha-hi-lo') ? 'pot-limit' : (roomConfig.bettingMode || 'no-limit');
          if (typeof engine.setBettingMode === 'function') {
            engine.setBettingMode(nextMode);
          }
          roomConfig.chosenVariant = chosenVariant;
          mutated = true;
        }
        if (typeof dcStepCount === 'number') {
          roomConfig.dcStepCount = dcStepCount;
          mutated = true;
        }
        if (mutated) {
          persistRoomConfig();
        }

        // Clear Run-It-Twice state for new hand
        clearRunItState(tableId);

        engine.startNewHand();

        // Persist engine state for serverless recovery
        await persistEngineState(tableId, engine);

        const gameState = engine.getState();
        const enrichedState = enrichStateWithRunIt(tableId, gameState);
        // Sanitize state for broadcast - hide all hole cards unless showdown/all-in
        const broadcastSafeState = sanitizeStateForBroadcast(enrichedState);
        const sequence = nextSeq(tableId);

        await publishGameStateUpdate(tableId, {
          gameState: broadcastSafeState,
          sequence,
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
        }
        const rawDealerIdx = typeof state?.dealerPosition === 'number' ? state.dealerPosition : 0;
        const dealerIdx = playerCount > 0 ? ((rawDealerIdx + 1) % playerCount) : rawDealerIdx;
        const dealerId = Array.isArray(state?.players) && state?.players?.[dealerIdx]?.id ? String(state.players[dealerIdx].id) : undefined;

        roomConfig.dcStepCount = 0;
        persistRoomConfig();

        await publishAwaitingDealerChoice(tableId, {
          dealerId: dealerId || playerId,
          allowedVariants,
          current: roomConfig.chosenVariant || allowedVariants[0] || 'texas-holdem',
        });
        return res.status(200).json({ success: true, awaitingChoice: true });
      };

      if (isDealersChoice) {
        if (variant) {
          return applyVariantAndStart({ chosenVariant: variant, dcStepCount: 0 });
        }

        if (awaitingDealerChoiceStage) {
          return res.status(200).json({ success: true, awaitingChoice: true });
        }

        const threshold = (playerCount > 0 ? playerCount : 1) + 1;
        const nextStep = Number(roomConfig.dcStepCount || 0) + 1;

        if (nextStep >= threshold) {
          return promptDealerChoice();
        }

        return applyVariantAndStart({ dcStepCount: nextStep });
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
