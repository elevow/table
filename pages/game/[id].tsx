import { useRouter } from 'next/router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { getPrefetcher, dynamicImport } from '../../src/utils/code-splitting';
import { useComponentPerformance } from '../../src/utils/performance-monitor';
import { createInvite } from '../../src/services/friends-ui';
import { useUserAvatar } from '../../src/hooks/useUserAvatar';
import Avatar from '../../src/components/Avatar';
import { PotLimitCalculator } from '../../src/lib/poker/pot-limit';
import { HandEvaluator } from '../../src/lib/poker/hand-evaluator';
import { OutsCalculator } from '../../src/lib/poker/outs-calculator';
import OutsDisplay from '../../src/components/OutsDisplay';
import { useSupabaseRealtime } from '../../src/hooks/useSupabaseRealtime';
import { Card, Player, GameVariant } from '../../src/types/poker';
import { HandInterface } from '../../src/types/poker-engine';
import { formatPotOdds } from '../../src/lib/poker/pot-odds';
import type { GameSettings as GameSettingsType } from '../../src/components/GameSettings';
// Run It Twice: UI additions rely on optional runItTwice field in game state

type RebuyPromptState = {
  baseChips: number;
  rebuysUsed: number;
  rebuyLimit: number | 'unlimited';
  remaining: number | 'unlimited';
};

const persistSeatNumber = (storageKey: string | null, seatNumber: number | null) => {
  if (typeof window === 'undefined' || !storageKey) return;
  try {
    if (seatNumber === null) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, String(seatNumber));
    }
  } catch (err) {
    console.warn('Failed to persist seat marker:', err);
  }
};

const readSeatNumberFromStorage = (storageKey: string | null): number | null => {
  if (typeof window === 'undefined' || !storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (err) {
    console.warn('Failed to read seat marker:', err);
    return null;
  }
};

const GameBoard = dynamic(() => import('../../src/components/GameBoard'), {
  loading: () => <div className="skeleton-loader game-board-loader" />,
  ssr: false, // Disable server-side rendering for this component
});

// Prefetched but lazily loaded component
const ChatPanel = dynamic(() => import('../../src/components/ChatPanel'), {
  loading: () => <div className="skeleton-loader chat-panel-loader" />,
  ssr: true, // Enable server-side rendering
});

// On-demand loaded component
const GameSettings = dynamic(() => import('../../src/components/GameSettings'), {
  loading: () => <div className="skeleton-loader settings-loader" />,
  ssr: false,
});

// Component with granular code splitting
const CombinedTimerStats = dynamic(() => import('../../src/components/CombinedTimerStats'), {
  loading: () => <div className="skeleton-loader stats-loader" />,
});

// Rabbit Hunt Preview panel removed per user request

export default function GamePage() {
  const router = useRouter();
  const { id } = router.query;
  const tableId = useMemo(() => {
    if (typeof id === 'string') return id;
    if (Array.isArray(id) && id.length > 0) return id[0] as string;
    return '';
  }, [id]);
  const lastSeatStorageKey = tableId ? `table_lastSeat_${tableId}` : null;
  const chatPanelRef = useRef(null);
  const settingsRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  const [gameRoutes, setGameRoutes] = useState<import('../../src/utils/game-routes').GameRoute[]>([]);
  const { markInteraction } = useComponentPerformance('GamePage');
  const [playerId, setPlayerId] = useState<string>('');
  const [inviteeId, setInviteeId] = useState<string>('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  
  // Avatar data for current player
  const { avatarData: currentPlayerAvatar, loading: avatarLoading, error: avatarError } = useUserAvatar(playerId);
  
  // Avatar cache for all players (including other seated players)
  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string>>({});
  // Track in-flight avatar loads to avoid duplicate fetches
  const inFlightAvatarLoadsRef = useRef<Set<string>>(new Set());
  
  // Debug logging for avatar data
  useEffect(() => {
    // console.log('=== Avatar Debug Start ===');
    // console.log('Avatar Debug - playerId:', playerId);
    // console.log('Avatar Debug - currentPlayerAvatar:', currentPlayerAvatar);
    // console.log('Avatar Debug - avatarLoading:', avatarLoading);
    // console.log('Avatar Debug - avatarError:', avatarError);
    // console.log('Avatar Debug - useUserAvatar hook called with:', playerId);
    // console.log('=== Avatar Debug End ===');
    if (avatarError) {
      console.error('Avatar loading failed:', avatarError);
    }
  }, [playerId, currentPlayerAvatar, avatarLoading, avatarError]);
  
  // Function to load avatar for any player
  const loadPlayerAvatar = useCallback(async (playerIdToLoad: string) => {
    // Already cached
    if (playerAvatars[playerIdToLoad]) return;
    // De-dupe concurrent loads
    if (inFlightAvatarLoadsRef.current.has(playerIdToLoad)) return;
    inFlightAvatarLoadsRef.current.add(playerIdToLoad);

    try {
      const response = await fetch(`/api/avatars/user/${playerIdToLoad}`);
      if (response.ok) {
        const data = await response.json();
        if (data?.url) {
          setPlayerAvatars(prev => {
            const next = { ...prev, [playerIdToLoad]: data.url };
            // console.log('[Avatar] Cached URL for', playerIdToLoad, '→', data.url);
            return next;
          });
          return;
        }
      }
      // If no avatar found, generate default
      const shortId = playerIdToLoad.slice(-3).toUpperCase();
      const defaultAvatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(shortId)}&background=6b7280&color=fff&size=128`;
      setPlayerAvatars(prev => ({ ...prev, [playerIdToLoad]: defaultAvatarUrl }));
    } catch (error) {
      console.warn('Failed to load avatar for player:', playerIdToLoad, error);
      const shortId = playerIdToLoad.slice(-3).toUpperCase();
      const defaultAvatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(shortId)}&background=6b7280&color=fff&size=128`;
      setPlayerAvatars(prev => ({ ...prev, [playerIdToLoad]: defaultAvatarUrl }));
    } finally {
      inFlightAvatarLoadsRef.current.delete(playerIdToLoad);
    }
  }, [playerAvatars]);
  
  // Helper function to get avatar src for a player
  const getPlayerAvatarSrc = (playerIdForAvatar: string) => {
    // console.log('Getting avatar for player:', playerIdForAvatar, 'current playerId:', playerId);
    
    // For current player, use the loaded avatar data if available
    if (playerIdForAvatar === playerId && currentPlayerAvatar?.url) {
      // console.log('Returning current player avatar:', currentPlayerAvatar.url);
      return currentPlayerAvatar.url;
    }
    
    // For current player, if no avatar found or API error, generate default avatar
    if (playerIdForAvatar === playerId && (currentPlayerAvatar === null || avatarError)) {
      console.log('No avatar found for current player, generating default avatar');
      // Generate a nice default avatar using just the last 3 characters for cleaner initials
      const shortId = playerIdForAvatar.slice(-3).toUpperCase();
      return `https://ui-avatars.com/api/?name=${encodeURIComponent(shortId)}&background=0d8abc&color=fff&size=128`;
    }
    
    // For other players, use cached avatar if available
    if (playerAvatars[playerIdForAvatar]) {
      // console.log('Returning cached avatar for other player:', playerIdForAvatar, playerAvatars[playerIdForAvatar]);
      return playerAvatars[playerIdForAvatar];
    }
    
    // If avatar not loaded yet, generate temporary default and trigger load
    console.log('Avatar not loaded yet for other player, generating temporary default and triggering load');
    loadPlayerAvatar(playerIdForAvatar);
    const shortId = playerIdForAvatar.slice(-3).toUpperCase();
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(shortId)}&background=9ca3af&color=fff&size=128`;
  };
  
  // Room info state
  const [maxPlayers, setMaxPlayers] = useState<number>(6); // Default to 6, will be updated from room info
  // Room config (variant, betting mode, blinds)
  const [roomConfig, setRoomConfig] = useState<{
    variant?: string;
    bettingMode?: 'no-limit' | 'pot-limit';
    sb?: number;
    bb?: number;
    numberOfRebuys?: number | 'unlimited';
    timeBetweenRounds?: number;
  } | null>(null);
  
  // Seat management state - initialize dynamically based on maxPlayers
  const [seatAssignments, setSeatAssignments] = useState<Record<number, { playerId: string; playerName: string; chips: number } | null>>(() => {
    const seats: Record<number, { playerId: string; playerName: string; chips: number } | null> = {};
    for (let i = 1; i <= maxPlayers; i++) {
      seats[i] = null;
    }
    return seats;
  });
  const [currentPlayerSeat, setCurrentPlayerSeat] = useState<number | null>(null);
  const [seatStateReady, setSeatStateReady] = useState<boolean>(false);
  const [claimingSeat, setClaimingSeat] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'player' | 'guest'>('guest');
  const [playerChips, setPlayerChips] = useState<number>(0);
  const [rebuyPrompt, setRebuyPrompt] = useState<RebuyPromptState | null>(null);
  const [rebuySubmitting, setRebuySubmitting] = useState<boolean>(false);
  
  // Supabase is now the only supported transport
  const socketsDisabled = true;
  
  // Subscribe to Supabase realtime updates
  useSupabaseRealtime(
    id ? `${id}` : undefined,
    {
      onGameStateUpdate: (payload: any) => {
        console.log('📡 Supabase game_state_update:', payload);
        const { gameState, seq } = payload;
        
        // Validate sequence number to prevent out-of-order updates
        if (typeof seq === 'number') {
          if (seq < lastSeqRef.current) {
            console.warn(`⚠️ Ignoring out-of-order update: seq=${seq} < last=${lastSeqRef.current}`);
            return;
          }
          lastSeqRef.current = seq;
        }
        
        if (gameState) {
          // Check if this is a new hand/game start where we need to fetch our cards
          const lastAction = payload.lastAction;
          const isNewHand = lastAction?.action === 'game_started' || lastAction?.action === 'new_hand_started' || lastAction?.action === 'next_hand_started';
          
          // Try to find our player ID - use currentPlayerSeat + seatAssignments as fallback
          let effectivePlayerId = playerId;
          if (!effectivePlayerId && currentPlayerSeat && seatAssignments[currentPlayerSeat]) {
            effectivePlayerId = seatAssignments[currentPlayerSeat]!.playerId;
          }
          
          const meInState = gameState.players?.find((p: any) => p.id === effectivePlayerId);
          const missingMyCards = meInState && (!Array.isArray(meInState.holeCards) || meInState.holeCards.length === 0);
          const isParticipant = meInState && !meInState.isFolded;
          const shouldShowCards = gameState.stage !== 'showdown' && gameState.stage !== 'awaiting-dealer-choice';
          
          // Debug logging for card fetch conditions
          console.log('🎴 Card fetch check:', {
            isNewHand,
            playerId,
            effectivePlayerId,
            currentPlayerSeat,
            meInState: !!meInState,
            missingMyCards,
            isParticipant,
            shouldShowCards,
            lastAction: lastAction?.action,
            stage: gameState.stage,
            playerIds: gameState.players?.map((p: any) => p.id)
          });
          
          // If this is a new hand and we're a participant but don't have our cards,
          // fetch our player-specific state from the API
          if (isNewHand && missingMyCards && isParticipant && shouldShowCards && effectivePlayerId && id) {
            console.log('🎴 New hand detected without cards, fetching player-specific state...');
            fetch(`/api/games/state?tableId=${id}&playerId=${effectivePlayerId}`)
              .then(resp => {
                if (!resp.ok) {
                  throw new Error(`HTTP ${resp.status}`);
                }
                return resp.json();
              })
              .then(data => {
                if (data.gameState) {
                  setPokerGameState(data.gameState);
                  console.log('🎴 Player-specific state fetched with hole cards');
                }
              })
              .catch(err => console.warn('Failed to fetch player-specific state:', err));
          }
          
          // Preserve current player's hole cards from broadcast state
          // Broadcasts hide all hole cards for security, but we need to keep our own cards
          // visible if we already have them from a previous state or API response
          setPokerGameState((prevState: any) => {
            // Use effectivePlayerId which may come from currentPlayerSeat if playerId is not set
            const resolvedPlayerId = effectivePlayerId || playerId;
            if (!prevState || !resolvedPlayerId) return gameState;
            
            // Find the current player in both states
            const prevMe = prevState.players?.find((p: any) => p.id === resolvedPlayerId);
            const newMe = gameState.players?.find((p: any) => p.id === resolvedPlayerId);
            
            // Check if we should preserve hole cards:
            // 1. Previous state had our hole cards
            // 2. New state is missing our hole cards (undefined or empty)
            // 3. Hand number/round hasn't changed (if tracked) - or check that stage isn't showing a new hand reset
            const prevHoleCards = prevMe?.holeCards;
            const newHoleCards = newMe?.holeCards;
            const hadCards = Array.isArray(prevHoleCards) && prevHoleCards.length > 0;
            const missingCards = !Array.isArray(newHoleCards) || newHoleCards.length === 0;
            
            // If the new state already has our cards visible (showdown, all-in, or API response), use them
            if (!missingCards) return gameState;
            
            // If we had no previous cards to preserve, use the new state as-is
            if (!hadCards) return gameState;
            
            // Preserve our hole cards by merging them into the new state
            const mergedPlayers = Array.isArray(gameState.players)
              ? gameState.players.map((p: any) => {
                  if (p.id === resolvedPlayerId) {
                    return { ...p, holeCards: prevHoleCards };
                  }
                  return p;
                })
              : gameState.players;
            
            // Also preserve stud state down cards for current player if applicable
            let mergedStudState = gameState.studState;
            if (gameState.studState?.playerCards && prevState.studState?.playerCards) {
              const prevStudCards = prevState.studState.playerCards[resolvedPlayerId];
              const newStudCards = gameState.studState.playerCards[resolvedPlayerId];
              const hadDownCards = Array.isArray(prevStudCards?.downCards) && prevStudCards.downCards.length > 0;
              const missingDownCards = !Array.isArray(newStudCards?.downCards) || newStudCards.downCards.length === 0;
              
              if (hadDownCards && missingDownCards) {
                mergedStudState = {
                  ...gameState.studState,
                  playerCards: {
                    ...gameState.studState.playerCards,
                    [resolvedPlayerId]: {
                      upCards: newStudCards?.upCards || [],
                      downCards: prevStudCards.downCards,
                    },
                  },
                };
              }
            }
            
            return {
              ...gameState,
              players: mergedPlayers,
              studState: mergedStudState,
            };
          });
          setGameStarted(true);
          console.log('🎮 Game state updated:', gameState.stage, 'activePlayer:', gameState.activePlayer, 'seq:', seq);

          const derivedDc = computeDealerChoicePrompt(gameState);
          if (derivedDc) {
            applyDealerChoicePrompt(derivedDc);
          } else if (gameState.stage !== 'awaiting-dealer-choice') {
            applyDealerChoicePrompt(null);
          }

          // Update seat assignments from game state players
          if (Array.isArray(gameState.players)) {
            const updatedSeats: Record<number, { playerId: string; playerName: string; chips: number } | null> = { ...seatAssignments };
            
            gameState.players.forEach((player: any) => {
              if (player.position !== undefined && player.position >= 1 && player.position <= maxPlayers) {
                updatedSeats[player.position] = {
                  playerId: player.id,
                  playerName: player.name || `Player ${player.position}`,
                  chips: player.stack || 0
                };
              }
            });
            
            setSeatAssignments(updatedSeats);
          }
        }
      },
      onSeatClaimed: (payload: any) => {
        console.log('📡 Supabase seat_claimed:', payload);
        const { seatNumber, playerId: claimedPlayerId, playerName, chips } = payload;
        setSeatAssignments(prev => ({
          ...prev,
          [seatNumber]: { playerId: claimedPlayerId, playerName, chips }
        }));
        console.log('💺 Seat claimed:', seatNumber, playerName);
      },
      onSeatVacated: (payload: any) => {
        console.log('📡 Supabase seat_vacated:', payload);
        const { seatNumber } = payload;
        setSeatAssignments(prev => ({
          ...prev,
          [seatNumber]: null
        }));
        console.log('💺 Seat vacated:', seatNumber);
      },
      onAwaitingDealerChoice: (payload: any) => {
        if (!payload) return;
        applyDealerChoicePrompt({
          dealerId: payload.dealerId,
          allowedVariants: Array.isArray(payload.allowedVariants) && payload.allowedVariants.length > 0
            ? payload.allowedVariants
            : allowedDealerChoiceVariants.current,
          current: payload.current || payload.suggestedVariant || 'texas-holdem',
        });
      },
      onRebuyPrompt: (payload: any) => {
        console.log('📡 Supabase rebuy_prompt:', payload);
        if (!payload || payload.playerId !== playerId) return;
        const { baseChips = 20, rebuysUsed = 0, rebuyLimit = 'unlimited', remaining = 'unlimited' } = payload;
        setRebuyPrompt({ baseChips, rebuysUsed, rebuyLimit, remaining });
      },
      onRebuyResult: (payload: any) => {
        console.log('📡 Supabase rebuy_result:', payload);
        if (!payload || payload.playerId !== playerId) return;
        setRebuySubmitting(false);
        if (payload.status === 'accepted') {
          setRebuyPrompt(null);
          // Seat is updated via seat_state broadcast
        } else if (payload.status === 'declined') {
          setRebuyPrompt(null);
          // Seat is vacated via seat_vacated broadcast
        }
      }
    }
  );
  
  // Helper functions for game state
  const getSeatedPlayersCount = () => {
    return Object.values(seatAssignments).filter(assignment => assignment !== null).length;
  };
  
  const canStartGame = () => {
    const seatedCount = getSeatedPlayersCount();
    return seatedCount >= 2 && currentPlayerSeat !== null; // Need 2+ players and current player must be seated
  };
  
  // Game state
  const [gameStarted, setGameStarted] = useState(false);
  const [pokerGameState, setPokerGameState] = useState<any>(null);
  const pokerStageRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    pokerStageRef.current = pokerGameState?.stage;
  }, [pokerGameState?.stage]);
  // Track last received sequence number to prevent out-of-order updates
  const lastSeqRef = useRef<number>(0);
  // Prevent duplicate action submissions
  const pendingActionRef = useRef<boolean>(false);
  // Auto next-hand fallback timer ref
  const autoNextHandTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoNextHandScheduledRef = useRef<boolean>(false);
  // Visual accessibility options
  const [highContrastCards, setHighContrastCards] = useState<boolean>(false);
  const [showPotOdds, setShowPotOdds] = useState<boolean>(true);
  // Dealer's Choice: pending choice prompt from server
  const [awaitingDealerChoice, setAwaitingDealerChoice] = useState<null | { dealerId?: string; allowedVariants?: string[]; current?: string }>(null);
  const [selectedVariantDC, setSelectedVariantDC] = useState<string>('texas-holdem');
  // Track if the dealer has manually changed the selection to avoid overwriting with stale prompts
  const userChangedVariantRef = useRef<boolean>(false);
  const lastAwaitingDealerIdRef = useRef<string | undefined>(undefined);
  const allowedDealerChoiceVariants = useRef([
    'texas-holdem',
    'omaha',
    'omaha-hi-lo',
    'seven-card-stud',
    'seven-card-stud-hi-lo',
    'five-card-stud',
  ]);

  const applyDealerChoicePrompt = useCallback((prompt: { dealerId?: string; allowedVariants?: string[]; current?: string } | null) => {
    if (!prompt) {
      setAwaitingDealerChoice(null);
      userChangedVariantRef.current = false;
      lastAwaitingDealerIdRef.current = undefined;
      return;
    }
    if (Array.isArray(prompt.allowedVariants) && prompt.allowedVariants.length > 0) {
      allowedDealerChoiceVariants.current = prompt.allowedVariants as string[];
    }
    const incomingDealerId = prompt.dealerId;
    const prevDealerId = lastAwaitingDealerIdRef.current;
    const isNewSession = incomingDealerId && incomingDealerId !== prevDealerId;
    if (isNewSession) {
      userChangedVariantRef.current = false;
      lastAwaitingDealerIdRef.current = incomingDealerId;
      setSelectedVariantDC(prompt.current || 'texas-holdem');
    } else if (!userChangedVariantRef.current && prompt.current) {
      setSelectedVariantDC(prompt.current);
    }
    setAwaitingDealerChoice({
      dealerId: prompt.dealerId,
      allowedVariants: prompt.allowedVariants || allowedDealerChoiceVariants.current,
      current: prompt.current || 'texas-holdem',
    });
  }, []);

  const computeDealerChoicePrompt = useCallback((state: any) => {
    if (!state || state.stage !== 'awaiting-dealer-choice') return null;
    const players = Array.isArray(state.players) ? state.players : [];
    const playerCount = players.length;
    if (playerCount === 0) return null;
    const rawDealerIdx = typeof state.dealerPosition === 'number' ? state.dealerPosition : 0;
    const dealerIdx = playerCount > 0 ? ((rawDealerIdx + 1) % playerCount) : rawDealerIdx;
    const dealerId = players[dealerIdx]?.id;
    return {
      dealerId,
      allowedVariants: allowedDealerChoiceVariants.current,
      current: 'texas-holdem',
    };
  }, []);

  // Initialize high-contrast setting from localStorage and keep in sync when room changes
  useEffect(() => {
    try {
      if (!id) return;
      const raw = localStorage.getItem(`game_settings_${id}`);
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved?.highContrastCards === 'boolean') {
          setHighContrastCards(!!saved.highContrastCards);
        }
        if (typeof saved?.showPotOdds === 'boolean') {
          setShowPotOdds(saved.showPotOdds);
        }
      }
    } catch {}
  }, [id]);

  // Helper: suit -> Tailwind text color class, considering high contrast setting
  const suitColorClass = useCallback((suit: string) => {
    if (highContrastCards) {
      if (suit === 'hearts') return 'text-red-500';
      if (suit === 'diamonds') return 'text-yellow-500';
      if (suit === 'clubs') return 'text-blue-600';
      return 'text-black'; // spades
    }
    return (suit === 'hearts' || suit === 'diamonds') ? 'text-red-500' : 'text-black';
  }, [highContrastCards]);

  // Fetch room configuration to determine variant, betting mode, and blinds
  useEffect(() => {
    let alive = true;
    const fetchRoom = async () => {
      try {
        if (!id || typeof id !== 'string') return;
        const resp = await fetch(`/api/games/rooms/${id}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (!alive) return;
        const cfg = (data?.configuration || {}) as any;
        const blinds = (data?.blindLevels || {}) as any;
        const sb = Number(blinds?.sb) || Number(blinds?.smallBlind) || undefined;
        const bb = Number(blinds?.bb) || Number(blinds?.bigBlind) || undefined;
        const variant = cfg?.variant as string | undefined;
        const bettingMode = (cfg?.bettingMode as any) as ('no-limit' | 'pot-limit' | undefined);
        const numberOfRebuys = typeof cfg?.numberOfRebuys === 'number'
          ? cfg.numberOfRebuys
          : 'unlimited';
        const timeBetweenRounds = typeof cfg?.timeBetweenRounds === 'number'
          ? cfg.timeBetweenRounds
          : 5; // Default to 5 seconds
        setRoomConfig({ variant, bettingMode, sb, bb, numberOfRebuys, timeBetweenRounds });
      } catch {}
    };
    fetchRoom();
    return () => { alive = false; };
  }, [id]);
  
  // Load avatars for all seated players
  useEffect(() => {
    const seatedPlayerIds = Object.values(seatAssignments)
      .filter(assignment => assignment !== null)
      .map(assignment => assignment!.playerId)
      .filter(id => id !== playerId); // Exclude current player
    
    seatedPlayerIds.forEach(id => {
      loadPlayerAvatar(id);
    });
  }, [seatAssignments, playerId, loadPlayerAvatar]);

  // Client-side fallback: after showdown, request next hand based on configured time between rounds
  useEffect(() => {
    // Guard: need table id and a valid game state
    if (!id || typeof id !== 'string') return;

    const stage = pokerGameState?.stage;
    if (stage !== 'showdown') {
      if (autoNextHandTimerRef.current) {
        clearTimeout(autoNextHandTimerRef.current);
        autoNextHandTimerRef.current = null;
      }
      autoNextHandScheduledRef.current = false;
      return;
    }

    if (autoNextHandTimerRef.current || autoNextHandScheduledRef.current) {
      return;
    }

    // Use configured timeBetweenRounds (default 5 seconds) converted to milliseconds
    const delayMs = (roomConfig?.timeBetweenRounds ?? 5) * 1000;

    autoNextHandScheduledRef.current = true;
    autoNextHandTimerRef.current = setTimeout(async () => {
      try {
        if (pokerStageRef.current === 'showdown') {
          console.log(`[client auto] Requesting next hand after ${delayMs / 1000}s`);
          const response = await fetch('/api/games/next-hand', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableId: id, playerId }),
          });
          if (!response.ok) {
            console.warn('Next hand request failed:', await response.text());
          }
        }
      } catch (e) {
        console.warn('Auto next-hand request failed:', e);
      } finally {
        if (autoNextHandTimerRef.current) {
          clearTimeout(autoNextHandTimerRef.current);
          autoNextHandTimerRef.current = null;
        }
        autoNextHandScheduledRef.current = false;
      }
    }, delayMs);

    return () => {
      if (autoNextHandTimerRef.current) {
        clearTimeout(autoNextHandTimerRef.current);
        autoNextHandTimerRef.current = null;
      }
      autoNextHandScheduledRef.current = false;
    };
  }, [pokerGameState?.stage, id, playerId, roomConfig?.timeBetweenRounds]);
  
  // Periodic seat polling to reflect other players (only when game is NOT active)
  useEffect(() => {
    if (!id) return;
    // Don't poll seats if game is active - seats come from game state
    if (gameStarted || pokerGameState) return;
    let alive = true;
    let timer: any = null;

    const fetchSeats = async () => {
      try {
        const resp = await fetch(`/api/games/seats/state?tableId=${id}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (!alive) return;

        if (data.gameState) {
            setPokerGameState(data.gameState);
            const derivedDc = computeDealerChoicePrompt(data.gameState);
            if (derivedDc) {
              const incomingDealerId = derivedDc.dealerId;
              const prevDealerId = lastAwaitingDealerIdRef.current;
              const isNewSession = incomingDealerId && incomingDealerId !== prevDealerId;
              if (isNewSession) {
                userChangedVariantRef.current = false;
                lastAwaitingDealerIdRef.current = incomingDealerId;
                setSelectedVariantDC(derivedDc.current || 'texas-holdem');
              } else if (!userChangedVariantRef.current && derivedDc.current) {
                setSelectedVariantDC(derivedDc.current);
              }
              setAwaitingDealerChoice(derivedDc);
            } else if (data.gameState.stage !== 'awaiting-dealer-choice') {
              setAwaitingDealerChoice(null);
              setSelectedVariantDC('texas-holdem');
              userChangedVariantRef.current = false;
              lastAwaitingDealerIdRef.current = undefined;
            }
        }
      } catch (err) {
        console.warn('Failed to fetch seats state:', err);
      }
    };

    // Initial and interval fetch
    fetchSeats();
    timer = setInterval(fetchSeats, 3000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [id, playerId, seatAssignments, gameStarted, pokerGameState, computeDealerChoicePrompt]);

  // Seat management functions
  const claimSeat = async (seatNumber: number) => {
    if (userRole === 'guest') return; // Guests cannot claim seats
    if (seatAssignments[seatNumber]) return; // Seat already taken locally
    if (currentPlayerSeat) return; // Player already has a seat
    if (claimingSeat) return; // Already claiming

    // Get player name from localStorage, or generate a fallback
    const savedPlayerName = localStorage.getItem('playerName');
    const playerName = savedPlayerName || (() => {
      const playerNumber = playerId.replace(/\D/g, '').slice(-2) || Math.floor(Math.random() * 99).toString().padStart(2, '0');
      return `Player ${playerNumber}`;
    })();
    const startingChips = 20; // Initial chips client-side

    setClaimingSeat(seatNumber);

    try {
      const resp = await fetch('/api/games/seats/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: id, seatNumber, playerId, playerName, chips: startingChips })
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        console.warn('Seat claim failed:', e);
        setClaimingSeat(null);
        return;
      }
      const data = await resp.json();
      // Update local state and storage
      setSeatAssignments(prev => ({
        ...prev,
        [seatNumber]: { playerId, playerName, chips: Number(startingChips) }
      }));
      setCurrentPlayerSeat(seatNumber);
      persistSeatNumber(lastSeatStorageKey, seatNumber);
      setPlayerChips(Number(startingChips));
      try {
        if (id) localStorage.setItem(`seats_${id}`, JSON.stringify({ ...seatAssignments, [seatNumber]: { playerId, playerName, chips: Number(startingChips) } }));
        if (id) localStorage.setItem(`chips_${playerId}_${id}`, String(Number(startingChips)));
      } catch {}
      setClaimingSeat(null);
    } catch (err) {
      console.warn('Seat claim error:', err);
      setClaimingSeat(null);
    }
  };

  const standUp = () => {
    if (!currentPlayerSeat) return;

    const seatToVacate = currentPlayerSeat;
    const newAssignments = {
      ...seatAssignments,
      [currentPlayerSeat]: null
    };

    setSeatAssignments(newAssignments);
    setCurrentPlayerSeat(null);
    persistSeatNumber(lastSeatStorageKey, null);
    setPlayerChips(0);
    
    // Save to localStorage
    localStorage.setItem(`seats_${id}`, JSON.stringify(newAssignments));
    localStorage.removeItem(`chips_${playerId}_${id}`);

    // Notify server via HTTP
    try {
      fetch('/api/games/seats/stand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: id, seatNumber: seatToVacate, playerId })
      }).catch(() => {});
    } catch {}
  };

  // Start game handler
  const handleStartGame = async () => {
    if (!canStartGame()) {
      console.warn('Cannot start game: insufficient players or player not seated');
      return;
    }
    
    console.log('Starting game with', getSeatedPlayersCount(), 'players');
    setGameStarted(true);
    
    const seated = Object.entries(seatAssignments)
      .filter(([_, assignment]) => assignment !== null)
      .map(([seatNumber, assignment]) => ({
        seatNumber: parseInt(seatNumber),
        playerId: (assignment as any)!.playerId,
        playerName: (assignment as any)!.playerName,
        chips: (assignment as any)!.chips
      }));
    const variant = roomConfig?.variant || undefined;
    const bettingMode = roomConfig?.bettingMode || (variant === 'omaha' || variant === 'omaha-hi-lo' ? 'pot-limit' : undefined);
    const sb = roomConfig?.sb;
    const bb = roomConfig?.bb;
    const numberOfRebuys = roomConfig?.numberOfRebuys;

    // HTTP API for game start
    try {
      const response = await fetch(`/api/games/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: id,
          playerId,
          seatedPlayers: seated,
          variant,
          initialChoice: 'texas-holdem',
          bettingMode,
          smallBlind: sb,
          bigBlind: bb,
          sb,
          bb,
          numberOfRebuys,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        console.error('Start game failed:', err);
      } else {
        // Use the API response to set initial game state
        // The API returns a sanitized state that includes the current player's hole cards
        const data = await response.json();
        if (data.gameState) {
          setPokerGameState(data.gameState);
          console.log('🎴 Initial game state set with player cards from API');
        }
      }
    } catch (error) {
      console.error('Error starting game:', error);
    }
  };

  // Poker action handlers
  const handlePokerAction = useCallback(async (action: string, amount?: number) => {
    if (!pokerGameState || !playerId) {
      console.warn('Cannot perform action: missing game state or player ID');
      return;
    }

    const isFold = action === 'fold';
    if (!isFold && pokerGameState?.activePlayer && pokerGameState.activePlayer !== playerId) {
      console.warn('Action blocked: not your turn', { action, activePlayer: pokerGameState.activePlayer, playerId });
      return;
    }

    // Prevent duplicate submissions
    if (pendingActionRef.current) {
      console.warn('Action already in progress, ignoring duplicate request');
      return;
    }

    pendingActionRef.current = true;
    console.log(`Performing ${action}${amount ? ` for ${amount}` : ''}`);
    
    try {
      const response = await fetch('/api/games/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: id,
          playerId,
          action,
          amount,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        console.error('Poker action failed:', err);
      } else {
        // Use the API response to update game state
        // The API returns a sanitized state that includes the current player's hole cards
        const data = await response.json();
        if (data.gameState) {
          setPokerGameState(data.gameState);
          console.log('🎴 Game state updated with player cards from action API');
        }
      }
    } catch (error) {
      console.error('Error performing poker action:', error);
    } finally {
      // Clear the pending flag after a short delay to allow the action to be processed
      setTimeout(() => {
        pendingActionRef.current = false;
      }, 500);
    }
  }, [pokerGameState, playerId, id]);

  const handleFold = useCallback(() => handlePokerAction('fold'), [handlePokerAction]);
  const handleCheck = useCallback(() => handlePokerAction('check'), [handlePokerAction]);
  const handleCall = useCallback(() => {
    if (pokerGameState?.currentBet) {
      const playerInGame = pokerGameState.players.find((p: any) => p.id === playerId);
      const callAmount = pokerGameState.currentBet - (playerInGame?.currentBet || 0);
      handlePokerAction('call', callAmount);
    }
  }, [pokerGameState, playerId, handlePokerAction]);
  const handleBet = useCallback((amount: number) => handlePokerAction('bet', amount), [handlePokerAction]);
  const handleRaise = useCallback((amount: number) => handlePokerAction('raise', amount), [handlePokerAction]);

  // Get current player's hole cards
  const getCurrentPlayerCards = () => {
    if (!pokerGameState || !playerId) return [];
    const player = pokerGameState.players.find((p: any) => p.id === playerId);
    return player?.holeCards || [];
  };

  // Variant helpers
  const isStudVariant = () => {
    const v = pokerGameState?.variant;
    return v === 'seven-card-stud' || v === 'seven-card-stud-hi-lo' || v === 'five-card-stud';
  };

  const getStudCardsForPlayer = useCallback((pid: string) => {
    const st = (pokerGameState as any)?.studState?.playerCards?.[pid];
    return {
      down: Array.isArray(st?.downCards) ? st.downCards : [],
      up: Array.isArray(st?.upCards) ? st.upCards : [],
    } as { down: any[]; up: any[] };
  }, [pokerGameState]);

  type HandSummary = { primary: string | null; highLabel: string | null; lowLabel: string | null };

  // Compute friendly hand info (high + optional low for Hi-Lo variants)
  const getMyHandSummary = useCallback((): HandSummary => {
    const fallback: HandSummary = { primary: null, highLabel: null, lowLabel: null };
    try {
      if (!pokerGameState || !playerId) return fallback;
      const variant = pokerGameState?.variant as string | undefined;
      const me = pokerGameState.players?.find((p: any) => p.id === playerId);
      if (!me) return fallback;

      const weight: Record<string, number> = { '2': 2,'3': 3,'4': 4,'5': 5,'6': 6,'7': 7,'8': 8,'9': 9,'10': 10,'J': 11,'Q': 12,'K': 13,'A': 14 };
      const sym = (r: string) => (r === '10' ? 'T' : r);
      const formatWithKickers = (hr: any): string => {
        try {
          const name = String(hr?.name || hr?.description || '') || null;
          const best: any[] = Array.isArray(hr?.cards) ? hr.cards : [];
          if (!name || best.length < 5) return name || '';
          const lower = name.toLowerCase();
          if (lower.includes('straight') || lower.includes('flush')) return name;
          const counts: Record<string, number> = {};
          for (const c of best) counts[c.rank] = (counts[c.rank] || 0) + 1;
          const freqVals = Object.values(counts).sort((a, b) => b - a);
          const handRanks = new Set<string>();
          if (freqVals[0] === 4) {
            const quad = Object.keys(counts).find(r => counts[r] === 4);
            if (quad) handRanks.add(quad);
          } else if (freqVals[0] === 3 && freqVals[1] === 2) {
            const trip = Object.keys(counts).find(r => counts[r] === 3);
            const pair = Object.keys(counts).find(r => counts[r] === 2);
            if (trip) handRanks.add(trip);
            if (pair) handRanks.add(pair);
          } else if (freqVals[0] === 3) {
            const trip = Object.keys(counts).find(r => counts[r] === 3);
            if (trip) handRanks.add(trip);
          } else if (freqVals[0] === 2 && freqVals[1] === 2) {
            Object.keys(counts).forEach(r => { if (counts[r] === 2) handRanks.add(r); });
          } else if (freqVals[0] === 2) {
            const pair = Object.keys(counts).find(r => counts[r] === 2);
            if (pair) handRanks.add(pair);
          } else {
            const sortedBest = [...best].sort((a, b) => (weight[b.rank] || 0) - (weight[a.rank] || 0));
            if (sortedBest[0]) handRanks.add(sortedBest[0].rank);
          }
          const kickerRanks = best
            .filter(c => !handRanks.has(c.rank))
            .sort((a, b) => (weight[b.rank] || 0) - (weight[a.rank] || 0))
            .map(c => sym(c.rank));
          if (kickerRanks.length === 0) return name;
          return `${name} + ${kickerRanks.join('')}`;
        } catch {
          return String(hr?.name || hr?.description || '');
        }
      };

      const partialLabel = (cards: any[]): string | null => {
        if (!Array.isArray(cards) || cards.length === 0) return null;
        const byRank: Record<string, number> = {};
        cards.forEach((c: any) => { byRank[c?.rank] = (byRank[c?.rank] || 0) + 1; });
        const counts = Object.entries(byRank).sort((a, b) => b[1] - a[1]);
        if (counts[0]?.[1] === 4) return `Four of a Kind (${counts[0][0]})`;
        if (counts[0]?.[1] === 3) return `Three of a Kind (${counts[0][0]})`;
        if (counts[0]?.[1] === 2) {
          const pairs = counts.filter(([, n]) => n === 2);
          if (pairs.length >= 2) return 'Two Pair';
          return `Pair of ${counts[0][0]}s`;
        }
        const order: Record<string, number> = { '2': 2,'3': 3,'4': 4,'5': 5,'6': 6,'7': 7,'8': 8,'9': 9,'10': 10,'J': 11,'Q': 12,'K': 13,'A': 14 };
        const top = [...cards].sort((a, b) => (order[b.rank] || 0) - (order[a.rank] || 0))[0];
        return top?.rank ? `${top.rank === 'A' ? 'Ace' : top.rank === 'K' ? 'King' : top.rank === 'Q' ? 'Queen' : top.rank === 'J' ? 'Jack' : top.rank} High` : null;
      };

      const computeHighLabel = (): string | null => {
        if (variant === 'seven-card-stud' || variant === 'seven-card-stud-hi-lo' || variant === 'five-card-stud') {
          const { down, up } = getStudCardsForPlayer(playerId);
          const all = [...(down || []), ...(up || [])];
          if (!all || all.length === 0) return null;
          if (all.length < 5) return partialLabel(all);
          const ranking = HandEvaluator.getHandRanking(all, []);
          return formatWithKickers(ranking) || null;
        }

        const holes = Array.isArray(me?.holeCards) ? me.holeCards : [];
        const board = Array.isArray(pokerGameState?.communityCards) ? pokerGameState.communityCards : [];
        if (!holes || holes.length === 0) return null;
        const known = [...holes, ...board];
        if (known.length < 5) return partialLabel(known);

        if (variant === 'omaha' || variant === 'omaha-hi-lo') {
          const ranking = HandEvaluator.getOmahaHandRanking(holes, board);
          return formatWithKickers(ranking) || null;
        }

        const ranking = HandEvaluator.getHandRanking(holes, board);
        return formatWithKickers(ranking) || null;
      };

      const highLabel = computeHighLabel();
      let lowLabel: string | null = null;
      const lowRankLabel = (value: number) => {
        const map: Record<number, string> = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K' };
        return map[value] || String(value);
      };
      const describeLow = (ranks: number[]): string | null => {
        if (!Array.isArray(ranks) || ranks.length === 0) return null;
        return `${ranks.map(lowRankLabel).join('-')} Low`;
      };

      if (variant === 'omaha-hi-lo') {
          const holes = Array.isArray(me?.holeCards) ? me.holeCards : [];
          const board = Array.isArray(pokerGameState?.communityCards) ? pokerGameState.communityCards : [];
          if (holes.length >= 2 && board.length >= 3) {
            const low = HandEvaluator.evaluateOmahaLowEightOrBetter(holes, board);
            if (low) lowLabel = describeLow(low.ranks);
          }
      } else if (variant === 'seven-card-stud-hi-lo') {
        const { down, up } = getStudCardsForPlayer(playerId);
        const all = [...(down || []), ...(up || [])];
        if (all.length >= 5) {
          const low = HandEvaluator.evaluateAceToFiveLow(all);
          if (low) lowLabel = describeLow(low.ranks);
        }
      }

      return { primary: highLabel, highLabel, lowLabel };
    } catch (e) {
      console.warn('Hand summary computation failed:', e);
      return fallback;
    }
  }, [pokerGameState, playerId, getStudCardsForPlayer]);

  // Defensive: compute remaining non-folded players from current state
  const getActiveNonFoldedPlayers = useCallback(() => {
    if (!pokerGameState?.players) return [] as any[];
    return pokerGameState.players.filter((p: any) => !(p.folded || p.isFolded));
  }, [pokerGameState]);

  const getPlayerLabel = useCallback((pid?: string | null) => {
    if (!pid) return null;
    const fromGame = pokerGameState?.players?.find((p: any) => p.id === pid);
    if (fromGame?.name) return fromGame.name;
    const seatEntry = Object.values(seatAssignments).find((seat) => seat?.playerId === pid);
    if (seatEntry?.playerName) return seatEntry.playerName;
    return pid.slice(0, 6).toUpperCase();
  }, [pokerGameState?.players, seatAssignments]);

  // Helpers for No-Limit bet/raise controls
  const getMe = useCallback(() => {
    if (!pokerGameState?.players || !playerId) return null as any;
    return pokerGameState.players.find((p: any) => p.id === playerId) || null;
  }, [pokerGameState, playerId]);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const getMinBet = useCallback(() => {
    const bb = Number(pokerGameState?.bigBlind || 0) || 0;
    const me = getMe();
    const stack = Number(me?.stack || 0) || 0;
    // If short-stacked, min becomes all-in (short bet allowed)
    return Math.min(Math.max(bb, 0.01), stack + Number(me?.currentBet || 0));
  }, [pokerGameState?.bigBlind, getMe]);

  const getBetBounds = useCallback(() => {
    const me = getMe();
    const prev = Number(me?.currentBet || 0);
    const stack = Number(me?.stack || 0);
    const min = getMinBet();
    const max = prev + stack; // total target for all-in
    return { min: Number(min.toFixed(2)), max: Number(max.toFixed(2)) };
  }, [getMe, getMinBet]);

  const getRaiseBounds = useCallback(() => {
    const state = pokerGameState as any;
    const me = getMe();
    const currentBet = Number(state?.currentBet || 0);
    const minRaise = Number(state?.minRaise || 0);
    const prev = Number(me?.currentBet || 0);
    const stack = Number(me?.stack || 0);
    // Minimum legal raise total is currentBet + minRaise; allow short all-in if not enough chips
    const minTotal = currentBet + minRaise;
    const maxTotal = prev + stack;
    const min = Math.min(minTotal, maxTotal);
    const max = maxTotal;
    return { min: Number(min.toFixed(2)), max: Number(max.toFixed(2)) };
  }, [pokerGameState, getMe]);

  // Helper to render pot odds display
  const renderPotOdds = useCallback(() => {
    if (!showPotOdds || !pokerGameState) {
      return null;
    }
    
    // Early return if no current bet - player can check/bet rather than call
    const currentBet = pokerGameState.currentBet || 0;
    if (currentBet === 0) {
      return null;
    }
    
    const me = getMe();
    if (!me) {
      return null;
    }
    
    const myCurrentBet = Number(me?.currentBet || 0);
    const betToCall = currentBet - myCurrentBet;
    const potSize = Number(pokerGameState.pot || 0);
    
    // Debug logging in development to help diagnose issues
    if (process.env.NODE_ENV === 'development') {
      console.log('[Pot Odds Debug]', {
        playerId,
        currentBet,
        myCurrentBet,
        betToCall,
        potSize,
        showPotOdds
      });
    }
    
    // Double-check betToCall is positive (shouldn't happen given above check, but defensive)
    if (betToCall <= 0) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Pot Odds] No bet to call (betToCall <= 0)');
      }
      return null;
    }
    
    const potOddsDisplay = formatPotOdds(potSize, betToCall);
    if (!potOddsDisplay) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Pot Odds] formatPotOdds returned null');
      }
      return null;
    }
    
    return (
      <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
        <div className="text-sm text-gray-700 dark:text-gray-300">
          <span className="font-semibold text-gray-900 dark:text-gray-100">Pot Odds:</span> {potOddsDisplay}
        </div>
      </div>
    );
    // playerId is only used in development console.log, intentionally not in dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPotOdds, pokerGameState, getMe]);

  // Pot-Limit helpers
  const getPotLimitPlayersShape = useCallback(() => {
    const arr = Array.isArray(pokerGameState?.players) ? pokerGameState.players : [];
    return arr.map((p: any) => ({
      currentBet: Number(p?.currentBet || 0),
      isFolded: !!(p?.isFolded || p?.folded),
      isAllIn: !!p?.isAllIn,
    }));
  }, [pokerGameState?.players]);

  const getPotLimitBetBounds = useCallback(() => {
    const me = getMe();
    if (!me) return { min: 0, max: 0 };
    const prev = Number(me.currentBet || 0);
    const stack = Number(me.stack || 0);
    const pot = Number(pokerGameState?.pot || 0) || 0;
    const plc = PotLimitCalculator.calculateMaxBet(pot, 0, getPotLimitPlayersShape(), prev);
    const maxTotal = Math.min(prev + stack, plc.maxBet);
    const bb = Number(pokerGameState?.bigBlind || 0) || 0.01;
    const min = Math.min(Math.max(bb, 0.01), maxTotal);
    return { min: Number(min.toFixed(2)), max: Number(maxTotal.toFixed(2)) };
  }, [getMe, pokerGameState?.pot, pokerGameState?.bigBlind, getPotLimitPlayersShape]);

  const getPotLimitRaiseBounds = useCallback(() => {
    const me = getMe();
    if (!me) return { min: 0, max: 0 };
    const prev = Number(me.currentBet || 0);
    const stack = Number(me.stack || 0);
    const pot = Number(pokerGameState?.pot || 0) || 0;
    const currentBet = Number(pokerGameState?.currentBet || 0) || 0;
    const minRaise = Number(pokerGameState?.minRaise || 0) || 0;
    const plc = PotLimitCalculator.calculateMaxBet(pot, currentBet, getPotLimitPlayersShape(), prev);
    const maxTotal = Math.min(prev + stack, plc.maxBet);
    const minTotal = currentBet + minRaise;
    const min = Math.min(minTotal, maxTotal);
    return { min: Number(min.toFixed(2)), max: Number(maxTotal.toFixed(2)) };
  }, [getMe, pokerGameState?.pot, pokerGameState?.currentBet, pokerGameState?.minRaise, getPotLimitPlayersShape]);

  // --- Run It Twice (RIT) helpers ---
  const runItTwicePrompt = pokerGameState?.runItTwicePrompt || null;
  const isRunItTwicePromptOwner = !!runItTwicePrompt && runItTwicePrompt.playerId === playerId;
  const runItTwicePromptOwnerName = runItTwicePrompt ? getPlayerLabel(runItTwicePrompt.playerId) : null;
  const runItTwicePromptTieNames = runItTwicePrompt?.tiedWith
    ? runItTwicePrompt.tiedWith
        .map((id: string) => getPlayerLabel(id))
        .filter((name: string | null): name is string => !!name)
    : [];
  const runItTwiceViewerHandDescription = useMemo(() => {
    if (!runItTwicePrompt) return null;
    const viewerId = playerId;
    const viewerDesc = viewerId ? runItTwicePrompt.handDescriptionsByPlayer?.[viewerId] : null;
    return viewerDesc || runItTwicePrompt.handDescription || null;
  }, [runItTwicePrompt, playerId]);
  const runItTwiceHighestHandDescription = runItTwicePrompt?.highestHandDescription || null;
  const runItTwiceBoards = Array.isArray(pokerGameState?.runItTwice?.boards)
    ? pokerGameState.runItTwice.boards
    : [];
  const supabaseSecondRunBoard = runItTwiceBoards.length > 1
    ? runItTwiceBoards[1]
    : null;
  const anyAllIn = () => {
    try {
      return Array.isArray(pokerGameState?.players) && pokerGameState.players.some((p: any) => p.isAllIn);
    } catch { return false; }
  };
  const bettingClosed = () => {
    // Approximation: betting is closed if stage is showdown OR all non-folded/all-in have acted & equal bets
    if (!pokerGameState) return false;
    if (pokerGameState.stage === 'showdown') return true;
    // If there is an activePlayer it's likely still betting unless only one remains
    return false; // conservative; server will enforce
  };
  const enableRunItTwice = async (runs: number) => {
    if (!id || typeof id !== 'string') return;
    
    // Use HTTP REST API
    try {
      const response = await fetch('/api/games/enable-rit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: id, playerId, runs }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Failed to process Run-It-Twice decision:', errorData);
      }
    } catch (error) {
      console.error('Error sending Run-It-Twice decision:', error);
    }
  };

  // Determine dealer/small blind/big blind tokens for a player based on current game state
  const getPlayerToken = useCallback((playerIdForToken: string): 'D' | 'SB' | 'BB' | null => {
    try {
      const gs = pokerGameState;
      if (!gs || !Array.isArray(gs.players) || gs.players.length < 2) return null;

      const players = gs.players as Array<{ id: string; position?: number }>;
      const dealerIdx = Number(gs.dealerPosition);
      if (!Number.isFinite(dealerIdx)) return null;
      const n = players.length;

      const dealerId = players[dealerIdx]?.id;
      if (!dealerId) return null;

      if (n === 2) {
        // Heads-up: dealer posts SB; other posts BB
        const sbId = dealerId;
        const bbId = players[(dealerIdx + 1) % n]?.id;
        if (playerIdForToken === dealerId) return 'D';
        if (playerIdForToken === sbId) return 'SB';
        if (playerIdForToken === bbId) return 'BB';
        return null;
      }

      // Ring games (3+): SB/BB are left of dealer so tokens rotate every hand
      const sbId = players[(dealerIdx + 1) % n]?.id;
      const bbId = players[(dealerIdx + 2) % n]?.id;
      if (playerIdForToken === dealerId) return 'D';
      if (playerIdForToken === sbId) return 'SB';
      if (playerIdForToken === bbId) return 'BB';
      return null;
    } catch {
      return null;
    }
  }, [pokerGameState]);

  // Local state for inputs
  const [betInput, setBetInput] = useState<number>(0);
  const [raiseInput, setRaiseInput] = useState<number>(0);
  // Auto-fold preference (when it's not our turn, fold immediately when it becomes our turn)
  const [autoFold, setAutoFold] = useState<boolean>(false);
  // Auto-call preference (when it's not our turn, call immediately when it becomes our turn)
  const [autoCall, setAutoCall] = useState<boolean>(false);
  // Auto-check preference (when it's not our turn, check immediately when it becomes our turn and no bet is required)
  const [autoCheck, setAutoCheck] = useState<boolean>(false);

  // Update defaults when it's our turn or state changes
  useEffect(() => {
    if (!pokerGameState || pokerGameState.activePlayer !== playerId) return;
    const mode = (pokerGameState?.bettingMode || 'no-limit') as 'no-limit' | 'pot-limit';
    if ((pokerGameState.currentBet || 0) === 0) {
      const { min, max } = mode === 'no-limit' ? getBetBounds() : getPotLimitBetBounds();
      setBetInput(clamp(min, min, max));
    } else {
      const { min, max } = mode === 'no-limit' ? getRaiseBounds() : getPotLimitRaiseBounds();
      setRaiseInput(clamp(min, min, max));
    }
  }, [pokerGameState, playerId, getBetBounds, getPotLimitBetBounds, getRaiseBounds, getPotLimitRaiseBounds]);

  // If Auto Fold is enabled and it's our turn, immediately fold and clear the checkbox
  useEffect(() => {
    if (!autoFold) return;
    const gs = pokerGameState;
    if (!gs || gs.stage === 'showdown') return;
    if (gs.activePlayer !== playerId) return;
    const me = gs.players?.find((p: any) => p.id === playerId);
    if (!me || me.isFolded) return;
    // Execute fold and clear autoFold to prevent repeated triggers
    handleFold();
    setAutoFold(false);
  }, [autoFold, pokerGameState, playerId, handleFold]);

  // If Auto Call is enabled and it's our turn, immediately call (even if amount is 0) and clear the checkbox
  useEffect(() => {
    if (!autoCall) return;
    const gs = pokerGameState;
    if (!gs || gs.stage === 'showdown') return;
    if (gs.activePlayer !== playerId) return;
    // If auto-fold is also enabled, give fold priority and let autoCall wait or be toggled off by user
    if (autoFold) return;
    const me = gs.players?.find((p: any) => p.id === playerId);
    if (!me || me.isFolded) return;
    const neededAmount = Math.max(0, Number(gs.currentBet || 0) - Number(me.currentBet || 0));
    // If no bet is required and autoCheck is enabled, prefer check over a zero-call
    if (neededAmount === 0 && autoCheck) return;
    handlePokerAction('call', neededAmount);
    setAutoCall(false);
  }, [autoCall, autoFold, autoCheck, pokerGameState, playerId, handlePokerAction]);

  // If Auto Check is enabled and it's our turn with no bet required, immediately check and clear the checkbox
  useEffect(() => {
    if (!autoCheck) return;
    const gs = pokerGameState;
    if (!gs || gs.stage === 'showdown') return;
    if (gs.activePlayer !== playerId) return;
    // If auto-fold is enabled, fold has priority.
    if (autoFold) return;
    const me = gs.players?.find((p: any) => p.id === playerId);
    if (!me || me.isFolded) return;
    const neededAmount = Math.max(0, Number(gs.currentBet || 0) - Number(me.currentBet || 0));
    if (neededAmount === 0) {
      handleCheck();
      setAutoCheck(false);
    }
  }, [autoCheck, autoFold, pokerGameState, playerId, handleCheck]);

  // Get position for current player's hole cards based on their seat
  const getCurrentPlayerCardsPosition = () => {
    // Place the current player's cards centered near the bottom of the felt,
    // lowered to just touch the top of the avatar positioned below the table.
    if (!currentPlayerSeat) return 'bottom-6 left-1/2 transform -translate-x-1/2';
    return 'bottom-2 left-1/2 transform -translate-x-1/2';
  };

  // Render seat component with adjacent player info
  const renderSeat = (seatNumber: number, position: string, style?: React.CSSProperties) => {
    const assignment = seatAssignments[seatNumber];
    const isCurrentPlayer = assignment?.playerId === playerId;
  const isEmpty = !assignment;
  // Allow claiming even if seat state hasn't synced yet; server validates occupancy
  const canClaim = isEmpty && userRole !== 'guest' && !currentPlayerSeat && claimingSeat === null;

    // Determine info box position based on seat coordinates - RIGHT NEXT to each seat
    const getInfoBoxPosition = (currentPosition: string, seatStyle?: React.CSSProperties) => {
      // Special case: for the current player, show info card to the right of their avatar
      // We know the current player's avatar is anchored at bottom-center (left: 50%, top: 104%)
      // so we offset horizontally to the right with a translate to avoid overlap.
      if (isCurrentPlayer) {
        // Position info box so its left edge touches the avatar circle's right edge (w-16 => 64px, half=32px + 2px border)
        // Use calc to place left at 50% + 34px; keep vertical centering relative to avatar center
        return 'left-[calc(50%+34px)] top-[104%] transform -translate-y-1/2';
      }

      // If we have style coordinates, use them to determine position
      if (seatStyle && seatStyle.left && seatStyle.top) {
        const leftPercent = parseFloat(seatStyle.left.toString().replace('%', ''));
        const topPercent = parseFloat(seatStyle.top.toString().replace('%', ''));
        
        // More precise positioning based on 8 directions around the table
        if (topPercent < 25) {
          // Top area
          if (leftPercent < 35) {
            // Top-left - info touching table edge
            return '-top-2 -left-2';
          } else if (leftPercent > 65) {
            // Top-right - info touching table edge
            return '-top-2 -right-2';
          } else {
            // Top-center - info pushed above table edge
            return '-top-20 left-1/2 transform -translate-x-1/2';
          }
        } else if (topPercent > 75) {
          // Bottom area
          if (leftPercent < 35) {
            // Bottom-left - info touching table edge
            return '-bottom-2 -left-2';
          } else if (leftPercent > 65) {
            // Bottom-right - info touching table edge
            return '-bottom-2 -right-2';
          } else {
            // Bottom-center - info pushed below table edge
            return '-bottom-20 left-1/2 transform -translate-x-1/2';
          }
        } else {
          // Middle area (left/right sides)
          if (leftPercent < 50) {
            // Left side - info touching table edge
            return 'top-0 -left-2';
          } else {
            // Right side - info touching table edge
            return 'top-0 -right-2';
          }
        }
      }
      
      // Fallback to CSS class-based positioning for backwards compatibility
      if (currentPosition.includes('top-1') && currentPosition.includes('left-1/2')) {
        return '-top-16 left-1/2 transform -translate-x-1/2';
      } else if (currentPosition.includes('top-8') && currentPosition.includes('right-8')) {
        return 'top-0 -right-32';
      } else if (currentPosition.includes('bottom-8') && currentPosition.includes('right-8')) {
        return 'bottom-0 -right-32';
      } else if (currentPosition.includes('bottom-1') && currentPosition.includes('left-1/2')) {
        return '-bottom-16 left-1/2 transform -translate-x-1/2';
      } else if (currentPosition.includes('bottom-8') && currentPosition.includes('left-8')) {
        return 'bottom-0 -left-32';
      } else if (currentPosition.includes('top-8') && currentPosition.includes('left-8')) {
        return 'top-0 -left-32';
      }
      
      // Default fallback
      return '-bottom-16 left-1/2 transform -translate-x-1/2';
    };



    return (
      <React.Fragment key={seatNumber}>
        {/* Main seat */}
        <div
          className={`absolute w-16 h-16 rounded-full border-2 flex flex-col items-center justify-center text-white text-xs font-semibold relative ${position} ${
            isEmpty
              ? canClaim
                ? 'bg-gray-600 border-gray-500 hover:bg-gray-500 hover:border-gray-400 cursor-pointer opacity-60 hover:opacity-80'
                : 'bg-gray-700 border-gray-600 opacity-50'
              : isCurrentPlayer
                ? 'bg-blue-600 border-blue-500 opacity-90'
                : 'bg-green-600 border-green-500 opacity-80'
          }`}
          style={style}
          onClick={() => {
            if (canClaim) {
              claimSeat(seatNumber);
            } else {
              try {
                console.warn('Seat click blocked', {
                  seatNumber,
                  isEmpty,
                  userRole,
                  currentPlayerSeat,
                  seatStateReady,
                  claimingSeat,
                });
              } catch {}
            }
          }}
          title={
            isEmpty
              ? canClaim
                ? 'Click to claim this seat'
                : claimingSeat === seatNumber
                  ? 'Claim pending…'
                  : userRole === 'guest'
                    ? 'Guests cannot claim seats'
                    : currentPlayerSeat
                      ? 'You already have a seat'
                      : (!seatStateReady ? 'Please wait… syncing seats' : 'Seat not available')
              : isCurrentPlayer
                ? 'Your seat - click Stand Up button to leave'
                : `${assignment.playerName} - $${assignment.chips || 0}`
          }
        >
          {isEmpty ? (
            <div className="text-center leading-tight text-white text-xs font-semibold">
              {claimingSeat === seatNumber ? 'Claiming…' : <>P{seatNumber}</>}
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Avatar 
                src={getPlayerAvatarSrc(assignment.playerId)}
                size="lg"
                className="w-12 h-12 rounded-full border-2 border-white shadow-sm"
                alt={assignment.playerName || `Player ${seatNumber}`}
              />
              {(() => {
                const token = getPlayerToken(assignment.playerId);
                if (!token) return null;
                const styleMap: Record<'D' | 'SB' | 'BB', string> = {
                  D: 'bg-white text-gray-900 border-gray-300',
                  SB: 'bg-sky-600 text-white border-sky-400',
                  BB: 'bg-indigo-700 text-white border-indigo-500',
                };
                return (
                  <div
                    className={`absolute -top-2 -right-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold border shadow ${styleMap[token]}`}
                    title={token === 'D' ? 'Dealer' : token === 'SB' ? 'Small Blind' : 'Big Blind'}
                    aria-label={token === 'D' ? 'Dealer' : token === 'SB' ? 'Small Blind' : 'Big Blind'}
                    style={{ pointerEvents: 'none' }}
                  >
                    {token}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Player info box - only show if seat is occupied */}
        {!isEmpty && assignment && (
          <div
            className={`absolute ${getInfoBoxPosition(position, style)} z-10`}
            style={{ pointerEvents: 'none' }}
          >
            <div className={`px-3 py-2 rounded-lg shadow-lg border-2 text-xs ${
              isCurrentPlayer
                ? 'bg-blue-100 dark:bg-blue-900/80 border-blue-300 dark:border-blue-600 text-blue-900 dark:text-blue-100'
                : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100'
            }`}>
              <div className="font-semibold whitespace-nowrap">
                {assignment.playerName || `Player ${seatNumber}`}
              </div>
              <div className="text-green-600 dark:text-green-400 font-bold">
                ${assignment.chips || 20}
              </div>
              {/* Show additional game state info if player is in active game */}
              {pokerGameState && (() => {
                const gamePlayer = pokerGameState.players?.find((p: any) => p.id === assignment.playerId);
                return gamePlayer && (
                  <div className="text-xs mt-1">
                    {gamePlayer.folded && <span className="text-red-500">Folded</span>}
                    {gamePlayer.isAllIn && <span className="text-yellow-500">All-in</span>}
                    {gamePlayer.currentBet > 0 && !gamePlayer.folded && (
                      <span className="text-blue-500">Bet: ${gamePlayer.currentBet}</span>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Opponent cards rendering (variant-aware) */}
        {gameStarted && pokerGameState && !isEmpty && assignment && !isCurrentPlayer && (() => {
          const gamePlayer = pokerGameState.players?.find((p: any) => p.id === assignment.playerId);
          const hasFolded = !!(gamePlayer?.folded || gamePlayer?.isFolded);
          if (!gamePlayer || hasFolded) return null;

          // Compute position offset based on seat location (push cards slightly further from table center)
          let cardStyle: React.CSSProperties | undefined = undefined;
          if (style && style.left && style.top) {
            const leftStr = style.left.toString();
            const topStr = style.top.toString();
            const leftPercent = parseFloat(leftStr.replace('%', ''));
            const topPercent = parseFloat(topStr.replace('%', ''));
            // Move cards toward the table center (opposite side of avatar)
            const dx = leftPercent >= 50 ? -36 : 36;
            const dy = topPercent >= 50 ? -36 : 36;
            cardStyle = {
              position: 'absolute',
              left: `calc(${leftStr} + ${dx}px)`,
              top: `calc(${topStr} + ${dy}px)`,
              transform: 'translate(-50%, -50%)'
            };
          }

          if (isStudVariant()) {
            const { down, up } = getStudCardsForPlayer(assignment.playerId);
            const atShowdown = pokerGameState?.stage === 'showdown';
            return (
              <div className="absolute z-0 pointer-events-none" style={cardStyle} aria-label="Opponent stud cards">
                <div className="flex items-center gap-1">
                  {/* Down cards: reveal at showdown, otherwise keep face-down */}
                  {down.map((card: any, i: number) => (
                    atShowdown ? (
                      <div key={`down-${i}`} className="bg-white rounded border text-[10px] p-1 w-8 h-12 flex flex-col items-center justify-center text-black font-bold shadow">
                        <div className={highContrastCards ? suitColorClass(card.suit) : 'text-black'}>{card.rank}</div>
                        <div className={suitColorClass(card.suit)}>
                          {card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}
                        </div>
                      </div>
                    ) : (
                      <div key={`down-${i}`} className="w-8 h-12 rounded border border-blue-700 bg-gradient-to-br from-blue-500 to-blue-700 shadow-md flex items-center justify-center">
                        <div className="w-6 h-10 rounded bg-blue-600/50 border border-blue-400"></div>
                      </div>
                    )
                  ))}
                  {/* Up cards (always face up) */}
                  {up.map((card: any, i: number) => (
                    <div key={`up-${i}`} className="bg-white rounded border text-[10px] p-1 w-8 h-12 flex flex-col items-center justify-center text-black font-bold shadow">
                      <div className={highContrastCards ? suitColorClass(card.suit) : 'text-black'}>{card.rank}</div>
                      <div className={suitColorClass(card.suit)}>
                        {card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          // Hold'em/Omaha opponents: at showdown, reveal hole cards; otherwise show backs
          const showFaceUp = pokerGameState?.stage === 'showdown' && Array.isArray(gamePlayer.holeCards) && gamePlayer.holeCards.length > 0;
          if (showFaceUp) {
            const holes = gamePlayer.holeCards as any[];
            return (
              <div className="absolute z-0 pointer-events-none" style={cardStyle} aria-label="Opponent cards (revealed)">
                <div className="flex gap-1">
                  {holes.map((card: any, index: number) => (
                    <div key={index} className="bg-white dark:bg-gray-700 rounded border text-[10px] p-1 w-8 h-12 flex flex-col items-center justify-center text-black dark:text-gray-100 font-bold shadow">
                      <div className={highContrastCards ? suitColorClass(card.suit) : 'text-black'}>{card.rank}</div>
                      <div className={suitColorClass(card.suit)}>
                        {card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          return (
            <div className="absolute z-0 pointer-events-none" style={cardStyle} aria-label="Opponent cards (hidden)">
              <div className="flex gap-1">
                <div className="w-8 h-12 rounded border border-blue-700 bg-gradient-to-br from-blue-500 to-blue-700 shadow-md flex items-center justify-center">
                  <div className="w-6 h-10 rounded bg-blue-600/50 border border-blue-400"></div>
                </div>
                <div className="w-8 h-12 rounded border border-blue-700 bg-gradient-to-br from-blue-500 to-blue-700 shadow-md flex items-center justify-center -ml-3 rotate-3">
                  <div className="w-6 h-10 rounded bg-blue-600/50 border border-blue-400"></div>
                </div>
              </div>
            </div>
          );
        })()}
      </React.Fragment>
    );
  };

  // Generate seat positions dynamically based on maxPlayers
  const generateSeatPositions = (numSeats: number) => {
    const positions = [];
    for (let i = 0; i < numSeats; i++) {
      const angle = (i * 2 * Math.PI) / numSeats - Math.PI / 2; // Start from top and go clockwise
      const radiusX = 52; // Push avatars well beyond the table edge horizontally
      const radiusY = 48; // Push avatars well beyond the table edge vertically
      
      const x = 50 + radiusX * Math.cos(angle); // Center at 50% + radius
      const y = 50 + radiusY * Math.sin(angle); // Center at 50% + radius
      
      positions.push({
        seatNumber: i + 1,
        position: '',
        style: {
          position: 'absolute' as const,
          left: `${x}%`,
          top: `${y}%`,
          transform: 'translate(-50%, -50%)'
        }
      });
    }
    return positions;
  };

  // Calculate rotated seat positions
  const getRotatedSeatPositions = () => {
    // If user has no seat, use default circular positions
    if (!currentPlayerSeat) {
      return generateSeatPositions(maxPlayers);
    }

    // Perfect rotation relative to current player's seat:
    // - Anchor current seat at bottom-center (50%, 104%)
    // - Rotate all other seats evenly around the ellipse so relative spacing is preserved
    const n = Math.max(1, maxPlayers);
    const currentSeatIndex = currentPlayerSeat - 1; // 0-based index
    const radiusX = 52;
    const radiusY = 48;

    const positions: { seatNumber: number; position: string; style: React.CSSProperties }[] = [];

    for (let i = 0; i < n; i++) {
      if (i === currentSeatIndex) {
        // Pin current player to bottom-center and lower slightly outside the table
        positions.push({
          seatNumber: i + 1,
          position: '',
          style: {
            position: 'absolute' as const,
            left: '50%',
            top: '104%',
            transform: 'translate(-50%, -50%)'
          }
        });
        continue;
      }

      // Rotate indices so current seat maps to angle π/2 (bottom center)
      const rotatedIndex = (i - currentSeatIndex + n) % n; // 0..n-1
      const angle = (rotatedIndex * 2 * Math.PI) / n + Math.PI / 2; // base at bottom
      const x = 50 + radiusX * Math.cos(angle);
      const y = 50 + radiusY * Math.sin(angle);

      positions.push({
        seatNumber: i + 1,
        position: '',
        style: {
          position: 'absolute' as const,
          left: `${x}%`,
          top: `${y}%`,
          transform: 'translate(-50%, -50%)'
        }
      });
    }

    return positions;
  };
  
  // Fetch room information to get maxPlayers
  useEffect(() => {
    const fetchRoomInfo = async () => {
      if (!id) return;
      
      try {
        const response = await fetch(`/api/games/rooms/${id}`);
        if (response.ok) {
          const roomData = await response.json();
          const roomMaxPlayers = roomData.maxPlayers || 6;
          setMaxPlayers(roomMaxPlayers);
          console.log(`Room ${id} supports ${roomMaxPlayers} players`);
          
          // Re-initialize seat assignments with correct number of seats
          const seats: Record<number, { playerId: string; playerName: string; chips: number } | null> = {};
          for (let i = 1; i <= roomMaxPlayers; i++) {
            seats[i] = null;
          }
          setSeatAssignments(seats);
        } else {
          console.warn('Failed to fetch room info, using default 6 seats');
        }
      } catch (error) {
        console.error('Error fetching room info:', error);
      }
    };
    
    fetchRoomInfo();
  }, [id]);

  // Initialize player ID only once on component mount
  useEffect(() => {
    const initializePlayerId = async () => {
      try {
        // Get auth token from localStorage
        const authToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
        
        if (authToken) {
          // Try to get authenticated user ID from server
          const response = await fetch('/api/auth/me', {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            console.log('=== Game Page Auth Success ===');
            console.log('Authenticated user ID:', data.userId);
            console.log('Using authenticated ID for avatar lookup');
            console.log('=== End Auth Success ===');
            
            setPlayerId(data.userId);
            // Store for future use
            if (typeof window !== 'undefined') {
              localStorage.setItem('authenticated_user_id', data.userId);
            }
            return;
          }
        }
        
        // Fallback: generate UUID if authentication fails
        console.log('=== Game Page Auth Fallback ===');
        console.log('No auth token or authentication failed, using fallback UUID');
        
        const generateUUID = () => {
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
        };
        
        const fallbackId = typeof window !== 'undefined' && localStorage.getItem('player_id') || generateUUID();
        setPlayerId(fallbackId);
        if (typeof window !== 'undefined') localStorage.setItem('player_id', fallbackId);
        
        console.log('Fallback playerId set to:', fallbackId);
        console.log('=== End Auth Fallback ===');
        
      } catch (error) {
        console.error('Error initializing player ID:', error);
        // Use fallback UUID on error
        const generateUUID = () => {
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
        };
        
        const errorFallbackId = generateUUID();
        setPlayerId(errorFallbackId);
        console.log('Error fallback playerId set to:', errorFallbackId);
      }
    };
    
    // Initialize player ID asynchronously
    initializePlayerId();
  }, []); // Empty dependency array - only run once on mount

  useEffect(() => {
    // Debug: Clean up any corrupted localStorage data that might contain time formatting
    if (typeof window !== 'undefined') {
      // Clear old format player IDs that start with 'p_' to force UUID regeneration
      const existingPlayerId = localStorage.getItem('player_id');
      if (existingPlayerId && existingPlayerId.startsWith('p_')) {
        console.log('Clearing old format player ID:', existingPlayerId);
        localStorage.removeItem('player_id');
      }
      
      // Clear any keys that might contain corrupted time data
      const keysToCheck = Object.keys(localStorage);
      keysToCheck.forEach(key => {
        if (key.includes('session') || key.includes('timer') || key.includes('time')) {
          try {
            const value = localStorage.getItem(key);
            if (value && (value.includes('0h') || value.includes('hm'))) {
              console.log('Removing corrupted localStorage key:', key, 'value:', value);
              localStorage.removeItem(key);
            }
          } catch (e) {
            console.warn('Error checking localStorage key:', key);
          }
        }
      });
    }

    // Note: User role determination moved to separate useEffect to prevent infinite loops

    // Note: Seat assignments loading moved to separate useEffect to prevent infinite loops

    // Load game routes data only when needed
    const loadGameRoutes = async () => {
      try {
        const gameRoutesModule = await dynamicImport(
          () => import('../../src/utils/game-routes')
        );
        setGameRoutes(gameRoutesModule.gameRoutes);
      } catch (error) {
        console.error('Failed to load game routes:', error);
      }
    };
    
    loadGameRoutes();
    
    // Get the intelligent prefetcher instance
    const prefetcher = getPrefetcher();
    
    // Observe elements for viewport-based loading
    if (chatPanelRef.current) {
      prefetcher.observeComponent(chatPanelRef.current, 'ChatPanel');
    }
    
    if (settingsRef.current) {
      prefetcher.observeComponent(settingsRef.current, 'GameSettings');
    }
    
    // Mark performance for this page load
  const endMark = markInteraction('game-page-load', {
      gameId: id,
      timestamp: Date.now()
    });
    
    return () => {
      // Clean up when component unmounts
  if (typeof endMark === 'function') endMark();
      prefetcher.cleanup();
    };
  }, [id, markInteraction, playerId]);

  // Determine user role - separate useEffect to prevent infinite loops
  useEffect(() => {
    const determineRole = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        
        if (!token) {
          setUserRole('guest');
          return;
        }
        
        // Call the server-side API to check admin status
        // (environment variables like ADMIN_EMAILS are only available server-side)
        const res = await fetch('/api/auth/check-admin', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
        
        if (res.ok) {
          const data = await res.json();
          
          if (data.isAdmin) {
            setUserRole('admin');
          } else {
            setUserRole('player');
          }
        } else {
          // Fallback to player if API fails
          setUserRole('player');
        }
      } catch (error) {
        console.warn('Could not determine user role:', error);
        setUserRole('guest');
      }
    };

    determineRole();
  }, []); // Empty dependency array - only run once on mount

  // Initialize seat state on mount via HTTP
  useEffect(() => {
    if (!playerId || !id) return;

    const initSeatState = async () => {
      try {
        const resp = await fetch(`/api/games/seats/state?tableId=${id}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data?.seats) {
            setSeatAssignments(data.seats);
            setSeatStateReady(true);
            try { if (id) localStorage.setItem(`seats_${id}`, JSON.stringify(data.seats)); } catch {}
            const playerSeat = Object.entries(data.seats).find(([_, assignment]: any) => assignment?.playerId === playerId);
            if (playerSeat) {
              const [seatNumber, assignment] = playerSeat as any;
              setCurrentPlayerSeat(parseInt(seatNumber));
              persistSeatNumber(lastSeatStorageKey, parseInt(seatNumber));
              setPlayerChips(assignment?.chips || 0);
              try { if (id) localStorage.setItem(`chips_${playerId}_${id}`, String(assignment?.chips || 0)); } catch {}
            }
          }
        }
      } catch (e) {
        console.warn('Failed to fetch seat state:', e);
      }
    };

    initSeatState();
  }, [playerId, id, lastSeatStorageKey]); // Only depend on playerId, id, and storage key used for seat persistence

  // Load seat assignments - separate useEffect to prevent infinite loops
  useEffect(() => {
    if (!id || !playerId) return; // Wait for both id and playerId to be available
    
    const savedSeats = localStorage.getItem(`seats_${id}`);
    if (savedSeats) {
      try {
        const parsed = JSON.parse(savedSeats);
        
        // Clean up seat data - ensure proper structure
        const cleanSeats: Record<number, { playerId: string; playerName: string; chips: number } | null> = {};
        for (let i = 1; i <= maxPlayers; i++) {
          const seat = parsed[i];
          if (seat && typeof seat === 'object' && seat.playerId && seat.playerName) {
            // Ensure we only keep the expected properties
            cleanSeats[i] = {
              playerId: String(seat.playerId),
              playerName: String(seat.playerName),
              chips: typeof seat.chips === 'number' && !isNaN(seat.chips) ? seat.chips : 20
            };
            console.log(`Cleaned seat ${i}:`, cleanSeats[i]); // Debug log
          } else {
            cleanSeats[i] = null;
          }
        }
        
        setSeatAssignments(cleanSeats);
        
        // Check if current player has a seat and restore their chip count
        Object.entries(cleanSeats).forEach(([seatNum, assignment]) => {
          if (assignment && assignment.playerId === playerId) {
            setCurrentPlayerSeat(parseInt(seatNum));
            persistSeatNumber(lastSeatStorageKey, parseInt(seatNum));
            
            // Restore chip count from localStorage
            const savedChips = localStorage.getItem(`chips_${playerId}_${id}`);
            if (savedChips) {
              const chipCount = parseInt(savedChips, 10);
              if (!isNaN(chipCount)) {
                setPlayerChips(chipCount);
                
                // Update the assignment with current chip count
                const updatedAssignments = {
                  ...cleanSeats,
                  [seatNum]: { ...assignment, chips: chipCount }
                };
                setSeatAssignments(updatedAssignments);
              }
            }
          }
        });
      } catch (error) {
        console.warn('Error loading seat assignments:', error);
        // Clear corrupted data
        localStorage.removeItem(`seats_${id}`);
        // Reset to empty seats dynamically
        const emptySeats: Record<number, { playerId: string; playerName: string; chips: number } | null> = {};
        for (let i = 1; i <= maxPlayers; i++) {
          emptySeats[i] = null;
        }
        setSeatAssignments(emptySeats);
      }
    }
  }, [id, playerId, maxPlayers, lastSeatStorageKey]); // Include maxPlayers in dependencies

  // Sync playerId with canonical seat assignment to avoid mismatched prompts/actions
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const seatNumberFromState = currentPlayerSeat ?? null;
    const seatNumberFromStorage = readSeatNumberFromStorage(lastSeatStorageKey);
    const candidateSeatNumber = seatNumberFromState ?? seatNumberFromStorage;
    if (!candidateSeatNumber) return;
    const assignment = seatAssignments?.[candidateSeatNumber];
    if (!assignment || !assignment.playerId) return;

    const savedPlayerName = localStorage.getItem('playerName');
    if (savedPlayerName && assignment.playerName && assignment.playerName !== savedPlayerName) {
      return;
    }

    if (assignment.playerId === playerId) return;

    console.log('[identity-sync] Updating local playerId from seat assignment', {
      from: playerId,
      to: assignment.playerId,
      seat: candidateSeatNumber,
    });
    setPlayerId(assignment.playerId);
    setCurrentPlayerSeat(candidateSeatNumber);
    setPlayerChips(assignment.chips || 0);
    persistSeatNumber(lastSeatStorageKey, candidateSeatNumber);
    try {
      localStorage.setItem('player_id', assignment.playerId);
      localStorage.setItem('authenticated_user_id', assignment.playerId);
      if (tableId) {
        localStorage.setItem(`chips_${assignment.playerId}_${tableId}`, String(assignment.chips || 0));
      }
    } catch (err) {
      console.warn('Failed to persist synced player identity:', err);
    }
  }, [seatAssignments, currentPlayerSeat, playerId, lastSeatStorageKey, tableId]);

  // Toggle settings component
  const toggleSettings = () => {
    const endMark = markInteraction('toggle-settings');
    setShowSettings(prev => !prev);
    if (typeof endMark === 'function') endMark();
  };

  const handleInvite = async () => {
    if (!playerId || !id || typeof id !== 'string') {
      setInviteStatus('Missing player or room');
      return;
    }
    const target = inviteeId.trim();
    if (!target) {
      setInviteStatus('Enter friend ID');
      return;
    }
    setInviteLoading(true);
    try {
      await createInvite(playerId, target, String(id));
      setInviteStatus('Invite sent');
    } catch (err: any) {
      setInviteStatus(err?.message || 'Failed to send invite');
    } finally {
      setInviteLoading(false);
      setTimeout(() => setInviteStatus(null), 3000);
    }
  };

  const respondToRebuy = useCallback(async (decision: 'yes' | 'no') => {
    if (!playerId || !id) return;
    setRebuySubmitting(true);
    
    // Use HTTP endpoint
    try {
      const response = await fetch('/api/games/rebuy-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: id, playerId, decision }),
      });
      const data = await response.json();
      if (!response.ok) {
        console.error('Rebuy decision failed:', data);
      }
    } catch (error) {
      console.error('Rebuy decision error:', error);
    } finally {
      setRebuySubmitting(false);
    }
  }, [playerId, id]);

  useEffect(() => {
    if (!currentPlayerSeat) {
      setRebuyPrompt(null);
      setRebuySubmitting(false);
    }
  }, [currentPlayerSeat]);

  const handleLeaveGame = async () => {
    // Show confirmation dialog
    const confirmed = window.confirm('Are you sure you want to leave this game?');
    if (!confirmed) return;
    
    console.log('Attempting to leave game and navigate to dashboard');
    console.log('Current router state:', router.asPath, router.pathname);
    
    try {
      // Notify server that player is leaving via HTTP
      if (playerId && currentPlayerSeat) {
        fetch('/api/games/seats/stand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableId: id, playerId })
        }).catch(() => {});
      }
      
      // Clear any game-specific data
      if (currentPlayerSeat) {
        localStorage.removeItem(`chips_${playerId}_${id}`);
      }
      
      // Use direct navigation for reliability
      console.log('Navigating to dashboard with window.location.href');
      window.location.href = '/dashboard';
      
    } catch (error) {
      console.error('Error leaving game:', error);
      // Direct navigation fallback
      console.log('Error occurred, using direct navigation');
      window.location.href = '/dashboard';
    }
  };
  
  return (
    <div className="game-page bg-gray-100 dark:bg-gray-900 min-h-screen">
      {rebuyPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Out of chips</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              You have {rebuyPrompt.rebuyLimit === 'unlimited' ? 'unlimited' : `${rebuyPrompt.remaining} of ${rebuyPrompt.rebuyLimit}`} rebuys remaining.
              Would you like to buy back in for ${rebuyPrompt.baseChips}?
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => respondToRebuy('no')}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                disabled={rebuySubmitting}
              >
                No thanks
              </button>
              <button
                onClick={() => respondToRebuy('yes')}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                disabled={rebuySubmitting}
              >
                {rebuySubmitting ? 'Processing...' : `Rebuy $${rebuyPrompt.baseChips}`}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">Game: {id}</h1>
            {roomConfig?.numberOfRebuys !== undefined && (
              <span className="inline-flex items-center px-3 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-100">
                Rebuys: {roomConfig.numberOfRebuys === 'unlimited' ? 'Unlimited' : roomConfig.numberOfRebuys}
              </span>
            )}
            {/* Removed seated info banner at user request */}
            {/* Removed game started banner at user request */}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            {currentPlayerSeat && (
              <button
                onClick={standUp}
                className="bg-orange-600 hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-600 text-white font-medium px-4 py-2 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2 w-full sm:w-auto"
                title={`Stand up from seat ${currentPlayerSeat}`}
                aria-label="Stand up from seat"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
                <span className="whitespace-nowrap">Stand Up (P{currentPlayerSeat})</span>
              </button>
            )}
            {canStartGame() && !gameStarted && (
              <button
                onClick={handleStartGame}
                className="bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-white font-medium px-4 py-2 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2 w-full sm:w-auto"
                title={`Start the game with ${getSeatedPlayersCount()} players`}
                aria-label="Start game"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                <span className="whitespace-nowrap">Start Game ({getSeatedPlayersCount()})</span>
              </button>
            )}
            <button
              onClick={handleLeaveGame}
              className="bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white font-medium px-4 py-2 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2 w-full sm:w-auto"
              title="Leave this game and return to dashboard"
              aria-label="Leave game"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="whitespace-nowrap">Leave Game</span>
            </button>
            {/* Removed top Settings button at user request */}
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Dealer's Choice selection banner */}
          {gameStarted && awaitingDealerChoice && (
            <div className="lg:col-span-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 rounded-lg shadow-md p-4">
              {(() => {
                const dealerId = awaitingDealerChoice?.dealerId;
                const allowed = Array.isArray(awaitingDealerChoice?.allowedVariants)
                  ? awaitingDealerChoice!.allowedVariants!
                  : ['texas-holdem','omaha','omaha-hi-lo','seven-card-stud','seven-card-stud-hi-lo','five-card-stud'];
                const isMeDealer = dealerId && dealerId === playerId;
                const labelMap: Record<string, string> = {
                  'texas-holdem': "Texas Hold'em",
                  'omaha': 'Omaha',
                  'omaha-hi-lo': 'Omaha Hi-Lo',
                  'seven-card-stud': 'Seven-Card Stud',
                  'seven-card-stud-hi-lo': 'Seven-Card Stud Hi-Lo',
                  'five-card-stud': 'Five-Card Stud',
                };
                if (isMeDealer) {
                  return (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-block px-2 py-0.5 text-xs rounded bg-amber-600 text-white">Dealer&apos;s Choice</span>
                        <h3 className="text-lg font-semibold">Choose the variant for this hand</h3>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-2">
                        {allowed.map(v => (
                          <label key={v} className={`px-3 py-1.5 rounded border text-sm cursor-pointer select-none ${selectedVariantDC === v ? 'bg-amber-600 text-white border-amber-500' : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-amber-300 dark:border-amber-600'}`}> 
                            <input
                              type="radio"
                              name="dc-variant"
                              className="hidden"
                              value={v}
                              checked={selectedVariantDC === v}
                              onChange={() => {
                                userChangedVariantRef.current = true;
                                setSelectedVariantDC(v);
                              }}
                            />
                            {labelMap[v] || v}
                          </label>
                        ))}
                      </div>
                      <div className="mt-3">
                        <button
                          onClick={async () => {
                            try {
                              if (!id || !playerId) return;
                              const response = await fetch('/api/games/next-hand', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ tableId: id, playerId, variant: selectedVariantDC }),
                              });
                              if (!response.ok) {
                                console.warn('Dealer choice failed:', await response.text());
                              }
                            } catch (err) {
                              console.warn('Dealer choice failed:', err);
                            }
                          }}
                          className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded shadow"
                        >
                          Start {labelMap[selectedVariantDC] || selectedVariantDC}
                        </button>
                      </div>
                    </div>
                  );
                }
                // Non-dealer view
                return (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="inline-block px-2 py-0.5 text-xs rounded bg-amber-600 text-white">Dealer&apos;s Choice</span>
                        <h3 className="text-lg font-semibold">Waiting for dealer to choose variant…</h3>
                      </div>
                      <div className="text-sm mt-1 opacity-80">Allowed: {allowed.map(v => labelMap[v] || v).join(', ')}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {/* Poker Table - Green Felt Design */}
          <div className="lg:col-span-2 relative">
            {/* Green felt table surface */}
            <div className="relative bg-gradient-to-br from-green-700 via-green-800 to-green-900 rounded-full mx-auto shadow-2xl border-8 border-amber-800" 
                 style={{
                   width: '100%',
                   maxWidth: '800px',
                   height: '400px',
                   background: 'radial-gradient(ellipse at center, #16a34a 0%, #15803d 50%, #14532d 100%)',
                   boxShadow: 'inset 0 0 50px rgba(0,0,0,0.3), 0 10px 30px rgba(0,0,0,0.4)'
                 }}>
              
              {/* Table rail/border */}
              <div className="absolute inset-0 rounded-full border-4 border-amber-700 bg-gradient-to-r from-amber-800 via-amber-700 to-amber-800"
                   style={{
                     background: 'linear-gradient(45deg, #92400e, #b45309, #92400e)',
                     clipPath: 'polygon(0 0, 100% 0, 90% 100%, 10% 100%)',
                     transform: 'scale(1.02)'
                   }}>
              </div>
              
              {/* Inner felt playing surface */}
              <div className="absolute inset-4 rounded-full bg-gradient-to-br from-green-600 to-green-800"
                   style={{
                     background: 'radial-gradient(ellipse at center, #22c55e 10%, #16a34a 60%, #15803d 100%)',
                     boxShadow: 'inset 0 0 30px rgba(0,0,0,0.2)'
                   }}>
                
                {/* Player positions - evenly spaced around table */}
                {getRotatedSeatPositions().map((seatData) => 
                  renderSeat(seatData.seatNumber, seatData.position, seatData.style)
                )}
                
                {/* Community Cards */}
                {pokerGameState?.communityCards && pokerGameState.communityCards.length > 0 && (
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 -mt-8 flex gap-1">
                    {pokerGameState.communityCards.map((card: any, index: number) => (
                      <div key={index} className="bg-white rounded border text-xs p-1 w-8 h-12 flex flex-col items-center justify-center text-black font-bold">
                        <div className={highContrastCards ? suitColorClass(card.suit) : 'text-black'}>{card.rank}</div>
                        <div className={suitColorClass(card.suit)}>
                          {card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {supabaseSecondRunBoard && supabaseSecondRunBoard.length > 0 && (
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 mt-2 flex flex-col items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-amber-200 font-semibold drop-shadow">
                      Run 2
                    </span>
                    <div className="flex gap-1">
                      {supabaseSecondRunBoard.map((card: any, index: number) => (
                        <div key={`rit-second-${index}`} className="bg-white rounded border text-xs p-1 w-8 h-12 flex flex-col items-center justify-center text-black font-bold">
                          <div className={highContrastCards ? suitColorClass(card.suit) : 'text-black'}>{card.rank}</div>
                          <div className={suitColorClass(card.suit)}>
                            {card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pot area - positioned below the community cards */}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 mt-8 text-white text-center">
                  <div className="bg-gray-800 bg-opacity-70 px-3 py-1 rounded text-sm font-semibold">
                    Pot: ${pokerGameState?.pot || 0}
                  </div>
                </div>

                {/* Current Player's Cards */}
                {gameStarted && pokerGameState && currentPlayerSeat && (() => {
                  const me = pokerGameState.players?.find((p: any) => p.id === playerId);
                  if (!me) return null;
                  const isFolded = !!(me?.folded || me?.isFolded);

                  if (isStudVariant()) {
                    const { down, up } = getStudCardsForPlayer(playerId);
                    // Show ALL of my cards face-up (no face-down backs for the current player)
                    const all = [...down, ...up];
                    return (
                      <div className={`absolute ${getCurrentPlayerCardsPosition()} flex gap-1 z-20 ${isFolded ? 'opacity-60 grayscale' : ''}`}>
                        {all.map((card: any, i: number) => (
                          <div key={`me-card-${i}`} className="bg-white rounded border text-xs p-1 w-10 h-14 flex flex-col items-center justify-center text-black font-bold shadow-lg">
                            <div className={highContrastCards ? suitColorClass(card.suit) : 'text-black'}>{card.rank}</div>
                            <div className={suitColorClass(card.suit)}>
                              {card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  }

                  // Hold'em/Omaha: show hole cards
                  const holes = getCurrentPlayerCards();
                  if (!holes || holes.length === 0) return null;
                  return (
                    <div className={`absolute ${getCurrentPlayerCardsPosition()} flex gap-1 z-20 ${isFolded ? 'opacity-60 grayscale' : ''}`}>
                      {holes.map((card: any, index: number) => (
                        <div key={index} className="bg-white rounded border text-xs p-1 w-8 h-12 flex flex-col items-center justify-center text-black font-bold shadow-lg">
                          <div className={highContrastCards ? suitColorClass(card.suit) : 'text-black'}>{card.rank}</div>
                          <div className={suitColorClass(card.suit)}>
                            {card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                
              </div>
            </div>
          </div>

          {/* Poker Action Panel (only before showdown); hide if only one non-folded remains */}
          {gameStarted && pokerGameState && pokerGameState.stage !== 'showdown' && getActiveNonFoldedPlayers().length > 1 && pokerGameState.activePlayer === playerId && !runItTwicePrompt && (
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mt-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Your Turn</h3>
              {(() => {
                const summary = getMyHandSummary();
                const isHiLo = pokerGameState?.variant === 'omaha-hi-lo' || pokerGameState?.variant === 'seven-card-stud-hi-lo';
                if (isHiLo) {
                  const highDisplay = summary.highLabel || summary.primary || 'Waiting for more cards';
                  const lowDisplay = summary.lowLabel || 'No qualifying low yet';
                  return (
                    <div className="mb-3 text-sm text-gray-700 dark:text-gray-200">
                      <div className="font-semibold text-gray-900 dark:text-gray-100">Your Hand</div>
                      <div className="mt-1 space-y-1">
                        <div>High Hand: <span className="font-semibold text-gray-900 dark:text-gray-100">{highDisplay}</span></div>
                        <div>Low Hand: <span className="font-semibold text-gray-900 dark:text-gray-100">{lowDisplay}</span></div>
                      </div>
                    </div>
                  );
                }
                return summary.primary ? (
                  <div className="mb-3 text-sm text-gray-700 dark:text-gray-200">Your Hand: <span className="font-semibold text-gray-900 dark:text-gray-100">{summary.primary}</span></div>
                ) : null;
              })()}
              {/* Pot Odds Display */}
              {renderPotOdds()}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleFold}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
                >
                  Fold
                </button>
                
                {(pokerGameState.currentBet || 0) === 0 ? (
                  <button
                    onClick={handleCheck}
                    className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded transition-colors"
                  >
                    Check
                  </button>
                ) : (
                  <button
                    onClick={handleCall}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded transition-colors"
                  >
                    Call ${pokerGameState.currentBet}
                  </button>
                )}
                
                {/* No-Limit betting controls */}
                {((pokerGameState?.bettingMode || 'no-limit') === 'no-limit') && (
                  (pokerGameState.currentBet || 0) === 0 ? (
                    <div className="flex flex-col gap-2 bg-gray-50 dark:bg-gray-900/30 p-3 rounded-md w-full">
                      <div className="text-sm text-gray-700 dark:text-gray-300 font-medium">Bet amount</div>
                      {(() => {
                        const { min, max } = getBetBounds();
                        const bb = Number(pokerGameState.bigBlind || 0) || 0;
                        const pot = Number(pokerGameState.pot || 0) || 0;
                        return (
                          <>
                            <input
                              type="range"
                              min={min}
                              max={Math.max(min, max)}
                              step={0.01}
                              value={clamp(betInput, min, max)}
                              onChange={e => setBetInput(clamp(parseFloat(e.target.value || '0'), min, max))}
                            />
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={min}
                                max={max}
                                step={0.01}
                                value={Number(clamp(betInput, min, max)).toFixed(2)}
                                onChange={e => setBetInput(clamp(parseFloat(e.target.value || '0'), min, max))}
                                className="w-28 border rounded px-2 py-1 bg-white dark:bg-gray-800"
                              />
                              <div className="flex flex-wrap gap-2">
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setBetInput(min)}>Min</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setBetInput(clamp(betInput + bb, min, max))}>+BB</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setBetInput(clamp(pot / 2, min, max))}>1/2 Pot</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setBetInput(clamp(pot, min, max))}>Pot</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setBetInput(max)}>All-in</button>
                              </div>
                              {(() => {
                                const me = getMe();
                                const prev = Number(me?.currentBet || 0);
                                const stack = Number(me?.stack || 0);
                                const sel = clamp(betInput, min, max);
                                const isAllIn = Math.abs(sel - max) < 0.005;
                                const add = Math.max(0, sel - prev);
                                const onClick = () => handleBet(Number(sel.toFixed(2)));
                                const label = isAllIn ? `All-in $${stack.toFixed(2)}` : `Bet $${add.toFixed(2)}`;
                                return (
                                  <button onClick={onClick} className="ml-auto bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors">
                                    {label}
                                  </button>
                                );
                              })()}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 bg-gray-50 dark:bg-gray-900/30 p-3 rounded-md w-full">
                      <div className="text-sm text-gray-700 dark:text-gray-300 font-medium">Raise to</div>
                      {(() => {
                        const { min, max } = getRaiseBounds();
                        const bb = Number(pokerGameState.bigBlind || 0) || 0;
                        const pot = Number(pokerGameState.pot || 0) || 0;
                        const curr = Number(pokerGameState.currentBet || 0) || 0;
                        return (
                          <>
                            <input
                              type="range"
                              min={min}
                              max={Math.max(min, max)}
                              step={0.01}
                              value={clamp(raiseInput, min, max)}
                              onChange={e => setRaiseInput(clamp(parseFloat(e.target.value || '0'), min, max))}
                            />
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={min}
                                max={max}
                                step={0.01}
                                value={Number(clamp(raiseInput, min, max)).toFixed(2)}
                                onChange={e => setRaiseInput(clamp(parseFloat(e.target.value || '0'), min, max))}
                                className="w-28 border rounded px-2 py-1 bg-white dark:bg-gray-800"
                              />
                              <div className="flex flex-wrap gap-2">
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setRaiseInput(clamp((curr + (pokerGameState.minRaise || bb)), min, max))}>+MinRaise</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setRaiseInput(clamp(curr + (bb * 2), min, max))}>+2BB</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setRaiseInput(clamp(curr + (bb * 3), min, max))}>+3BB</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setRaiseInput(clamp(pot, min, max))}>Pot</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setRaiseInput(max)}>All-in</button>
                              </div>
                              {(() => {
                                const me = getMe();
                                const prev = Number(me?.currentBet || 0);
                                const stack = Number(me?.stack || 0);
                                const sel = clamp(raiseInput, min, max);
                                const isAllIn = Math.abs(sel - max) < 0.005;
                                const add = Math.max(0, sel - prev);
                                const onClick = () => handleRaise(Number(sel.toFixed(2)));
                                const label = isAllIn ? `All-in $${stack.toFixed(2)}` : `Raise to $${sel.toFixed(2)} (+$${add.toFixed(2)})`;
                                return (
                                  <button onClick={onClick} className="ml-auto bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded transition-colors">
                                    {label}
                                  </button>
                                );
                              })()}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )
                )}

                {/* Pot-Limit betting controls */}
                {((pokerGameState?.bettingMode || 'no-limit') === 'pot-limit') && (
                  (pokerGameState.currentBet || 0) === 0 ? (
                    <div className="flex flex-col gap-2 bg-gray-50 dark:bg-gray-900/30 p-3 rounded-md w-full">
                      <div className="text-sm text-gray-700 dark:text-gray-300 font-medium">Bet amount (Pot-Limit)</div>
                      {(() => {
                        const { min, max } = getPotLimitBetBounds();
                        const bb = Number(pokerGameState.bigBlind || 0) || 0;
                        const pot = Number(pokerGameState.pot || 0) || 0;
                        return (
                          <>
                            <input
                              type="range"
                              min={min}
                              max={Math.max(min, max)}
                              step={0.01}
                              value={clamp(betInput, min, max)}
                              onChange={e => setBetInput(clamp(parseFloat(e.target.value || '0'), min, max))}
                            />
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={min}
                                max={max}
                                step={0.01}
                                value={Number(clamp(betInput, min, max)).toFixed(2)}
                                onChange={e => setBetInput(clamp(parseFloat(e.target.value || '0'), min, max))}
                                className="w-28 border rounded px-2 py-1 bg-white dark:bg-gray-800"
                              />
                              <div className="flex flex-wrap gap-2">
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setBetInput(min)}>Min</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setBetInput(clamp(betInput + bb, min, max))}>+BB</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setBetInput(clamp(pot / 2, min, max))}>1/2 Pot</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setBetInput(max)}>Pot</button>
                              </div>
                              {(() => {
                                const me = getMe();
                                const prev = Number(me?.currentBet || 0);
                                const sel = clamp(betInput, min, max);
                                const add = Math.max(0, sel - prev);
                                const onClick = () => handleBet(Number(sel.toFixed(2)));
                                const label = `Bet $${add.toFixed(2)}`;
                                return (
                                  <button onClick={onClick} className="ml-auto bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors">
                                    {label}
                                  </button>
                                );
                              })()}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 bg-gray-50 dark:bg-gray-900/30 p-3 rounded-md w-full">
                      <div className="text-sm text-gray-700 dark:text-gray-300 font-medium">Raise to (Pot-Limit)</div>
                      {(() => {
                        const { min, max } = getPotLimitRaiseBounds();
                        const bb = Number(pokerGameState.bigBlind || 0) || 0;
                        const pot = Number(pokerGameState.pot || 0) || 0;
                        const curr = Number(pokerGameState.currentBet || 0) || 0;
                        return (
                          <>
                            <input
                              type="range"
                              min={min}
                              max={Math.max(min, max)}
                              step={0.01}
                              value={clamp(raiseInput, min, max)}
                              onChange={e => setRaiseInput(clamp(parseFloat(e.target.value || '0'), min, max))}
                            />
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={min}
                                max={max}
                                step={0.01}
                                value={Number(clamp(raiseInput, min, max)).toFixed(2)}
                                onChange={e => setRaiseInput(clamp(parseFloat(e.target.value || '0'), min, max))}
                                className="w-28 border rounded px-2 py-1 bg-white dark:bg-gray-800"
                              />
                              <div className="flex flex-wrap gap-2">
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setRaiseInput(clamp((curr + (pokerGameState.minRaise || bb)), min, max))}>+MinRaise</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setRaiseInput(clamp(curr + (bb * 2), min, max))}>+2BB</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setRaiseInput(clamp(curr + (bb * 3), min, max))}>+3BB</button>
                                <button className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded" onClick={() => setRaiseInput(max)}>Pot</button>
                              </div>
                              {(() => {
                                const me = getMe();
                                const prev = Number(me?.currentBet || 0);
                                const sel = clamp(raiseInput, min, max);
                                const add = Math.max(0, sel - prev);
                                const onClick = () => handleRaise(Number(sel.toFixed(2)));
                                const label = `Raise to $${sel.toFixed(2)} (+$${add.toFixed(2)})`;
                                return (
                                  <button onClick={onClick} className="ml-auto bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded transition-colors">
                                    {label}
                                  </button>
                                );
                              })()}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )
                )}

              </div>
              
              <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                <p>Current Bet: ${pokerGameState.currentBet || 0} | Pot: ${pokerGameState.pot || 0}</p>
                <p>Your Stack: ${pokerGameState.players.find((p: any) => p.id === playerId)?.stack || 0}</p>
              </div>
            </div>
          )}

          {/* Run It Twice decision panel for the selected player */}
          {gameStarted && pokerGameState && runItTwicePrompt && isRunItTwicePromptOwner && !pokerGameState.runItTwice?.enabled && (
            <div className="lg:col-span-2 bg-purple-50 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-600 rounded-lg shadow-md p-4 mt-4" aria-live="polite">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-block px-2 py-0.5 text-xs rounded bg-purple-600 text-white">RIT</span>
                  <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-100">Run It Twice Decision</h3>
                </div>
                <span className="text-xs uppercase tracking-wide text-purple-700 dark:text-purple-300">Hand paused</span>
              </div>
              <div className="mt-3 text-sm text-purple-900 dark:text-purple-100 space-y-2">
                <p>You currently have the lowest revealed hand and must choose how the board finishes.</p>
                {runItTwiceHighestHandDescription && (
                  <p className="text-[13px] text-purple-800 dark:text-purple-200">
                    Current best: <span className="font-semibold">{runItTwiceHighestHandDescription}</span>
                  </p>
                )}
                {!!runItTwicePromptTieNames.length && (
                  <p className="text-[13px] text-purple-800 dark:text-purple-200">
                    Lowest hand tie with {runItTwicePromptTieNames.join(', ')}. You were randomly selected to decide.
                  </p>
                )}
                <p className="text-[12px] text-purple-700 dark:text-purple-200">Choose a number of runs to resume the hand.</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => enableRunItTwice(1)}
                  className="px-3 py-1.5 rounded text-xs font-semibold bg-gray-200 hover:bg-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
                >Keep single run</button>
                {(() => {
                  const activeCount = getActiveNonFoldedPlayers().length;
                  const maxRuns = Math.max(2, Math.max(1, activeCount));
                  return Array.from({ length: Math.max(0, maxRuns - 1) }, (_, i) => i + 2).map(r => (
                    <button
                      key={`rit-${r}`}
                      onClick={() => enableRunItTwice(r)}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white shadow focus:outline-none focus:ring-2 focus:ring-purple-400"
                    >Run {r === 2 ? 'Twice' : `${r}x`}</button>
                  ));
                })()}
              </div>
            </div>
          )}

          {/* Run It Twice waiting banner for other players */}
          {gameStarted && pokerGameState && runItTwicePrompt && !isRunItTwicePromptOwner && !pokerGameState.runItTwice?.enabled && (
            <div className="lg:col-span-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-300 dark:border-purple-700 rounded-lg shadow-md p-4 mt-4" aria-live="polite">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-100 flex items-center gap-2">
                  <span className="inline-block px-2 py-0.5 text-xs rounded bg-purple-600 text-white">RIT</span>
                  Waiting on Run It Twice decision
                </h3>
                <span className="text-xs uppercase tracking-wide text-purple-700 dark:text-purple-300">Hand paused</span>
              </div>
              <div className="text-sm text-purple-900 dark:text-purple-100 space-y-2">
                <p>
                  Action is paused while
                  {' '}
                  <span className="font-semibold">{runItTwicePromptOwnerName || 'another player'}</span>
                  {' '}
                  chooses how many boards to run after the all-in showdown.
                </p>
                {runItTwiceHighestHandDescription && (
                  <p className="text-[13px] text-purple-800 dark:text-purple-200">
                    Current best hand: <span className="font-semibold">{runItTwiceHighestHandDescription}</span>
                  </p>
                )}
                {!!runItTwicePromptTieNames.length && (
                  <p className="text-[13px] text-purple-800 dark:text-purple-200">
                    Tie detected between {runItTwicePromptTieNames.join(', ')}; a random picker selected
                    {' '}
                    {runItTwicePromptOwnerName || 'that player'}
                    {' '}to decide.
                  </p>
                )}
                <p className="text-[12px] text-purple-700 dark:text-purple-300">
                  You don’t need to act—once the decision is made, the remaining boards will be dealt automatically.
                </p>
              </div>
            </div>
          )}

          {/* Game Status Display (only before showdown); hide if only one non-folded remains; hide during Run-It-Twice prompt */}
          {gameStarted && pokerGameState && pokerGameState.stage !== 'showdown' && getActiveNonFoldedPlayers().length > 1 && pokerGameState.activePlayer !== playerId && !runItTwicePrompt && (
            <div className="lg:col-span-2 bg-gray-100 dark:bg-gray-700 rounded-lg shadow-md p-4 mt-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Game Status</h3>
                <div className="flex items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200" title="If checked, you will fold immediately when it becomes your turn">
                    <input
                      type="checkbox"
                      checked={autoFold}
                      onChange={(e) => setAutoFold(e.target.checked)}
                      className="h-4 w-4 accent-red-600"
                      aria-label="Enable auto fold"
                    />
                    <span>Auto Fold</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200" title="If checked, you will check immediately when it becomes your turn and no bet is required">
                    <input
                      type="checkbox"
                      checked={autoCheck}
                      onChange={(e) => setAutoCheck(e.target.checked)}
                      className="h-4 w-4 accent-blue-600"
                      aria-label="Enable auto check"
                    />
                    <span>Auto Check</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200" title="If checked, you will call immediately when it becomes your turn">
                    <input
                      type="checkbox"
                      checked={autoCall}
                      onChange={(e) => setAutoCall(e.target.checked)}
                      className="h-4 w-4 accent-green-600"
                      aria-label="Enable auto call"
                    />
                    <span>Auto Call</span>
                  </label>
                </div>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                <p>Waiting for {pokerGameState.players.find((p: any) => p.id === pokerGameState.activePlayer)?.name || 'player'} to act...</p>
                <p>Current Bet: ${pokerGameState.currentBet || 0} | Pot: ${pokerGameState.pot || 0}</p>
                {(() => {
                  const summary = getMyHandSummary();
                  const isHiLo = pokerGameState?.variant === 'omaha-hi-lo' || pokerGameState?.variant === 'seven-card-stud-hi-lo';
                  if (isHiLo) {
                    const highDisplay = summary.highLabel || summary.primary || 'Waiting for more cards';
                    const lowDisplay = summary.lowLabel || 'No qualifying low yet';
                    return (
                      <div className="mt-2 text-sm space-y-0.5">
                        <div>High Hand: <span className="font-semibold text-gray-900 dark:text-gray-100">{highDisplay}</span></div>
                        <div>Low Hand: <span className="font-semibold text-gray-900 dark:text-gray-100">{lowDisplay}</span></div>
                      </div>
                    );
                  }
                  return summary.primary ? (
                    <p className="mt-1">Your Hand: <span className="font-semibold text-gray-900 dark:text-gray-100">{summary.primary}</span></p>
                  ) : null;
                })()}
              </div>
            </div>
          )}

          {/* Showdown result banner or single-remaining defensive winner */}
          {gameStarted && pokerGameState && pokerGameState.stage === 'showdown' && pokerGameState.runItTwice?.enabled && pokerGameState.runItTwice.results?.length > 0 && (
            <div className="lg:col-span-2 bg-purple-50 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 text-purple-900 dark:text-purple-100 rounded-lg shadow-md p-4 mt-4">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <span className="inline-block px-2 py-0.5 text-xs rounded bg-purple-600 text-white">RIT</span>
                Run It Twice Results ({pokerGameState.runItTwice.numberOfRuns} Runs)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pokerGameState.runItTwice.results.map((res: any, idx: number) => (
                  <div key={res.boardId || idx} className="rounded-md border border-purple-300 dark:border-purple-600 bg-white dark:bg-gray-800 p-3 shadow-sm">
                    <div className="text-sm font-semibold mb-2">Board {idx + 1}</div>
                    {(() => {
                      const board = pokerGameState.runItTwice.boards?.[idx] || [];
                      return (
                        <div className="flex gap-1 mb-3">
                          {board.map((card: any, ci: number) => (
                            <div key={ci} className="bg-white dark:bg-gray-700 rounded border text-[10px] p-1 w-7 h-10 flex flex-col items-center justify-center text-black dark:text-gray-100 font-bold">
                              <div className={highContrastCards ? suitColorClass(card.suit) : 'text-black'}>{card.rank}</div>
                              <div className={suitColorClass(card.suit)}>
                                {card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    <div className="space-y-1">
                      {res.winners.map((w: any) => {
                        const player = pokerGameState.players.find((p: any) => p.id === w.playerId);
                        return (
                          <div key={w.playerId} className="text-xs flex items-center justify-between bg-purple-100 dark:bg-purple-800/40 px-2 py-1 rounded">
                            <span className="font-medium">{player?.name || w.playerId.slice(0,6)}</span>
                            <span className="text-purple-700 dark:text-purple-300 font-semibold">+${w.potShare}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-sm font-medium">Total Distribution:</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {pokerGameState.runItTwice.potDistribution.map((pd: any) => {
                  const player = pokerGameState.players.find((p: any) => p.id === pd.playerId);
                  return (
                    <div key={pd.playerId} className="text-xs px-2 py-1 rounded bg-purple-200 dark:bg-purple-800/60 text-purple-900 dark:text-purple-100 font-semibold">
                      {player?.name || pd.playerId.slice(0,6)}: ${pd.amount}
                    </div>
                  );
                })}
              </div>
              {pokerGameState.runItTwice.rngSecurity && (
                <div className="mt-4 text-[11px] text-purple-700 dark:text-purple-300">
                  RNG seeds secured (VRF). Verification available via API.
                </div>
              )}
            </div>
          )}

          {/* Hi-Lo showdown panel (non-RIT): show high and low winners from lastHiLoResult */}
          {gameStarted && pokerGameState && (pokerGameState.stage === 'showdown' || getActiveNonFoldedPlayers().length === 1)
            && !pokerGameState.runItTwice?.enabled
            && ((pokerGameState.variant === 'omaha-hi-lo' || pokerGameState.variant === 'seven-card-stud-hi-lo') && pokerGameState.lastHiLoResult) && (
            <div className="lg:col-span-2 bg-cyan-50 dark:bg-cyan-900/30 border border-cyan-300 dark:border-cyan-700 text-cyan-900 dark:text-cyan-100 rounded-lg shadow-md p-4 mt-4">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <span className="inline-block px-2 py-0.5 text-xs rounded bg-cyan-600 text-white">Hi-Lo</span>
                Showdown Results
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* High winners */}
                <div className="rounded-md border border-cyan-300 dark:border-cyan-700 bg-white dark:bg-gray-800 p-3 shadow-sm">
                  <div className="text-sm font-semibold mb-2">High Winners</div>
                  <div className="space-y-1">
                    {pokerGameState.lastHiLoResult!.high.map((h: any) => {
                      const player = pokerGameState.players.find((p: any) => p.id === h.playerId);
                      return (
                        <div key={h.playerId} className="text-xs flex items-center justify-between bg-cyan-100 dark:bg-cyan-800/40 px-2 py-1 rounded">
                          <span className="font-medium">{player?.name || h.playerId.slice(0,6)}</span>
                          <span className="text-cyan-700 dark:text-cyan-300 font-semibold">+${h.amount}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* Low winners (if any) */}
                <div className="rounded-md border border-cyan-300 dark:border-cyan-700 bg-white dark:bg-gray-800 p-3 shadow-sm">
                  <div className="text-sm font-semibold mb-2">Low Winners</div>
                  {Array.isArray(pokerGameState.lastHiLoResult!.low) && pokerGameState.lastHiLoResult!.low.length > 0 ? (
                    <div className="space-y-1">
                      {pokerGameState.lastHiLoResult!.low!.map((l: any) => {
                        const player = pokerGameState.players.find((p: any) => p.id === l.playerId);
                        return (
                          <div key={l.playerId} className="text-xs flex items-center justify-between bg-cyan-100 dark:bg-cyan-800/40 px-2 py-1 rounded">
                            <span className="font-medium">{player?.name || l.playerId.slice(0,6)}</span>
                            <span className="text-cyan-700 dark:text-cyan-300 font-semibold">+${l.amount}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-cyan-800 dark:text-cyan-200 opacity-80">No qualifying low hand</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Showdown banner when not RIT: compute true winners instead of assuming the first remaining */}
          {gameStarted && pokerGameState && (pokerGameState.stage === 'showdown' || getActiveNonFoldedPlayers().length === 1)
            && !pokerGameState.runItTwice?.enabled
            && !(((pokerGameState.variant === 'omaha-hi-lo' || pokerGameState.variant === 'seven-card-stud-hi-lo')) && pokerGameState.lastHiLoResult) && (
            <div className="lg:col-span-2 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100 rounded-lg shadow-md p-4 mt-4">
              {(() => {
                const remaining = getActiveNonFoldedPlayers();
                // Win-by-fold: only one active player remains
                if (remaining.length === 1) {
                  const only = remaining[0];
                  return (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{only?.name || 'Winner'}</span>
                      <span>wins the pot</span>
                    </div>
                  );
                }

                // Standard showdown with 2+ active players: evaluate winners client-side for display only
                try {
                  const variant = pokerGameState?.variant as string | undefined;
                  const board = Array.isArray(pokerGameState?.communityCards) ? pokerGameState.communityCards : [];

                  type EvalRes = { playerId: string; name: string; hand: any; label: string };
                  const evals: EvalRes[] = remaining.map((p: any) => {
                    if (variant === 'seven-card-stud' || variant === 'seven-card-stud-hi-lo' || variant === 'five-card-stud') {
                      const st = (pokerGameState as any)?.studState?.playerCards?.[p.id];
                      const down = Array.isArray(st?.downCards) ? st.downCards : [];
                      const up = Array.isArray(st?.upCards) ? st.upCards : [];
                      const { hand } = HandEvaluator.evaluateHand([...down, ...up], []);
                      return { playerId: p.id, name: p.name || p.id, hand, label: String((hand as any)?.description || '') };
                    }
                    if (variant === 'omaha' || variant === 'omaha-hi-lo') {
                      const { hand } = HandEvaluator.evaluateOmahaHand(Array.isArray(p?.holeCards) ? p.holeCards : [], board);
                      return { playerId: p.id, name: p.name || p.id, hand, label: String((hand as any)?.description || '') };
                    }
                    const { hand } = HandEvaluator.evaluateHand(Array.isArray(p?.holeCards) ? p.holeCards : [], board);
                    return { playerId: p.id, name: p.name || p.id, hand, label: String((hand as any)?.description || '') };
                  });

                  // Find best via pairwise comparison
                  let best: EvalRes[] = [];
                  for (const e of evals) {
                    if (best.length === 0) { best = [e]; continue; }
                    const cmp = HandEvaluator.compareHands(e.hand, best[0].hand);
                    if (cmp > 0) best = [e];
                    else if (cmp === 0) best.push(e);
                  }

                  const names = best.map(b => b.name);
                  // Prefer showing a single common label if all share the same hand description
                  const sameLabel = best.every(b => b.label === best[0].label) ? best[0].label : '';
                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{names.join(', ')}</span>
                      <span>{best.length > 1 ? 'split the pot' : 'wins the pot'}</span>
                      {sameLabel ? (
                        <span className="opacity-80">({sameLabel})</span>
                      ) : null}
                    </div>
                  );
                } catch (e) {
                  // Defensive fallback: avoid showing the same player incorrectly; show generic completion
                  return (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Showdown complete</span>
                      <span>chips updated</span>
                    </div>
                  );
                }
              })()}
            </div>
          )}

          {/* Outs Display: Show outs and odds when there's an all-in scenario before showdown */}
          {gameStarted && pokerGameState && anyAllIn() && pokerGameState.stage !== 'showdown' && (() => {
            try {
              const activePlayers = getActiveNonFoldedPlayers();
              // Only show outs when we have 2 or more active players, at least one all-in, and community cards
              // Don't show outs at the river (5 cards) since the hand is over
              if (activePlayers.length < 2 || !Array.isArray(pokerGameState.communityCards) || pokerGameState.communityCards.length === 0 || pokerGameState.communityCards.length >= 5) {
                return null;
              }

              // Find the best and worst hands among active players
              const variant = pokerGameState?.variant;
              const board = pokerGameState.communityCards;
              
              // Early return: Don't show outs for stud variants, as outs calculation is not supported
              if (variant === 'seven-card-stud' || variant === 'seven-card-stud-hi-lo' || variant === 'five-card-stud') {
                return null;
              }
              
              type PlayerEval = { playerId: string; name: string; hand: HandInterface; holeCards: Card[] };
              const evals: PlayerEval[] = activePlayers.map((p: Player) => {
                let hand;
                if (variant === 'omaha' || variant === 'omaha-hi-lo') {
                  hand = HandEvaluator.evaluateOmahaHand(Array.isArray(p?.holeCards) ? p.holeCards : [], board);
                } else {
                  hand = HandEvaluator.evaluateHand(Array.isArray(p?.holeCards) ? p.holeCards : [], board);
                }
                return { playerId: p.id, name: p.name || p.id, hand: hand.hand, holeCards: p.holeCards || [] };
              });

              // Sort by hand strength (best first)
              evals.sort((a, b) => HandEvaluator.compareHands(b.hand, a.hand));
              
              // Get best and worst (for outs calculation, compare worst vs best)
              // Note: In multi-way pots, outs are calculated against the current best hand only.
              // An out might beat the best hand but still lose to a middle hand's potential improvement.
              if (evals.length >= 2) {
                const best = evals[0];
                const worst = evals[evals.length - 1];
                
                // Only calculate outs if there's actually a difference (worst is losing)
                const comparison = HandEvaluator.compareHands(worst.hand, best.hand);
                if (comparison < 0) {
                  const outsResult = OutsCalculator.calculateOuts(
                    worst.holeCards,
                    best.holeCards,
                    board,
                    variant as GameVariant | undefined
                  );

                  if (outsResult.outs.length > 0) {
                    return (
                      <div className="lg:col-span-2">
                        <OutsDisplay
                          outs={outsResult.outs}
                          oddsNextCard={outsResult.oddsNextCard}
                          oddsByRiver={outsResult.oddsByRiver}
                          outsByCategory={outsResult.outsByCategory}
                          losingPlayerName={worst.name}
                          winningPlayerName={best.name}
                        />
                      </div>
                    );
                  }
                }
              }

              return null;
            } catch (err) {
              // Silent fail - outs display is supplementary
              console.error('Error calculating outs:', err);
              return null;
            }
          })()}

          {/* Combined Timer and Statistics */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
            {id && playerId && (
              <CombinedTimerStats 
                tableId={String(id)} 
                playerId={playerId} 
                gameId={String(id)}
                onShowSettings={toggleSettings}
                gameState={pokerGameState}
              />
            )}
            {showSettings && (
              <div className="mt-4">
                <GameSettings gameId={String(id)} onSettingsChange={(s: GameSettingsType) => {
                  setHighContrastCards(!!s?.highContrastCards);
                  setShowPotOdds(s?.showPotOdds ?? true);
                }} />
              </div>
            )}
          </div>
          
          {/* Less critical component in viewport */}
          <div ref={chatPanelRef} className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mt-6">
            <ChatPanel gameId={String(id)} playerId={playerId} isAdmin={userRole === 'admin'} />
          </div>

          {/* Settings panel moved next to stats above; bottom button removed */}
        </div>
      </div>
    </div>
  );
}

// Use getServerSideProps to demonstrate server-side data loading optimization
export async function getServerSideProps(context: { params: { id: string } }) {
  const { id } = context.params;
  
  // In a real implementation, you would fetch game data from your API
  // and pass it as props to reduce client-side data fetching
  
  return {
    props: {
      gameData: {
        id,
        initialLoadTime: new Date().toISOString(),
      }
    }
  };
}
