import { useRouter } from 'next/router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { getPrefetcher, dynamicImport } from '../../src/utils/code-splitting';
import { useComponentPerformance } from '../../src/utils/performance-monitor';
import { createInvite } from '../../src/services/friends-ui';
import { useUserAvatar } from '../../src/hooks/useUserAvatar';
import Avatar from '../../src/components/Avatar';
import { PotLimitCalculator } from '../../src/lib/poker/pot-limit';
import { HandEvaluator } from '../../src/lib/poker/hand-evaluator';
import { OutsCalculator } from '../../src/lib/poker/outs-calculator';
import { describeImprovement, improvementOnLastCard, lastCardDrawFor } from '../../src/lib/poker/improvement-odds';
import { runItVoters, tallyRunItVotes } from '../../src/lib/shared/run-it-vote';
import OutsDisplay from '../../src/components/OutsDisplay';
import { useSupabaseRealtime } from '../../src/hooks/useSupabaseRealtime';
import { useCheckTurn } from '../../src/hooks/useCheckTurn';
import { Card, Player, GameVariant } from '../../src/types/poker';
import { HandInterface } from '../../src/types/poker-engine';
import { formatPotOdds } from '../../src/lib/poker/pot-odds';
import { useDisplaySettings } from '../../src/hooks/useDisplaySettings';
import { formatChips, formatDollars } from '../../src/utils/chip-display';
import { RUN_IT_TWICE_DECISIONS_ENABLED } from '../../src/lib/shared/feature-flags';
import { api, unwrap } from '../../src/utils/api-client';
import { resolveSessionUserId } from '../../src/utils/session-identity';
import { useTurnClock } from '../../src/hooks/useTurnClock';
import { handDelayMs } from '../../src/lib/shared/turn-clock';
import { useRevealWhen } from '../../src/hooks/useRevealWhen';
import { useTurnAlerts } from '../../src/hooks/useTurnAlerts';
import TurnClockBar from '../../src/components/TurnClockBar';
import PreActionBar from '../../src/components/PreActionBar';
import { resolvePreAction } from '../../src/lib/shared/pre-action';
import type { PreAction } from '../../src/lib/shared/pre-action';
import { useTableExtras } from '../../src/hooks/useTableExtras';
import { usePolling } from '../../src/hooks/usePolling';
import TimeBankBadge from '../../src/components/TimeBankBadge';
import SessionLedgerPanel from '../../src/components/SessionLedgerPanel';
import SidePanelTabs from '../../src/components/SidePanelTabs';
import HandActionLog from '../../src/components/HandActionLog';
import EquityPanel from '../../src/components/EquityPanel';
import SplashAnimation, { splashInPlay } from '../../src/components/SplashAnimation';
import FixedLimitControls from '../../src/components/FixedLimitControls';
import GameRulesBadges, { SevenDeuceBountyBanner } from '../../src/components/GameRulesBadges';
import { ALL_VARIANTS, VARIANT_LABELS, gameLabel, isOmahaVariant, isStudVariant as isStudGame } from '../../src/lib/poker/variant-rules';
import { studCardOrder } from '../../src/lib/shared/stud-cards';
import TableCard from '../../src/components/TableCard';
import PlayerNotesPanel, { fetchNotes, type NotesMap } from '../../src/components/PlayerNotesPanel';
import HostControlsPanel from '../../src/components/HostControlsPanel';
import PrivateTableNotice from '../../src/components/PrivateTableNotice';
import WaitlistPanel from '../../src/components/WaitlistPanel';
import { NOTE_COLOR_CLASSES, type NoteColor } from '../../src/lib/shared/note-colors';
import BetPresetButtons from '../../src/components/BetPresetButtons';
import BetSlider from '../../src/components/BetSlider';
import { betSliderStep } from '../../src/lib/shared/bet-sizing';
import ShortcutHelpOverlay from '../../src/components/ShortcutHelpOverlay';
import { useTableShortcuts } from '../../src/hooks/useTableShortcuts';
import TableAnnouncer from '../../src/components/TableAnnouncer';
import ReactionPicker from '../../src/components/ReactionPicker';
import SeatReactionBubbles from '../../src/components/SeatReactionBubbles';
import { useTableReactions } from '../../src/hooks/useTableReactions';
import TableChipAnimations from '../../src/components/TableChipAnimations';
import MobileCollapsible from '../../src/components/MobileCollapsible';
import { useMediaQuery, NARROW_SCREEN_QUERY } from '../../src/hooks/useMediaQuery';
import { isCentreSeat, seatPlateStyle } from '../../src/lib/shared/seat-layout';
import { tablePlayerName } from '../../src/utils/table-player-name';
import { suitColorClass as suitTextClass } from '../../src/lib/shared/display-settings';
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
  // A private table the viewer isn't allowed into: the page shows how to get in instead
  const [privateTableBlocked, setPrivateTableBlocked] = useState(false);
  
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
      const { ok, data } = await api.get(`/api/avatars/user/${encodeURIComponent(playerIdToLoad)}`);
      if (ok) {
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
    buyIn?: number;
    name?: string;
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
  // Why the table has not moved on to the next hand, when it is waiting on someone
  const [tableWaitNotice, setTableWaitNotice] = useState<string | null>(null);
  
  // Supabase is now the only supported transport
  const socketsDisabled = true;

  // Host, table settings, waitlist and seat requests
  const { extras: tableExtras, refresh: refreshTableExtras } = useTableExtras(tableId);
  const [seatNotice, setSeatNotice] = useState<string | null>(null);
  
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
          // Stud deals the seventh-street card face down, so a broadcast can't carry ours
          const reachedSeventh = gameState.stage === 'seventh' && pokerStageRef.current !== 'seventh';
          if ((isNewHand || reachedSeventh) && missingMyCards && isParticipant && shouldShowCards && effectivePlayerId && id) {
            console.log('🎴 New hand detected without cards, fetching player-specific state...');
            api.get('/api/games/state', { query: { tableId: String(id), playerId: effectivePlayerId } })
              .then(unwrap)
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

            // Preserve our hole cards (Hold'em/Omaha) by merging them into the new state
            const mergedPlayers = (hadCards && missingCards && Array.isArray(gameState.players))
              ? gameState.players.map((p: any) => {
                  if (p.id === resolvedPlayerId) {
                    return { ...p, holeCards: prevHoleCards };
                  }
                  return p;
                })
              : gameState.players;

            // Stud keeps cards in studState rather than holeCards, so preserve our down cards separately.
            // Only within the same hand: our earlier up cards must still lead the new up cards.
            let mergedStudState = gameState.studState;
            if (!isNewHand && gameState.studState?.playerCards && prevState.studState?.playerCards) {
              const prevStudCards = prevState.studState.playerCards[resolvedPlayerId];
              const newStudCards = gameState.studState.playerCards[resolvedPlayerId];
              const hadDownCards = Array.isArray(prevStudCards?.downCards) && prevStudCards.downCards.length > 0;
              const missingDownCards = !Array.isArray(newStudCards?.downCards) || newStudCards.downCards.length === 0;
              const prevUp: any[] = Array.isArray(prevStudCards?.upCards) ? prevStudCards.upCards : [];
              const newUp: any[] = Array.isArray(newStudCards?.upCards) ? newStudCards.upCards : [];
              const sameHand = prevUp.length > 0 && prevUp.length <= newUp.length
                && prevUp.every((c: any, i: number) => c?.rank === newUp[i]?.rank && c?.suit === newUp[i]?.suit);

              if (hadDownCards && missingDownCards && sameHand) {
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
            setSeatAssignments(prev => {
              const updatedSeats = { ...prev };
              gameState.players.forEach((player: any) => {
                const seat = updatedSeats[player.position];
                if (seat && seat.playerId === player.id) {
                  updatedSeats[player.position] = {
                    playerId: seat.playerId,
                    playerName: seat.playerName,
                    chips: player.stack || 0,
                  };
                }
              });
              return updatedSeats;
            });
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
      onTableEvent: (payload: any) => {
        // Reactions come often and change nothing the extras panel shows
        if (payload?.type !== 'reaction') refreshTableExtras();
        if (payload?.type === 'kicked' && payload.playerId === playerId) {
          setSeatNotice('The host removed you from the table.');
        }
        if (payload?.type === 'seat_request_resolved' && payload.playerId === playerId) {
          setSeatNotice(payload.approved ? 'The host approved your seat.' : 'The host declined your seat request.');
        }
        // The tournament moved this player to another table: take them there
        if (payload?.type === 'tournament_moved' && payload.playerId === playerId && payload.roomId) {
          setSeatNotice(`You've been moved to table ${payload.table}, seat ${payload.seat}. Taking you there…`);
          setTimeout(() => router.push(`/game/${payload.roomId}`), 3000);
        }
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

  // Turn clock: counts down the player to act; every player's client asks the server to act for
  // a player whose time has run out, so nobody can stall the table
  const amInGame = !!pokerGameState?.players?.some((p: any) => p.id === playerId);
  const turnClock = useTurnClock({
    state: gameStarted ? pokerGameState : null,
    tableId,
    playerId,
    enforce: amInGame && !!playerId,
    onState: setPokerGameState,
  });
  const isMyTurn = gameStarted && !!playerId && pokerGameState?.activePlayer === playerId && pokerGameState?.stage !== 'showdown';
  const myTurnKey = isMyTurn ? `${pokerGameState?.turnSeq ?? ''}:${playerId}:${pokerGameState?.stage ?? ''}` : null;
  const me = amInGame ? pokerGameState.players.find((p: any) => p.id === playerId) : null;
  // Someone sitting down between hands joins the next one, so a new seat is worth another try
  const seatedCount = getSeatedPlayersCount();
  const sittingInCount = Array.isArray(pokerGameState?.players)
    ? pokerGameState.players.filter((p: any) => !p.isSittingOut).length
    : 0;
  
  // Poll for turn status every 10 seconds when waiting
  // This complements Supabase Realtime notifications to ensure players are notified of their turn even if broadcasts are missed
  // Can be disabled via localStorage for debugging: localStorage.setItem('disablePolling', 'true')
  const [pollingDisabled, setPollingDisabled] = useState<boolean | null>(null);
  
  useEffect(() => {
    let disabled = false;
    try {
      disabled = localStorage.getItem('disablePolling') === 'true';
    } catch (error) {
      console.warn('Unable to access localStorage for disablePolling flag', error);
    }
    setPollingDisabled(disabled);
    if (disabled) {
      console.log('⚠️ Turn polling is DISABLED via localStorage');
    } else {
      console.log('✓ Turn polling is ENABLED');
    }
  }, []);
  
  const isWaitingForTurn = gameStarted && pokerGameState && pokerGameState.activePlayer !== playerId && currentPlayerSeat !== null;
  useCheckTurn(
    tableId,
    playerId,
    {
      enabled: isWaitingForTurn && pollingDisabled === false,
      interval: 10000,
      onTurnChange: (status) => {
        console.log('🔔 Turn status changed via polling:', status);
        if (
          // Also refresh when a pause or any other change happened that this view missed
          (status.activePlayer !== pokerGameState?.activePlayer || status.tableState !== pokerGameState?.stage
            || (status.paused ?? false) !== !!pokerGameState?.paused
            || (typeof status.turnSeq === 'number' && status.turnSeq !== pokerGameState?.turnSeq)) &&
          typeof id === 'string' &&
          playerId
        ) {
          api.get('/api/games/state', { query: { tableId: id, playerId } })
            .then(unwrap)
            .then(data => {
              if (data.gameState?.stage === status.tableState) {
                setPokerGameState(data.gameState);
              }
            })
            .catch(error => console.warn('Failed to refresh game state after poll:', error));
        }
        if (status.isMyTurn) {
          console.log('🔔 Polling detected it\'s now your turn - waiting for Realtime state update');
        }
      }
    }
  );
  
  // Track last received sequence number to prevent out-of-order updates
  const lastSeqRef = useRef<number>(0);
  // Prevent duplicate action submissions
  const pendingActionRef = useRef<boolean>(false);
  // Auto next-hand fallback timer ref
  // Visual accessibility options
  // The player's profile display settings, with any changes made at this table
  const display = useDisplaySettings(id ? String(id) : null);
  const { highContrastCards, showPotOdds, showStackInBB, showHandValue } = display.settings;
  // Dealer's Choice: pending choice prompt from server
  const [awaitingDealerChoice, setAwaitingDealerChoice] = useState<null | { dealerId?: string; allowedVariants?: string[]; current?: string }>(null);
  const [selectedVariantDC, setSelectedVariantDC] = useState<string>('texas-holdem');
  // Track if the dealer has manually changed the selection to avoid overwriting with stale prompts
  const userChangedVariantRef = useRef<boolean>(false);
  const lastAwaitingDealerIdRef = useRef<string | undefined>(undefined);
  const allowedDealerChoiceVariants = useRef<string[]>([...ALL_VARIANTS]);
  // The panel sits above the table, so a dealer scrolled down to the action buttons on a short
  // screen would otherwise never see it
  const amChoosingGame = gameStarted && !!playerId && awaitingDealerChoice?.dealerId === playerId;
  const dealerChoicePanelRef = useRevealWhen<HTMLDivElement>(amChoosingGame);
  // Nobody is the active player during dealer's choice, but the table is waiting on the dealer
  const turnAlerts = useTurnAlerts(isMyTurn || amChoosingGame, turnClock.remainingMs, myTurnKey);

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

  // Helper: suit -> Tailwind text color class, considering high contrast setting
  const suitColorClass = useCallback((suit: string) => suitTextClass(suit, highContrastCards), [highContrastCards]);

  // Fetch room configuration to determine variant, betting mode, and blinds
  useEffect(() => {
    let alive = true;
    const fetchRoom = async () => {
      try {
        if (!id || typeof id !== 'string') return;
        const { ok, status, data } = await api.get(`/api/games/rooms/${encodeURIComponent(id)}`);
        if (status === 403) {
          if (alive && data?.code === 'PRIVATE_TABLE') setPrivateTableBlocked(true);
          return;
        }
        if (!ok) return;
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
        const buyIn = typeof cfg?.buyIn === 'number' && cfg.buyIn > 0 ? cfg.buyIn : 1000;
        const name = typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : undefined;
        setRoomConfig({ variant, bettingMode, sb, bb, numberOfRebuys, buyIn, name });
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

  // After a showdown, ask for the next hand, and keep asking while the table is still at showdown:
  // one failed request (or a rebuy prompt someone never saw) used to leave the table stuck.
  const rebuyPromptRef = useRef(rebuyPrompt);
  rebuyPromptRef.current = rebuyPrompt;
  // One tab drives this: the player in the lowest-numbered seat asks promptly, everyone else only as
  // a slow backup (in case that player has left), so a table makes one request every few seconds
  // rather than one per player.
  const nextHandLeaderId = useMemo(() => {
    const seatNumbers = Object.keys(seatAssignments).map(Number).sort((a, b) => a - b);
    for (const n of seatNumbers) {
      const seat = seatAssignments[n];
      if (seat?.playerId) return seat.playerId;
    }
    return null;
  }, [seatAssignments]);
  const isNextHandLeaderRef = useRef(false);
  isNextHandLeaderRef.current = !nextHandLeaderId || nextHandLeaderId === playerId;
  useEffect(() => {
    if (!id || typeof id !== 'string') return;
    if (pokerGameState?.stage !== 'showdown') {
      setTableWaitNotice(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const attempt = async () => {
      if (cancelled || pokerStageRef.current !== 'showdown') return;
      attempts += 1;
      try {
        const response = await api.post('/api/games/next-hand', { tableId: id, playerId });
        const data = response.data;
        if (cancelled) return;
        if (response.ok && data?.awaitingRebuyDecisions) {
          const waiting: Array<{ playerId: string; playerName?: string; baseChips: number; rebuysUsed: number; rebuyLimit: any; remaining: any }> =
            Array.isArray(data.waitingFor) ? data.waitingFor : [];
          // Show our own rebuy choice even if we missed the prompt broadcast
          const mine = waiting.find(w => w.playerId === playerId);
          if (mine && !rebuyPromptRef.current) {
            setRebuyPrompt({ baseChips: mine.baseChips, rebuysUsed: mine.rebuysUsed, rebuyLimit: mine.rebuyLimit, remaining: mine.remaining });
          }
          const others = waiting.filter(w => w.playerId !== playerId).map(w => w.playerName || 'a player');
          setTableWaitNotice(others.length ? `Waiting for ${others.join(', ')} to decide whether to rebuy.` : null);
        } else if (response.ok) {
          // The next hand started, or dealer's choice is waiting on the dealer
          setTableWaitNotice(null);
          return;
        } else if (data?.code === 'NOT_ENOUGH_PLAYERS_SITTING_IN') {
          setTableWaitNotice('Waiting for at least two players to sit in.');
        } else if (data?.code === 'PAUSED') {
          setTableWaitNotice(null);
        } else if (data?.code === 'TOURNAMENT_PAUSED' || data?.code === 'TOURNAMENT_OVER' || data?.code === 'TABLE_CLOSED' || data?.code === 'HAND_FOR_HAND') {
          // A tournament table waits for the tournament: a break, a pause, hand for hand, a closed table or the end
          setTableWaitNotice(data.breakEndsAt
            ? `${data.error}. Play resumes at ${new Date(data.breakEndsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
            : data.error);
        } else {
          console.warn('Next hand request failed:', data?.error || response.status);
        }
      } catch (e) {
        console.warn('Auto next-hand request failed:', e);
      }
      // Still at showdown: try again, less often after the first minute
      if (cancelled) return;
      if (isNextHandLeaderRef.current) {
        if (attempts < 120) timer = setTimeout(attempt, attempts < 12 ? 5000 : 15000);
      } else if (attempts < 60) {
        timer = setTimeout(attempt, 30000);
      }
    };
    // The table's pause between hands; the other players step in if the first one's request never comes
    const pause = handDelayMs({ handDelayMs: pokerGameState?.handDelayMs });
    timer = setTimeout(attempt, isNextHandLeaderRef.current ? pause : pause + 15000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Re-run for each new hand, and when players sit in or out
  }, [pokerGameState?.stage, pokerGameState?.handNumber, pokerGameState?.handDelayMs, id, playerId, sittingInCount, seatedCount]);

  // Seat polling shows other players sitting down before a game starts; once one is running, seats
  // come from game state. A fallback for missed live updates, so it pauses for hidden or idle tabs.
  const seatPollEnabled = !!id && !gameStarted && !pokerGameState;
  const seatPollEnabledRef = useRef(seatPollEnabled);
  seatPollEnabledRef.current = seatPollEnabled;
  const fetchSeats = async () => {
    try {
      const resp = await api.get('/api/games/seats/state', { query: { tableId: String(id) } });
      if (!resp.ok) return;
      const data = resp.data;
      if (!seatPollEnabledRef.current) return;

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
  usePolling(fetchSeats, 10_000, { enabled: seatPollEnabled });

  // Seat management functions
  const claimSeat = async (seatNumber: number) => {
    if (userRole === 'guest') return; // Guests cannot claim seats
    if (seatAssignments[seatNumber]) return; // Seat already taken locally
    if (currentPlayerSeat) return; // Player already has a seat
    if (claimingSeat) return; // Already claiming

    // The name chosen in Account Settings, else the account username; a numbered name only for guests
    const playerName = tablePlayerName((() => {
      const playerNumber = playerId.replace(/\D/g, '').slice(-2) || Math.floor(Math.random() * 99).toString().padStart(2, '0');
      return `Player ${playerNumber}`;
    })());

    setClaimingSeat(seatNumber);

    try {
      const resp = await api.post('/api/games/seats/claim', { tableId: id, seatNumber, playerId, playerName });
      if (resp.status === 202) {
        // The host approves who sits at this table
        setSeatNotice('Seat requested. Waiting for the host to approve.');
        refreshTableExtras();
        setClaimingSeat(null);
        return;
      }
      if (!resp.ok) {
        const e = resp.data;
        console.warn('Seat claim failed:', e);
        if (e?.code === 'SEAT_HELD' || e?.code === 'PERMISSION_DENIED' || e?.code === 'LIMIT_REACHED') setSeatNotice(e.error);
        setClaimingSeat(null);
        return;
      }
      setSeatNotice(null);
      const data = resp.data;
      // The server sets the stack from the room's buy-in
      const startingChips = Number(data?.chips) || roomConfig?.buyIn || 1000;
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
      api.post('/api/games/seats/stand', { tableId: id, seatNumber: seatToVacate, playerId }).catch(() => {});
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
    // HTTP API for game start; the server takes the game type and blinds from the room
    try {
      const response = await api.post('/api/games/start', {
        tableId: id,
        playerId,
        seatedPlayers: seated,
      });

      if (!response.ok) {
        console.error('Start game failed:', response.data);
      } else {
        // Use the API response to set initial game state
        // The API returns a sanitized state that includes the current player's hole cards
        const data = response.data;
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
  // Splash the pot: once per session, the next bet or raise lands with a show for the table
  const [splashArmed, setSplashArmed] = useState(false);
  const splashArmedRef = useRef(false);
  splashArmedRef.current = splashArmed;

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
    const splash = splashArmedRef.current && (action === 'bet' || action === 'raise');
    if (splash) setSplashArmed(false);

    try {
      const response = await api.post('/api/games/action', {
        tableId: id,
        playerId,
        action,
        amount,
        ...(splash ? { splash: true } : {}),
        // The decision this click answers; the server refuses it if the game has moved on
        expectedTurnSeq: typeof pokerGameState.turnSeq === 'number' ? pokerGameState.turnSeq : undefined,
      });

      if (!response.ok) {
        const err = response.data;
        console.error('Poker action failed:', err);
        if (err?.code === 'PERMISSION_DENIED') setSeatNotice(err.error);
        if (err?.code === 'STALE_GAME_STATE') {
          // This view was behind the server; refresh it so the next action uses the current state
          try {
            const latest = await api.get('/api/games/state', { query: { tableId: String(id) } });
            if (latest.ok && latest.data?.gameState) setPokerGameState(latest.data.gameState);
          } catch (refreshError) {
            console.warn('Failed to refresh game state after a stale action:', refreshError);
          }
        }
      } else {
        // Use the API response to update game state
        // The API returns a sanitized state that includes the current player's hole cards
        const data = response.data;
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
      // A short stack calls all-in for what it has
      const callAmount = Math.min(pokerGameState.currentBet - (playerInGame?.currentBet || 0), Number(playerInGame?.stack) || 0);
      handlePokerAction('call', callAmount);
    }
  }, [pokerGameState, playerId, handlePokerAction]);
  const handleBet = useCallback((amount: number) => {
    setLastBet(amount);
    return handlePokerAction('bet', amount);
  }, [handlePokerAction]);
  const handleRaise = useCallback((amount: number) => {
    setLastBet(amount);
    return handlePokerAction('raise', amount);
  }, [handlePokerAction]);

  // Get current player's hole cards
  const getCurrentPlayerCards = () => {
    if (!pokerGameState || !playerId) return [];
    const player = pokerGameState.players.find((p: any) => p.id === playerId);
    return player?.holeCards || [];
  };

  // Variant helpers
  const isStudVariant = () => isStudGame(pokerGameState?.variant);

  const getStudCardsForPlayer = useCallback((pid: string) => {
    const st = (pokerGameState as any)?.studState?.playerCards?.[pid];
    return {
      down: Array.isArray(st?.downCards) ? st.downCards : [],
      up: Array.isArray(st?.upCards) ? st.upCards : [],
      // Hidden down cards arrive as a count, so the table can still draw their backs
      downCount: Number(st?.downCount) || 0,
    } as { down: any[]; up: any[]; downCount: number };
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
        if (isStudGame(variant)) {
          const { down, up } = getStudCardsForPlayer(playerId);
          const all = [...(down || []), ...(up || [])];
          if (!all || all.length === 0) return null;
          // Razz is played for the lowest hand
          if (variant === 'razz') return HandEvaluator.evaluateRazzLow(all).description;
          if (all.length < 5) return partialLabel(all);
          const ranking = HandEvaluator.getHandRanking(all, []);
          return formatWithKickers(ranking) || null;
        }

        const holes = Array.isArray(me?.holeCards) ? me.holeCards : [];
        const board = Array.isArray(pokerGameState?.communityCards) ? pokerGameState.communityCards : [];
        if (!holes || holes.length === 0) return null;
        const known = [...holes, ...board];
        if (known.length < 5) return partialLabel(known);

        if (isOmahaVariant(variant)) {
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

  // With one card to come: the chance it improves your hand, from the cards you can see
  const myLastCardOdds = useMemo((): string | null => {
    if (!pokerGameState || !playerId || pokerGameState.stage === 'showdown') return null;
    const me = pokerGameState.players?.find((p: any) => p.id === playerId);
    if (!me || me.isFolded) return null;
    const variant = pokerGameState.variant;
    const stud = isStudGame(variant);
    const board: Card[] = stud || !Array.isArray(pokerGameState.communityCards) ? [] : pokerGameState.communityCards;
    let mine: Card[];
    let seen: Card[] = [];
    if (stud) {
      const own = getStudCardsForPlayer(playerId);
      mine = [...own.down, ...own.up];
      seen = (pokerGameState.players || []).filter((p: any) => p.id !== playerId).flatMap((p: any) => getStudCardsForPlayer(p.id).up);
    } else {
      mine = Array.isArray(me.holeCards) ? me.holeCards : [];
    }
    const when = lastCardDrawFor(variant, { board: board.length, mine: mine.length });
    if (!when) return null;
    const odds = improvementOnLastCard({ mine, board, seen, omaha: isOmahaVariant(variant) });
    return odds ? describeImprovement(odds, when) : null;
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
      <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-sm border border-blue-200 dark:border-blue-800">
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
  // Everyone still in votes; it runs more than once only if they all agree
  const runItVoterIds: string[] = runItTwicePrompt ? runItVoters(runItTwicePrompt) : [];
  const myRunItVote: number | undefined = runItTwicePrompt?.votes?.[playerId];
  const canVoteRunIt = !!runItTwicePrompt && runItVoterIds.includes(playerId) && myRunItVote === undefined;
  const runItWaitingNames: string[] = runItTwicePrompt
    ? tallyRunItVotes(runItVoterIds, runItTwicePrompt.votes || {}).waitingFor
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
      const response = await api.post('/api/games/enable-rit', { tableId: id, playerId, runs });
      if (!response.ok) {
        console.error('Failed to process Run-It-Twice decision:', response.data);
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

      const allPlayers = gs.players as Array<{ id: string; position?: number; isSittingOut?: boolean; waitingForBigBlind?: boolean }>;
      // At a tournament table players sitting out still post
      const dealerIdxAll = Number(gs.dealerPosition);
      if (!Number.isFinite(dealerIdxAll)) return null;
      const dealerId = allPlayers[dealerIdxAll]?.id;
      if (!dealerId) return null;
      // Blinds go round the players sitting in, as on the server
      const players = allPlayers.filter(p => (gs.tournamentRules || !p.isSittingOut) && !p.waitingForBigBlind);
      const dealerIdx = Math.max(0, players.findIndex(p => p.id === dealerId));
      const n = players.length;
      if (n < 2) return null;

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
  // What this player last bet or raised to, offered as a quick pick
  const [lastBet, setLastBet] = useState<number>(0);
  // Every turn starts from the minimum (0 clamps up to it) rather than the amount used last time
  useEffect(() => {
    setBetInput(0);
    setRaiseInput(0);
  }, [myTurnKey]);
  // Private notes about the other seated players
  const [playerNotes, setPlayerNotes] = useState<NotesMap>({});
  const otherSeated = useMemo(
    () => Object.values(seatAssignments)
      .filter((a): a is { playerId: string; playerName: string; chips: number } => !!a && a.playerId !== playerId)
      .map(a => ({ id: a.playerId, name: a.playerName || 'Player' })),
    [seatAssignments, playerId]
  );
  const otherSeatedKey = otherSeated.map(p => p.id).sort().join(',');
  useEffect(() => {
    if (!playerId || !otherSeatedKey) return;
    fetchNotes(otherSeatedKey.split(',')).then(setPlayerNotes).catch(() => {});
  }, [playerId, otherSeatedKey]);

  // Waitlist
  const isSeated = currentPlayerSeat !== null;
  const tableFull = Object.entries(seatAssignments).filter(([n]) => Number(n) <= maxPlayers).every(([, a]) => !!a);
  const toggleWaitlist = useCallback(async (join: boolean) => {
    if (!tableId || !playerId) return;
    const name = tablePlayerName('Player');
    const resp = await api.post('/api/games/waitlist', { tableId, playerId, join, playerName: name }).catch(() => null);
    if (resp?.status === 403 && resp.data?.code === 'PERMISSION_DENIED') setSeatNotice(resp.data.error);
    refreshTableExtras();
  }, [tableId, playerId, refreshTableExtras]);

  // Straddle next hand
  const toggleStraddle = useCallback(async () => {
    if (!tableId || !playerId || !me) return;
    const resp = await api.post('/api/games/straddle', { tableId, playerId, wants: !me.wantsStraddle }).catch(() => null);
    if (resp?.ok && resp.data?.gameState) setPokerGameState(resp.data.gameState);
  }, [tableId, playerId, me]);

  // Pre-action queued for when it becomes our turn (current betting round only)
  const [preAction, setPreAction] = useState<PreAction | null>(null);
  const myOwed = me ? Math.max(0, Number(pokerGameState?.currentBet || 0) - Number(me.currentBet || 0)) : 0;
  // What a call actually costs: a short stack calls all-in for less
  const myCallAmount = me ? Math.min(myOwed, Math.max(0, Number(me.stack) || 0)) : 0;
  const myCallIsAllIn = myOwed > 0 && (Number(me?.stack) || 0) <= myOwed;
  // Stud: the lowest up card opens third street by bringing it in or completing to a full bet
  const studBringIn = pokerGameState?.studState?.bringIn;
  const myBringInPending = !!(isMyTurn && pokerGameState?.stage === 'third' && studBringIn?.pending && studBringIn.player === playerId);
  const bringInAmount = Number(studBringIn?.amount) || 0;
  const completeAmount = Math.min(Number(pokerGameState?.bigBlind) || 0, Math.max(0, Number(me?.stack) || 0));

  // A pre-action applies to one betting round
  useEffect(() => {
    setPreAction(null);
  }, [pokerGameState?.stage]);

  // A bet cancels "Check", and a raise cancels "Call X"
  useEffect(() => {
    if (!preAction || isMyTurn) return;
    if ((preAction.type === 'check' && myOwed > 0) || (preAction.type === 'call' && myOwed !== preAction.amount)) {
      setPreAction(null);
    }
  }, [preAction, myOwed, isMyTurn]);

  // Carry out the queued pre-action as soon as the turn arrives
  useEffect(() => {
    if (!preAction || !isMyTurn || !me || me.isFolded) return;
    // A Run It Twice decision is not a betting turn
    if (pokerGameState?.runItTwicePrompt) return;
    // Nor is the stud bring-in: that choice is the player's to make
    if (myBringInPending) { setPreAction(null); return; }
    const result = resolvePreAction(preAction, myOwed);
    setPreAction(null);
    if (result.action === 'cancel') return;
    if (result.action === 'call') handlePokerAction('call', result.amount);
    else handlePokerAction(result.action);
  }, [preAction, isMyTurn, me, myOwed, pokerGameState?.runItTwicePrompt, myBringInPending, handlePokerAction]);

  // Keyboard shortcuts work only while the Your Turn panel is showing (same conditions as the panel)
  const actionPanelOpen = !!(gameStarted && pokerGameState && pokerGameState.stage !== 'showdown' && getActiveNonFoldedPlayers().length > 1 && pokerGameState.activePlayer === playerId && !runItTwicePrompt);
  const shortcuts = useTableShortcuts({
    enabled: actionPanelOpen,
    // The bring-in cannot fold; check/call posts the bring-in
    onFold: () => { if (!myBringInPending) handleFold(); },
    onCheckOrCall: () => (myBringInPending ? handlePokerAction('bring-in') : myOwed > 0 ? handlePokerAction('call', myOwed) : handleCheck()),
  });

  // Emote reactions shown over seats
  const reactions = useTableReactions(tableId || undefined, playerId);

  // Phones in portrait get compact seats with their info boxes next to the seat
  const isNarrowScreen = useMediaQuery(NARROW_SCREEN_QUERY);

  // Post a big blind now instead of waiting, or stand up once this hand ends
  const [seatOptionPending, setSeatOptionPending] = useState(false);
  const setSeatOption = useCallback(async (option: 'post-big-blind-now' | 'leave-after-hand', value: boolean) => {
    if (!tableId || !playerId) return;
    setSeatOptionPending(true);
    try {
      const resp = await api.post('/api/games/seat-options', { tableId, playerId, option, value });
      const data = resp.data;
      if (resp.ok && data?.gameState) setPokerGameState(data.gameState);
      else console.warn('Seat option request failed:', data);
    } catch (err) {
      console.warn('Seat option request failed:', err);
    } finally {
      setSeatOptionPending(false);
    }
  }, [tableId, playerId]);
  // In a hand still being played: standing up now would fold, so offer to leave once it ends
  const myHandLive = !!(gameStarted && me && !me.isFolded && !me.isSittingOut && !me.waitingForBigBlind
    && pokerGameState?.stage && pokerGameState.stage !== 'showdown' && pokerGameState.stage !== 'awaiting-dealer-choice');

  // Sit out from the next hand, or back in
  const [sitOutPending, setSitOutPending] = useState(false);
  const toggleSitOut = useCallback(async () => {
    if (!tableId || !playerId || !me) return;
    setSitOutPending(true);
    try {
      const resp = await api.post('/api/games/sit-out', { tableId, playerId, sittingOut: !me.isSittingOut });
      const data = resp.data;
      if (resp.ok && data?.gameState) setPokerGameState(data.gameState);
      else console.warn('Sit out request failed:', data);
    } catch (err) {
      console.warn('Sit out request failed:', err);
    } finally {
      setSitOutPending(false);
    }
  }, [tableId, playerId, me]);

  // A tournament seated us at this table and we've just opened it: sit in. Retried on the next
  // state update if the request fails or loses a race
  const arriving = useRef(false);
  const notArrived = !!me?.notArrived;
  useEffect(() => {
    if (!notArrived || !tableId || !playerId || arriving.current) return;
    arriving.current = true;
    api.post('/api/games/sit-out', { tableId, playerId, sittingOut: false })
      .then(r => { if (r.ok && r.data?.gameState) setPokerGameState(r.data.gameState); })
      .catch(err => console.warn('Could not sit in at the tournament table:', err))
      .finally(() => { arriving.current = false; });
  }, [notArrived, tableId, playerId, pokerGameState]);

  // After the hand: turn our cards face up for the table
  const showMyCards = useCallback(async () => {
    if (!tableId || !playerId) return;
    try {
      const resp = await api.post('/api/games/show-cards', { tableId, playerId });
      const data = resp.data;
      if (resp.ok && data?.gameState) setPokerGameState(data.gameState);
      else console.warn('Show cards failed:', data);
    } catch (err) {
      console.warn('Show cards failed:', err);
    }
  }, [tableId, playerId]);

  // Get position for current player's hole cards based on their seat
  // Your hole cards fan out a little, like cards held in hand: tilted from the middle and dipping
  // at the ends
  const fanStyle = (index: number, count: number): React.CSSProperties => {
    if (count < 2) return {};
    const offset = index - (count - 1) / 2;
    const tilt = count === 2 ? 6 : 5;
    return {
      transform: `translateY(${Math.abs(offset) * (count === 2 ? 3 : 4)}px) rotate(${offset * tilt}deg)`,
      transformOrigin: 'bottom center',
    };
  };

  const getCurrentPlayerCardsPosition = () => {
    // Place the current player's cards centered near the bottom of the felt,
    // lowered to just touch the top of the avatar positioned below the table.
    if (!currentPlayerSeat) return 'bottom-6 left-1/2 transform -translate-x-1/2';
    return 'bottom-9 max-sm:bottom-9 left-1/2 transform -translate-x-1/2';
  };

  // Render seat component with adjacent player info
  const renderSeat = (seatNumber: number, position: string, style?: React.CSSProperties) => {
    const assignment = seatAssignments[seatNumber];
    const isCurrentPlayer = assignment?.playerId === playerId;
  const isEmpty = !assignment;
  // Allow claiming even if seat state hasn't synced yet; server validates occupancy
  const canClaim = isEmpty && userRole !== 'guest' && !currentPlayerSeat && claimingSeat === null;

    // Seat records keep the buy-in; once the player is in the game, the engine stack is the truth
    const seatGamePlayer = assignment ? pokerGameState?.players?.find((p: any) => p.id === assignment.playerId) : undefined;
    const seatChips = Number(seatGamePlayer ? seatGamePlayer.stack : assignment?.chips) || 0;
    // Pulse the winners' seats while the result is on show
    const isHandWinner = !!assignment && pokerGameState?.stage === 'showdown' && Array.isArray(pokerGameState?.handWinners) && pokerGameState.handWinners.includes(assignment.playerId);

    return (
      <React.Fragment key={seatNumber}>
        {/* Main seat */}
        <div
          className={`absolute w-16 h-16 max-sm:w-12 max-sm:h-12 rounded-full border-2 flex flex-col items-center justify-center text-white text-xs font-semibold relative transition-colors ${position} ${isCurrentPlayer && actionPanelOpen ? 'max-sm:invisible' : ''} ${
            isEmpty
              ? canClaim
                ? 'border-dashed border-white/30 bg-black/20 text-white/70 hover:border-emerald-300/80 hover:bg-emerald-400/10 hover:text-white cursor-pointer'
                : 'border-dashed border-white/15 bg-black/15 text-white/40'
              : isCurrentPlayer
                ? 'bg-gray-950 border-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.15)]'
                : 'bg-gray-950 border-white/25'
          } ${isHandWinner ? 'table-winner-pulse' : ''}`}
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
                : `${assignment.playerName} - $${seatChips}`
          }
        >
          {isEmpty ? (
            <div className="text-center leading-tight text-[11px] font-semibold">
              {claimingSeat === seatNumber ? 'Claiming…' : canClaim ? <>Sit</> : <>{seatNumber}</>}
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Avatar 
                src={getPlayerAvatarSrc(assignment.playerId)}
                size="lg"
                className={`w-[52px] h-[52px] max-sm:w-10 max-sm:h-10 rounded-full shadow-xs ${(() => {
                  const tag = playerNotes[assignment.playerId]?.color as NoteColor | undefined;
                  return tag && NOTE_COLOR_CLASSES[tag] ? `ring-4 ${NOTE_COLOR_CLASSES[tag].ring}` : '';
                })()}`}
                alt={assignment.playerName || `Player ${seatNumber}`}
              />
              {(() => {
                const token = getPlayerToken(assignment.playerId);
                if (!token) return null;
                const styleMap: Record<'D' | 'SB' | 'BB', string> = {
                  D: 'bg-white text-gray-900 border-gray-200 min-w-[20px] text-center',
                  SB: 'bg-gray-800 text-gray-100 border-white/25',
                  BB: 'bg-gray-800 text-amber-200 border-amber-300/40',
                };
                return (
                  <div
                    className={`absolute -top-1.5 -right-1.5 z-30 px-1.5 py-0.5 rounded-full text-[10px] leading-none font-bold border shadow-md ${styleMap[token]}`}
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
            className="absolute z-10"
            // The top and bottom seats' plates sit left of the avatar; the others' are centred under it
            style={seatPlateStyle(style, isNarrowScreen ? 30 : 38)}
          >
            <div className={`min-w-[96px] max-w-[150px] px-3 py-1.5 max-sm:px-2 max-sm:py-1 max-sm:text-[10px] max-sm:min-w-[84px] max-sm:max-w-[120px] rounded-xl shadow-card border backdrop-blur-xs text-xs bg-gray-950/85 text-gray-100 ${
              isCurrentPlayer ? 'border-emerald-400/40' : 'border-white/10'
            }`}>
              <div className="font-medium text-gray-200 whitespace-nowrap max-sm:truncate">
                {assignment.playerName || `Player ${seatNumber}`}
              </div>
              <div className="text-emerald-300 font-semibold tabular-nums">
                {showStackInBB 
                  ? formatChips(seatChips, pokerGameState?.bigBlind || null, true)
                  : `$${seatChips}`
                }
              </div>
              {/* Show additional game state info if player is in active game */}
              {pokerGameState && (() => {
                const gamePlayer = pokerGameState.players?.find((p: any) => p.id === assignment.playerId);
                return gamePlayer && (
                  <div className="text-xs max-sm:text-[10px] mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis empty:hidden">
                    {gamePlayer.isSittingOut && (
                      <span className="text-gray-400 italic">{gamePlayer.notArrived ? 'Not here yet (posting blinds)' : pokerGameState.tournamentRules ? 'Away (posting blinds)' : 'Sitting out'}</span>
                    )}
                    {gamePlayer.waitingForBigBlind && !gamePlayer.isSittingOut && (
                      <span className="text-gray-400 italic">{gamePlayer.postBigBlindNow ? 'Posting big blind' : 'Waiting for big blind'}</span>
                    )}
                    {gamePlayer.leaveAfterHand && <span className="text-gray-400 italic"> Leaving after hand</span>}
                    {(gamePlayer.folded || gamePlayer.isFolded) && !gamePlayer.isSittingOut && <span className="text-gray-400">Folded</span>}
                    {gamePlayer.isAllIn && <span className="font-semibold text-amber-300">All-in</span>}
                    {gamePlayer.currentBet > 0 && !gamePlayer.folded && (
                      <span className="text-sky-300 tabular-nums">
                        Bet: {showStackInBB 
                          ? formatChips(gamePlayer.currentBet, pokerGameState?.bigBlind || null, true)
                          : `$${gamePlayer.currentBet}`
                        }
                      </span>
                    )}
                    {(gamePlayer.timeBanks ?? 0) > 0 && <span className="ml-1"><TimeBankBadge count={gamePlayer.timeBanks} seconds={pokerGameState?.timeBankSeconds} compact /></span>}
                    {turnClock.activePlayer === gamePlayer.id && <TurnClockBar clock={turnClock} compact />}
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
          // A folded player can still show their cards once the hand is over
          const studShown = (pokerGameState?.studState?.playerCards?.[assignment.playerId]?.downCards?.length || 0) > 0;
          const shownAfterFold = hasFolded && pokerGameState?.stage === 'showdown'
            && ((Array.isArray(gamePlayer?.holeCards) && gamePlayer.holeCards.length > 0) || studShown);
          if (!gamePlayer || (hasFolded && !shownAfterFold)) return null;
          // Nobody holds cards while the dealer is choosing the next game
          if (pokerGameState?.stage === 'awaiting-dealer-choice') return null;

          // Compute position offset based on seat location (push cards slightly further from table center)
          let cardStyle: React.CSSProperties | undefined = undefined;
          if (style && style.left && style.top) {
            const leftStr = style.left.toString();
            const topStr = style.top.toString();
            const leftPercent = parseFloat(leftStr.replace('%', ''));
            const topPercent = parseFloat(topStr.replace('%', ''));
            // Move cards toward the table center (opposite side of avatar). The top and bottom
            // seats have their name plate on the left, so their cards go on the right
            const offset = isNarrowScreen ? 56 : 58;
            const dx = isCentreSeat(style) || leftPercent < 50 ? offset : -offset;
            const dy = topPercent >= 50 ? -4 : 4;
            cardStyle = {
              position: 'absolute',
              left: `calc(${leftStr} + ${dx}px)`,
              top: `calc(${topStr} + ${dy}px)`,
              transform: 'translate(-50%, -50%)'
            };
          }

          if (isStudVariant()) {
            const { down, up, downCount } = getStudCardsForPlayer(assignment.playerId);
            const atShowdown = pokerGameState?.stage === 'showdown';
            const downSlots: any[] = down.length > 0 ? down : Array(downCount).fill(null);
            const slots = studCardOrder(
              downSlots.map((card: any, i: number) => ({ key: `down-${i}`, card, faceDown: !(atShowdown && card) })),
              up.map((card: any, i: number) => ({ key: `up-${i}`, card, faceDown: false })),
            );
            return (
              <div className="absolute z-0 pointer-events-none" style={cardStyle} aria-label="Opponent stud cards">
                <div className="flex items-center gap-1">
                  {/* Down cards stay face down until showdown; up cards are always face up */}
                  {slots.map(({ key, card, faceDown }) => (
                    faceDown ? (
                      <div key={key} className="card-back w-8 h-12">
                        <div className="card-back-inner"></div>
                      </div>
                    ) : (
                      <TableCard key={key} card={card} size="xs" highContrast={highContrastCards} />
                    )
                  ))}
                </div>
              </div>
            );
          }

          // Hold'em/Omaha opponents: at showdown, reveal hole cards; otherwise show backs
          const showFaceUp = pokerGameState?.stage === 'showdown' && Array.isArray(gamePlayer.holeCards) && gamePlayer.holeCards.length > 0;
          if (pokerGameState?.stage === 'showdown' && !showFaceUp && getActiveNonFoldedPlayers().length >= 2) {
            return (
              <div className="absolute z-0 pointer-events-none" style={cardStyle} aria-label="Opponent mucked">
                <span className="px-2 py-0.5 rounded-full bg-black/40 ring-1 ring-white/10 text-[10px] font-medium text-white/70">Mucked</span>
              </div>
            );
          }
          if (showFaceUp) {
            const holes = gamePlayer.holeCards as any[];
            return (
              <div className="absolute z-0 pointer-events-none" style={cardStyle} aria-label="Opponent cards (revealed)">
                <div className="flex gap-1">
                  {holes.map((card: any, index: number) => (
                    <TableCard key={index} card={card} size="sm" highContrast={highContrastCards} />
                  ))}
                </div>
              </div>
            );
          }

          // Only players dealt into this hand hold cards: not those sitting out or waiting for the big blind
          const holeCount = Number(gamePlayer.holeCount) || 0;
          if (holeCount === 0) return null;

          return (
            <div key={`opp-backs-${pokerGameState?.handId ?? pokerGameState?.handNumber ?? ''}`} className="absolute z-0 pointer-events-none" style={cardStyle} aria-label="Opponent cards (hidden)">
              <div className="flex gap-1">
                {Array.from({ length: holeCount }, (_, i) => (
                  <div
                    key={i}
                    className={`table-card-deal card-back w-8 h-12 ${i === 0 ? '' : holeCount > 2 ? '-ml-5' : '-ml-3 rotate-6'}`}
                    style={{ animationDelay: `${i * 80}ms` }}
                  >
                    <div className="card-back-inner"></div>
                  </div>
                ))}
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
        const response = await api.get(`/api/games/rooms/${encodeURIComponent(String(id))}`);
        if (response.ok) {
          const roomData = response.data;
          const roomMaxPlayers = roomData.maxPlayers || 6;
          setMaxPlayers(roomMaxPlayers);
          console.log(`Room ${id} supports ${roomMaxPlayers} players`);
          
          // Only extend seat assignments if needed, don't reset existing data
          // Seat data comes from initSeatState and realtime updates
          setSeatAssignments(prev => {
            const updated = { ...prev };
            for (let i = 1; i <= roomMaxPlayers; i++) {
              if (!(i in updated)) {
                updated[i] = null;
              }
            }
            return updated;
          });
        } else {
          console.warn('Failed to fetch room info, using default 6 seats');
        }
      } catch (error) {
        console.error('Error fetching room info:', error);
      }
    };
    
    fetchRoomInfo();
  }, [id]);

  // Initialize player ID only once on component mount. Game routes reject a playerId that
  // differs from the session user, so a signed-in player always acts as that user.
  useEffect(() => {
    const generateUUID = () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    };

    const initializePlayerId = async () => {
      const sessionUserId = await resolveSessionUserId();
      if (sessionUserId) {
        setPlayerId(sessionUserId);
        try {
          localStorage.setItem('authenticated_user_id', sessionUserId);
        } catch {
          // Storage unavailable; the in-memory ID is enough
        }
        return;
      }

      // No confirmed session: watch as a spectator. Game actions need a session and will be refused.
      console.log('No confirmed session; viewing the table as a spectator');
      let fallbackId = '';
      try {
        fallbackId = localStorage.getItem('player_id') || '';
        if (!fallbackId) {
          fallbackId = generateUUID();
          localStorage.setItem('player_id', fallbackId);
        }
      } catch {
        fallbackId = fallbackId || generateUUID();
      }
      setPlayerId(fallbackId);
    };

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
        const res = await api.get('/api/auth/check-admin', { headers: { Authorization: `Bearer ${token}` } });

        if (res.ok) {
          const data = res.data;

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
    let alive = true;

    const initSeatState = async () => {
      try {
        const resp = await api.get('/api/games/seats/state', { query: { tableId: String(id) } });
        if (resp.ok) {
          const data = resp.data;
          if (!alive) return;
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
            } else {
              setCurrentPlayerSeat(null);
              persistSeatNumber(lastSeatStorageKey, null);
              setPlayerChips(0);
              try {
                if (id) {
                  localStorage.removeItem(`chips_${playerId}_${id}`);
                  if (lastSeatStorageKey) localStorage.removeItem(lastSeatStorageKey);
                }
              } catch {}
            }
          }
        }
      } catch (e) {
        console.warn('Failed to fetch seat state:', e);
      }

      // Restore active game state on reload so players are returned to their seat mid-hand
      if (!alive) return;
      try {
        const gsResp = await api.get('/api/games/state', { query: { tableId: String(id), playerId } });
        if (gsResp.ok) {
          const gsData = gsResp.data;
          if (!alive) return;
          const gs = gsData?.gameState;
          if (gs) {
            setPokerGameState(gs);
            setGameStarted(true);
            console.log('🔄 Restored active game state on reload:', gs.stage, 'activePlayer:', gs.activePlayer);
            // Keep chips synchronized only for players who still own a seat.
            if (Array.isArray(gs.players)) {
              setSeatAssignments(prev => {
                const updated = { ...prev };
                gs.players.forEach((player: any) => {
                  const seat = updated[player.position];
                  if (seat && seat.playerId === player.id) {
                    updated[player.position] = {
                      playerId: seat.playerId,
                      playerName: seat.playerName,
                      chips: player.stack || 0,
                    };
                  }
                });
                return updated;
              });
            }
          }
        }
      } catch (e) {
        console.warn('[reload] Failed to fetch game state:', e);
      }
    };

    initSeatState();
    return () => { alive = false; };
  }, [playerId, id, lastSeatStorageKey]); // Only depend on playerId, id, and storage key used for seat persistence

  // Load seat assignments - separate useEffect to prevent infinite loops
  useEffect(() => {
    if (!id || !playerId || seatStateReady) return;
    
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
  }, [id, playerId, maxPlayers, lastSeatStorageKey, seatStateReady]);

  // Restore the player's remembered seat. The player ID always comes from the session; a
  // remembered seat held by a different player (another account in this browser) is forgotten
  // rather than adopted, since acting under that player's ID would be refused by the server.
  useEffect(() => {
    if (typeof window === 'undefined' || !playerId) return;
    const seatNumberFromState = currentPlayerSeat ?? null;
    const seatNumberFromStorage = readSeatNumberFromStorage(lastSeatStorageKey);
    const candidateSeatNumber = seatNumberFromState ?? seatNumberFromStorage;
    if (!candidateSeatNumber) return;
    const assignment = seatAssignments?.[candidateSeatNumber];
    if (!assignment || !assignment.playerId) return;

    if (assignment.playerId !== playerId) {
      if (seatNumberFromState === null) {
        persistSeatNumber(lastSeatStorageKey, null);
      }
      return;
    }
    if (seatNumberFromState === candidateSeatNumber) return;

    setCurrentPlayerSeat(candidateSeatNumber);
    setPlayerChips(assignment.chips || 0);
    persistSeatNumber(lastSeatStorageKey, candidateSeatNumber);
  }, [seatAssignments, currentPlayerSeat, playerId, lastSeatStorageKey]);

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
      const response = await api.post('/api/games/rebuy-decision', { tableId: id, playerId, decision });
      if (!response.ok) {
        console.error('Rebuy decision failed:', response.data);
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
      // If seated, stand up and WAIT for server to process so other players are notified
      // before we navigate away. This ensures the seat_vacated broadcast is sent.
      if (currentPlayerSeat) {
        const seatToVacate = currentPlayerSeat;
        
        // Clear local state immediately for responsive UI
        const newAssignments = {
          ...seatAssignments,
          [currentPlayerSeat]: null
        };
        setSeatAssignments(newAssignments);
        setCurrentPlayerSeat(null);
        persistSeatNumber(lastSeatStorageKey, null);
        setPlayerChips(0);
        
        // Clear localStorage
        localStorage.setItem(`seats_${id}`, JSON.stringify(newAssignments));
        localStorage.removeItem(`chips_${playerId}_${id}`);
        
        // Wait for server notification so other players see the seat vacated
        try {
          const response = await api.post('/api/games/seats/stand', { tableId: id, seatNumber: seatToVacate, playerId });
          if (!response.ok) {
            console.warn(`Failed to notify server of seat vacation: ${response.status} ${response.error}`);
          }
        } catch (fetchErr) {
          console.warn('Failed to notify server of seat vacation:', fetchErr);
        }
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
  
  // Where each seated player sits on the felt, for overlays drawn over the seats
  const seatAnchors = getRotatedSeatPositions()
    .map(s => ({ playerId: seatAssignments[s.seatNumber]?.playerId || '', left: String(s.style.left), top: String(s.style.top) }))
    .filter(a => a.playerId);

  if (privateTableBlocked) return <PrivateTableNotice />;

  return (
    <div className="game-page min-h-screen overflow-x-clip">
      <ShortcutHelpOverlay open={shortcuts.helpOpen} onClose={() => shortcuts.setHelpOpen(false)} />
      {/* Screen readers hear turns, actions, board cards and results */}
      <TableAnnouncer
        gameState={gameStarted ? pokerGameState : null}
        viewerId={playerId}
        nameOf={(pid) => getPlayerLabel(pid) || 'A player'}
        formatAmount={(amount) => (showStackInBB ? formatChips(amount, pokerGameState?.bigBlind || null, true) : `$${amount}`)}
      />
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
      {/* Table bar: where you are on the left, what you can do on the right */}
      <header className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/80 backdrop-blur-md dark:border-white/6 dark:bg-gray-900/75">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-2 lg:py-2.5 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/dashboard" className="btn btn-ghost btn-sm px-2! shrink-0" aria-label="Back to the lobby" title="Back to the lobby">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M12.8 5.2a1 1 0 010 1.4L9.4 10l3.4 3.4a1 1 0 01-1.4 1.4l-4.1-4.1a1 1 0 010-1.4l4.1-4.1a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold leading-tight text-gray-900 dark:text-white">{roomConfig?.name || 'Table'}</h1>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-mono tracking-wide">{id}</span>
                {roomConfig?.sb && roomConfig?.bb ? <span className="tabular-nums">· ${roomConfig.sb}/${roomConfig.bb}</span> : null}
                {gameStarted && pokerGameState && roomConfig?.variant === 'dealers-choice' && (
                  <span className="truncate font-medium text-gray-700 dark:text-gray-200">
                    · {pokerGameState.stage === 'awaiting-dealer-choice'
                      ? "Dealer's Choice"
                      : gameLabel({ variant: pokerGameState.variant, bettingMode: pokerGameState.bettingMode || 'no-limit' })}
                  </span>
                )}
              </div>
            </div>
            <div className="hidden sm:flex flex-wrap items-center gap-1.5">
            {roomConfig?.numberOfRebuys !== undefined && (
              <span className="badge">
                Rebuys: {roomConfig.numberOfRebuys === 'unlimited' ? 'Unlimited' : roomConfig.numberOfRebuys}
              </span>
            )}
            {tableExtras?.allowRunItTwice && (
              <span
                className="badge badge-violet"
                title="After an all-in, the weakest hand can choose to run the board more than once"
              >
                Run it twice
              </span>
            )}
            {tableExtras?.showAllAtShowdown && (
              <span className="badge" title="Everyone still in at a showdown shows their cards; nobody mucks">
                Cards shown at showdown
              </span>
            )}
            <GameRulesBadges state={pokerGameState} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 max-sm:justify-between max-sm:gap-0">
            {currentPlayerSeat && (
              <button
                onClick={standUp}
                className="btn btn-ghost btn-sm max-sm:px-2!"
                title={`Stand up from seat ${currentPlayerSeat}`}
                aria-label="Stand up from seat"
              >
                <svg className="w-4 h-4 shrink-0 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
                <span className="whitespace-nowrap max-sm:sr-only">Stand up</span>
              </button>
            )}
            <a
              href={`/history?room=${encodeURIComponent(tableId)}`}
              className="btn btn-ghost btn-sm max-sm:px-2!"
              title="Hand history"
            >
              <svg className="h-4 w-4 sm:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8M3 3v5h5M12 7v5l3 2" /></svg>
              <span className="max-sm:sr-only">Hand history</span>
            </a>
            {gameStarted && me && tableExtras?.allowStraddle && !isStudVariant() && (pokerGameState?.players?.length || 0) >= 3 && (
              <button
                onClick={toggleStraddle}
                className={`btn btn-sm ${me.wantsStraddle ? 'btn-warning' : 'btn-ghost'}`}
                title="Post twice the big blind under the gun next hand (only if you are under the gun)"
                aria-pressed={!!me.wantsStraddle}
              >
                {me.wantsStraddle ? 'Straddling next hand' : 'Straddle next hand'}
              </button>
            )}
            {(myHandLive || me?.leaveAfterHand) && (
              <button
                onClick={() => setSeatOption('leave-after-hand', !me.leaveAfterHand)}
                disabled={seatOptionPending}
                className={`btn btn-sm ${me.leaveAfterHand ? 'btn-warning' : 'btn-ghost'}`}
                title={me.leaveAfterHand ? 'You will stand up when this hand ends; click to stay' : 'Finish this hand, then stand up'}
                aria-pressed={!!me.leaveAfterHand}
              >
                <svg className="h-4 w-4 sm:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg><span className="max-sm:sr-only">{me.leaveAfterHand ? 'Leaving after this hand' : 'Leave after this hand'}</span>
              </button>
            )}
            {gameStarted && me && (
              <button
                onClick={toggleSitOut}
                disabled={sitOutPending}
                className={`btn btn-sm ${me.isSittingOut ? 'btn-primary' : 'btn-ghost'}`}
                title={pokerGameState?.tournamentRules
                  ? (me.isSittingOut ? 'You are away: your blinds and antes are posted and your hands folded until you come back' : 'Step away: your blinds and antes are still posted and your hands folded for you')
                  : (me.isSittingOut ? 'You are sitting out; you will be dealt in from the next hand' : 'Keep your seat but skip hands from the next one')}
                aria-pressed={!!me.isSittingOut}
              >
                {me.isSittingOut ? "I'm back" : <><svg className="h-4 w-4 sm:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 8h1a4 4 0 010 8h-1M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8zM6 2v2M10 2v2M14 2v2" /></svg><span className="max-sm:sr-only">Sit out</span></>}
              </button>
            )}
            {gameStarted && me && (
              <>
                <button
                  onClick={() => turnAlerts.setSoundEnabled(!turnAlerts.soundEnabled)}
                  className="btn btn-ghost btn-sm px-2!"
                  title={turnAlerts.soundEnabled ? 'Turn off the sound when it is your turn' : 'Play a sound when it is your turn'}
                  aria-label={turnAlerts.soundEnabled ? 'Sound on' : 'Sound off'}
                  aria-pressed={turnAlerts.soundEnabled}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M11 5L6 9H3v6h3l5 4V5z" />
                    {turnAlerts.soundEnabled
                      ? <path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" />
                      : <path d="M16 9l5 6M21 9l-5 6" />}
                  </svg>
                </button>
                {turnAlerts.notifyPermission !== 'unsupported' && turnAlerts.notifyPermission !== 'denied' && (
                  <button
                    onClick={() => turnAlerts.setNotifyEnabled(!turnAlerts.notifyEnabled)}
                    className={`btn btn-ghost btn-sm px-2! ${turnAlerts.notifyEnabled ? 'text-emerald-500! dark:text-emerald-300!' : ''}`}
                    title="Get a browser notification when it is your turn and you are in another tab or app"
                    aria-label={turnAlerts.notifyEnabled ? 'Alerts on' : 'Alert me'}
                    aria-pressed={turnAlerts.notifyEnabled}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />
                    </svg>
                  </button>
                )}
              </>
            )}
            <span className="mx-1 h-5 w-px shrink-0 bg-gray-200 dark:bg-white/10 max-sm:hidden sm:ml-auto" aria-hidden="true" />
            {canStartGame() && !gameStarted && !tableExtras?.closed && (
              <button
                onClick={handleStartGame}
                className="btn btn-primary btn-sm"
                title={`Start the game with ${getSeatedPlayersCount()} players`}
                aria-label="Start game"
              >
                <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                <span className="whitespace-nowrap">Start Game ({getSeatedPlayersCount()})</span>
              </button>
            )}
            <button
              onClick={handleLeaveGame}
              className="btn btn-ghost btn-sm max-sm:px-2! text-red-600 hover:text-red-500! dark:text-red-400 dark:hover:text-red-300! dark:hover:bg-red-500/10!"
              title="Leave this game and return to dashboard"
              aria-label="Leave game"
            >
              <svg className="w-4 h-4 shrink-0 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="whitespace-nowrap max-sm:sr-only">Leave</span>
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 pt-2 pb-6 sm:py-8 lg:pt-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 lg:grid-flow-row-dense gap-6">
          {seatNotice && (
            <div className="lg:col-span-3 flex items-center justify-between gap-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 rounded-lg p-3 text-sm text-blue-900 dark:text-blue-100" role="status">
              <span>{seatNotice}</span>
              <button onClick={() => setSeatNotice(null)} className="text-xs underline">Dismiss</button>
            </div>
          )}
          {tableExtras && userRole !== 'guest' && (
            <WaitlistPanel
              extras={tableExtras}
              playerId={playerId}
              isSeated={isSeated}
              tableFull={tableFull}
              canSit={!!playerId}
              onToggleWaitlist={toggleWaitlist}
              onTakeSeat={(n) => claimSeat(n)}
            />
          )}
          {gameStarted && me?.waitingForBigBlind && !me.isSittingOut && (
            <div className="lg:col-span-3 bg-sky-50 dark:bg-sky-900/30 border border-sky-300 dark:border-sky-700 rounded-lg p-3 text-sm text-sky-900 dark:text-sky-100 flex flex-col sm:flex-row sm:items-center gap-2" role="status">
              <span className="flex-1">
                {me.postBigBlindNow
                  ? `You will post a big blind (${showStackInBB ? '1 BB' : `$${pokerGameState?.bigBlind}`}) and be dealt in next hand.`
                  : 'You will be dealt in when the big blind reaches your seat, or post a big blind to play the next hand.'}
              </span>
              <button
                onClick={() => setSeatOption('post-big-blind-now', !me.postBigBlindNow)}
                disabled={seatOptionPending}
                className="bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium px-3 py-1.5 rounded-lg whitespace-nowrap"
                aria-pressed={!!me.postBigBlindNow}
              >
                {me.postBigBlindNow ? 'Wait for the big blind instead' : 'Post big blind now'}
              </button>
            </div>
          )}
          {tableExtras?.closed && (
            <div className="lg:col-span-3 bg-gray-800 text-white rounded-lg p-3 text-center" role="status">
              <span className="font-semibold">The host closed this table.</span> No more hands will be dealt.{' '}
              <Link href="/dashboard" className="underline font-semibold">Back to the lobby</Link>
            </div>
          )}
          {gameStarted && tableWaitNotice && !tableExtras?.closed && pokerGameState?.stage === 'showdown' && (
            <div className="lg:col-span-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg p-3 text-sm text-amber-900 dark:text-amber-100" role="status">
              {tableWaitNotice}
            </div>
          )}
          {gameStarted && pokerGameState?.paused && (
            <div className="lg:col-span-3 bg-gray-800 text-white rounded-lg p-3 text-center font-semibold" role="status">
              The host has paused the game.
            </div>
          )}
          {gameStarted && (pokerGameState?.handKind === 'bomb-pot' || pokerGameState?.bombPotNext) && pokerGameState?.stage !== 'showdown' && (
            <div className="lg:col-span-3 bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700 rounded-lg p-3 text-sm text-orange-900 dark:text-orange-100" role="status">
              {pokerGameState?.handKind === 'bomb-pot'
                ? 'Bomb pot! Everyone anted and the betting starts on the flop.'
                : `Next hand is a bomb pot (${pokerGameState.bombPotNext.anteBB} big blind ante).`}
            </div>
          )}
          {gameStarted && <SevenDeuceBountyBanner state={pokerGameState} />}
          {/* Dealer's Choice selection banner */}
          {gameStarted && awaitingDealerChoice && (
            <div ref={dealerChoicePanelRef} className="lg:col-span-2 scroll-mt-20 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 rounded-lg shadow-md p-4">
              {(() => {
                const dealerId = awaitingDealerChoice?.dealerId;
                const allowed = Array.isArray(awaitingDealerChoice?.allowedVariants)
                  ? awaitingDealerChoice!.allowedVariants!
                  : [...ALL_VARIANTS];
                const isMeDealer = dealerId && dealerId === playerId;
                const labelMap: Record<string, string> = VARIANT_LABELS;
                if (isMeDealer) {
                  return (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-block px-2 py-0.5 text-xs rounded-sm bg-amber-600 text-white">Dealer&apos;s Choice</span>
                        <h3 className="text-lg font-semibold">Choose the variant for this hand</h3>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-2">
                        {allowed.map(v => (
                          <label key={v} className={`px-3 py-1.5 rounded-sm border text-sm cursor-pointer select-none ${selectedVariantDC === v ? 'bg-amber-600 text-white border-amber-500' : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-amber-300 dark:border-amber-600'}`}> 
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
                              const response = await api.post('/api/games/next-hand', { tableId: id, playerId, variant: selectedVariantDC });
                              if (!response.ok) {
                                console.warn('Dealer choice failed:', response.error);
                              }
                            } catch (err) {
                              console.warn('Dealer choice failed:', err);
                            }
                          }}
                          className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-sm shadow-sm"
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
                        <span className="inline-block px-2 py-0.5 text-xs rounded-sm bg-amber-600 text-white">Dealer&apos;s Choice</span>
                        <h3 className="text-lg font-semibold">Waiting for dealer to choose variant…</h3>
                      </div>
                      <div className="text-sm mt-1 opacity-80">Allowed: {allowed.map(v => labelMap[v] || v).join(', ')}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {/* Poker Table - Green Felt Design; on wide screens the reaction row sits beside your seat.
              The margin under the felt leaves room for the bottom seat's avatar, which hangs below it */}
          <div className="lg:col-span-2 relative">
            {/* Green felt table surface */}
            <div className="table-rail relative rounded-full mx-auto mb-12 max-sm:mt-7"
                 style={{
                   width: '100%',
                   maxWidth: '820px',
                   height: '400px',
                 }}>
              {/* Inner felt playing surface */}
              <div className="table-felt absolute inset-[14px] rounded-full">
                <SplashAnimation
                  splash={splashInPlay(pokerGameState)}
                  playerName={pokerGameState?.lastSplash ? getPlayerLabel(pokerGameState.lastSplash.playerId) : null}
                  formatAmount={(n) => showStackInBB ? formatChips(n, pokerGameState?.bigBlind || null, true) : `$${n}`}
                />
                
                {/* Player positions - evenly spaced around table */}
                {getRotatedSeatPositions().map((seatData) => 
                  renderSeat(seatData.seatNumber, seatData.position, seatData.style)
                )}
                
                {/* Community cards, or one row per run when the board is run more than once */}
                {runItTwiceBoards.length > 1 ? (
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 -mt-6 flex flex-col items-center gap-1" aria-label="Run it twice boards">
                    {runItTwiceBoards.map((board: any[], run: number) => (
                      <div key={`run-${run}`} className="flex items-center gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-amber-200 font-semibold drop-shadow-sm w-10 text-right">Run {run + 1}</span>
                        {board.map((card: any, index: number) => (
                          <TableCard key={index} card={card} size="xs" highContrast={highContrastCards} className="table-card-flip" />
                        ))}
                        {/* Spaces for cards still to come on this run */}
                        {Array.from({ length: Math.max(0, 5 - board.length) }, (_, i) => (
                          <div key={`empty-${i}`} className="w-7 h-10 rounded-sm border border-dashed border-white/40" />
                        ))}
                      </div>
                    ))}
                  </div>
                ) : pokerGameState?.communityCards && pokerGameState.communityCards.length > 0 && (
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 -mt-7 flex gap-1.5 max-sm:gap-1">
                    {pokerGameState.communityCards.map((card: any, index: number) => (
                      <TableCard key={index} card={card} size="md" highContrast={highContrastCards} className="table-card-flip" style={{ animationDelay: `${index < 3 ? index * 90 : 0}ms` }} />
                    ))}
                  </div>
                )}

                {/* Pot area - positioned below the community cards */}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 mt-12 max-sm:mt-10 text-white text-center">
                  <div className="inline-flex items-center gap-1.5 bg-black/35 ring-1 ring-white/10 backdrop-blur-xs px-3 py-1 rounded-full text-sm font-semibold tabular-nums">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Pot</span>
                    {showStackInBB 
                      ? formatChips(pokerGameState?.pot || 0, pokerGameState?.bigBlind || null, true)
                      : `$${pokerGameState?.pot || 0}`
                    }
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
                    // Face-down cards sit a little lower, so it's clear which cards the others can't see
                    const all = studCardOrder(
                      down.map((card: any) => ({ ...card, hidden: true })),
                      up.map((card: any) => ({ ...card, hidden: false })),
                    );
                    return (
                      <div key={`my-cards-${pokerGameState?.handId ?? pokerGameState?.handNumber ?? ''}`} className={`absolute ${getCurrentPlayerCardsPosition()} flex gap-1 z-20 ${isFolded ? 'opacity-60 grayscale' : ''} ${actionPanelOpen ? 'max-sm:hidden' : ''}`}>
                        {all.map((card: any, i: number) => (
                          <TableCard key={`me-card-${i}`} card={card} size="sm" highContrast={highContrastCards} style={{ animationDelay: `${Math.min(i, 2) * 80}ms` }} className={`table-card-deal ${card.hidden ? 'top-2' : ''}`} title={card.hidden ? 'Face down: only you can see this card' : undefined} />
                        ))}
                      </div>
                    );
                  }

                  // Hold'em/Omaha: show hole cards
                  const holes = getCurrentPlayerCards();
                  if (!holes || holes.length === 0) return null;
                  return (
                    <div key={`my-cards-${pokerGameState?.handId ?? pokerGameState?.handNumber ?? ''}`} className={`absolute ${getCurrentPlayerCardsPosition()} flex gap-1 z-20 ${isFolded ? 'opacity-60 grayscale' : ''} ${actionPanelOpen ? 'max-sm:hidden' : ''}`}>
                      {holes.map((card: any, index: number) => (
                        <TableCard key={index} card={card} size="lg" highContrast={highContrastCards} className={`table-card-deal ring-2 ring-emerald-400/60 ${holes.length > 2 && index > 0 ? '-ml-4 max-sm:-ml-5' : ''}`} style={{ animationDelay: `${index * 80}ms`, ...fanStyle(index, holes.length) }} />
                      ))}
                    </div>
                  );
                })()}
                
                <TableChipAnimations anchors={seatAnchors} gameState={gameStarted ? pokerGameState : null} />
                <SeatReactionBubbles anchors={seatAnchors} bubbles={reactions.bubbles} nameOf={(pid) => getPlayerLabel(pid) || 'A player'} />
              </div>
            </div>
            {playerId && (isSeated || amInGame) && (
              <ReactionPicker
                onReact={reactions.send}
                coolingDown={reactions.coolingDown}
                muted={reactions.muted}
                onToggleMuted={reactions.setMuted}
              />
            )}
          </div>

          {/* Poker Action Panel (only before showdown); hide if only one non-folded remains */}
          {gameStarted && pokerGameState && pokerGameState.stage !== 'showdown' && getActiveNonFoldedPlayers().length > 1 && pokerGameState.activePlayer === playerId && !runItTwicePrompt && (
            <div className="lg:col-span-2 surface max-sm:bg-gray-50! max-sm:dark:bg-gray-800! p-4 sm:p-5 mt-4 ring-1 ring-emerald-400/25 max-sm:sticky max-sm:bottom-0 max-sm:z-30 max-sm:-mx-4 max-sm:rounded-none max-sm:max-h-[60vh] max-sm:overflow-y-auto max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))] max-sm:shadow-[0_-4px_12px_rgba(0,0,0,0.25)]">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-base font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                  Your turn
                  <TimeBankBadge count={me?.timeBanks} seconds={pokerGameState?.timeBankSeconds} />
                </h3>
                <div className="flex gap-1 sm:hidden" aria-hidden="true">
                  {(isStudVariant() ? (() => { const c = getStudCardsForPlayer(playerId); return studCardOrder(c.down.map((card: any) => ({ ...card, hidden: true })), c.up); })() : (getCurrentPlayerCards() || [])).map((card: any, i: number) => (
                    <TableCard key={i} card={card} size="xs" highContrast={highContrastCards} className={card.hidden ? 'top-1' : ''} />
                  ))}
                </div>
                {/* The pot is on the felt, so phones skip this line to keep the sheet short */}
                <div className="ml-auto flex flex-wrap justify-end gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400 tabular-nums max-sm:hidden">
                  <span>Current bet <span className="font-semibold text-gray-800 dark:text-gray-200">{showStackInBB
                    ? formatChips(pokerGameState.currentBet || 0, pokerGameState?.bigBlind || null, true)
                    : `$${pokerGameState.currentBet || 0}`}</span></span>
                  <span>Pot <span className="font-semibold text-gray-800 dark:text-gray-200">{showStackInBB
                    ? formatChips(pokerGameState.pot || 0, pokerGameState?.bigBlind || null, true)
                    : `$${pokerGameState.pot || 0}`}</span></span>
                  <span>Your stack <span className="font-semibold text-gray-800 dark:text-gray-200">{(() => {
                    const myStack = pokerGameState.players.find((p: any) => p.id === playerId)?.stack || 0;
                    return showStackInBB
                      ? formatChips(myStack, pokerGameState?.bigBlind || null, true)
                      : `$${myStack}`;
                  })()}</span></span>
                </div>
                <button
                  type="button"
                  onClick={() => shortcuts.setHelpOpen(true)}
                  className="hidden sm:inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 text-xs text-gray-500 hover:text-gray-700 dark:border-white/10 dark:text-gray-400 dark:hover:text-gray-200"
                  title="Show keyboard shortcuts"
                  aria-label="Show keyboard shortcuts"
                >
                  <kbd className="font-mono">?</kbd>
                </button>
              </div>
              {shortcuts.allInArmed && (
                <div className="mb-2 rounded-sm bg-yellow-100 px-2 py-1 text-sm font-semibold text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-100" role="status">
                  Press A again to go all-in, or Esc to cancel.
                </div>
              )}
              <TurnClockBar clock={turnClock} />
              {showHandValue && (() => {
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
                  <div className="mb-3 text-sm text-gray-700 dark:text-gray-200">Your hand: <span className="font-semibold text-gray-900 dark:text-gray-100">{summary.primary}</span></div>
                ) : null;
              })()}
              {/* Pot Odds Display */}
              {renderPotOdds()}
              {!myBringInPending && !(pokerGameState?.splashUsedBy || []).includes(playerId) && (
                <div className="mb-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSplashArmed(a => !a)}
                    aria-pressed={splashArmed}
                    className={`btn btn-sm ${splashArmed ? 'bg-amber-500 text-white hover:bg-amber-600' : 'btn-ghost'}`}
                    title="Your next bet or raise lands with chips raining onto the table. Once per session."
                  >
                    {splashArmed ? 'Splash ready' : 'Splash the pot'}
                  </button>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {splashArmed ? 'Your next bet or raise splashes the pot.' : 'Once per session.'}
                  </span>
                </div>
              )}
              {showHandValue && myLastCardOdds && (
                <div className="mb-3 text-sm text-gray-700 dark:text-gray-200" aria-label="Chance to improve">{myLastCardOdds}</div>
              )}
              {myBringInPending ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    You have the {pokerGameState?.variant === 'razz' ? 'highest' : 'lowest'} up card, so you open the betting. Bring it in, or complete to a full bet.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handlePokerAction('bring-in')}
                      className="btn btn-lg act-call max-sm:min-h-[48px] max-sm:text-base w-[calc(25%-0.5rem)] sm:w-[calc(30%-0.375rem)]"
                    >
                      Bring in {showStackInBB ? formatChips(bringInAmount, pokerGameState?.bigBlind || null, true) : `$${bringInAmount}`}
                    </button>
                    {completeAmount > bringInAmount && (
                      <button
                        onClick={() => handlePokerAction('bet', completeAmount)}
                        className="btn btn-lg act-raise max-sm:flex-1 max-sm:min-h-[48px] max-sm:text-base"
                      >
                        Complete to {showStackInBB ? formatChips(completeAmount, pokerGameState?.bigBlind || null, true) : `$${completeAmount}`}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
              <div className="relative flex flex-wrap gap-2">
                <button
                  onClick={handleFold}
                  className="btn btn-lg act-fold max-sm:min-h-[48px] max-sm:text-base w-[calc(25%-0.5rem)] sm:w-[calc(30%-0.375rem)]"
                >
                  Fold
                </button>
                
                {myOwed === 0 ? (
                  <button
                    onClick={handleCheck}
                    className="btn btn-lg act-neutral max-sm:min-h-[48px] max-sm:text-base w-[calc(25%-0.5rem)] sm:w-[calc(30%-0.375rem)]"
                  >
                    Check
                  </button>
                ) : (
                  <button
                    onClick={handleCall}
                    className="btn btn-lg act-call max-sm:min-h-[48px] max-sm:text-base w-[calc(25%-0.5rem)] sm:w-[calc(30%-0.375rem)]"
                  >
                    Call {showStackInBB ? formatChips(myCallAmount, pokerGameState?.bigBlind || null, true) : `$${myCallAmount}`}{myCallIsAllIn ? ' (all-in)' : ''}
                  </button>
                )}
                
                {/* No-Limit betting controls */}
                {((pokerGameState?.bettingMode || 'no-limit') === 'no-limit') && (
                  (pokerGameState.currentBet || 0) === 0 ? (
                    <div className="flex flex-col gap-2 surface-muted p-3 w-full order-first sm:mb-1 max-sm:border-0! max-sm:bg-transparent! max-sm:p-0!">
                      <div className="sr-only">Bet amount</div>
                      {(() => {
                        const { min, max } = getBetBounds();
                        const bb = Number(pokerGameState.bigBlind || 0) || 0;
                        const pot = Number(pokerGameState.pot || 0) || 0;
                        return (
                          <>
                            <BetSlider min={min} max={max} step={betSliderStep(pokerGameState.smallBlind, pokerGameState.bigBlind)} value={clamp(betInput, min, max)} onChange={setBetInput} />
                            {showStackInBB && bb > 0 && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">{formatChips(clamp(betInput, min, max), bb, true)}</div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="number"
                                min={min}
                                max={max}
                                step={0.01}
                                value={Number(clamp(betInput, min, max)).toFixed(2)}
                                onChange={e => setBetInput(clamp(parseFloat(e.target.value || '0'), min, max))}
                                className="input w-28 max-sm:w-full tabular-nums"
                                data-shortcut-amount="true"
                              />
                              <BetPresetButtons
                                kind="bet"
                                bettingMode={pokerGameState?.bettingMode}
                                pot={pot}
                                currentBet={Number(pokerGameState.currentBet || 0) || 0}
                                myBet={Number(getMe()?.currentBet || 0)}
                                min={min}
                                max={max}
                                bigBlind={bb}
                                value={clamp(betInput, min, max)}
                                lastBet={lastBet}
                                onChange={setBetInput}
                              />
                              {(() => {
                                const me = getMe();
                                const prev = Number(me?.currentBet || 0);
                                const stack = Number(me?.stack || 0);
                                const sel = clamp(betInput, min, max);
                                const isAllIn = Math.abs(sel - max) < 0.005;
                                const add = Math.max(0, sel - prev);
                                const onClick = () => handleBet(Number(sel.toFixed(2)));
                                const bbVal = pokerGameState?.bigBlind || null;
                                const label = isAllIn ? `All-in ${showStackInBB ? formatChips(stack, bbVal, true) : `$${stack.toFixed(2)}`}` : `Bet ${showStackInBB ? formatChips(add, bbVal, true) : `$${add.toFixed(2)}`}`;
                                return (
                                  <button onClick={onClick} data-shortcut-submit="true" className="max-sm:min-h-[48px] btn btn-lg act-raise absolute bottom-0 right-0 w-1/2 sm:w-[40%]">
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
                    <div className="flex flex-col gap-2 surface-muted p-3 w-full order-first sm:mb-1 max-sm:border-0! max-sm:bg-transparent! max-sm:p-0!">
                      <div className="text-sm text-gray-700 dark:text-gray-300 font-medium">Raise to</div>
                      {(() => {
                        const { min, max } = getRaiseBounds();
                        const bb = Number(pokerGameState.bigBlind || 0) || 0;
                        const pot = Number(pokerGameState.pot || 0) || 0;
                        const curr = Number(pokerGameState.currentBet || 0) || 0;
                        return (
                          <>
                            <BetSlider min={min} max={max} step={betSliderStep(pokerGameState.smallBlind, pokerGameState.bigBlind)} value={clamp(raiseInput, min, max)} onChange={setRaiseInput} />
                            {showStackInBB && bb > 0 && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">{formatChips(clamp(raiseInput, min, max), bb, true)}</div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="number"
                                min={min}
                                max={max}
                                step={0.01}
                                value={Number(clamp(raiseInput, min, max)).toFixed(2)}
                                onChange={e => setRaiseInput(clamp(parseFloat(e.target.value || '0'), min, max))}
                                className="input w-28 max-sm:w-full tabular-nums"
                                data-shortcut-amount="true"
                              />
                              <BetPresetButtons
                                kind="raise"
                                bettingMode={pokerGameState?.bettingMode}
                                pot={pot}
                                currentBet={curr}
                                myBet={Number(getMe()?.currentBet || 0)}
                                min={min}
                                max={max}
                                bigBlind={bb}
                                value={clamp(raiseInput, min, max)}
                                lastBet={lastBet}
                                onChange={setRaiseInput}
                              />
                              {(() => {
                                const me = getMe();
                                const prev = Number(me?.currentBet || 0);
                                const stack = Number(me?.stack || 0);
                                const sel = clamp(raiseInput, min, max);
                                const isAllIn = Math.abs(sel - max) < 0.005;
                                const add = Math.max(0, sel - prev);
                                const onClick = () => handleRaise(Number(sel.toFixed(2)));
                                const bbVal = pokerGameState?.bigBlind || null;
                                const amt = (n: number) => showStackInBB ? formatChips(n, bbVal, true) : formatDollars(n);
                                return (
                                  <button onClick={onClick} data-shortcut-submit="true" className="max-sm:min-h-[48px] btn btn-lg act-raise absolute bottom-0 right-0 w-1/2 sm:w-[40%]">
                                    {/* Phones skip the amount added: it's in the box above, and the button is half the screen */}
                                    {isAllIn ? `All-in ${amt(stack)}` : <>Raise to {amt(sel)}<span className="max-sm:hidden"> (+{amt(add)})</span></>}
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

                {pokerGameState?.bettingMode === 'fixed-limit' && playerId && (
                  <FixedLimitControls state={pokerGameState} playerId={playerId} onBet={handleBet} onRaise={handleRaise} showStackInBB={showStackInBB} />
                )}

                {/* Pot-Limit betting controls */}
                {((pokerGameState?.bettingMode || 'no-limit') === 'pot-limit') && (
                  (pokerGameState.currentBet || 0) === 0 ? (
                    <div className="flex flex-col gap-2 surface-muted p-3 w-full order-first sm:mb-1 max-sm:border-0! max-sm:bg-transparent! max-sm:p-0!">
                      <div className="text-sm text-gray-700 dark:text-gray-300 font-medium">Bet amount (Pot-Limit)</div>
                      {(() => {
                        const { min, max } = getPotLimitBetBounds();
                        const bb = Number(pokerGameState.bigBlind || 0) || 0;
                        const pot = Number(pokerGameState.pot || 0) || 0;
                        return (
                          <>
                            <BetSlider min={min} max={max} step={betSliderStep(pokerGameState.smallBlind, pokerGameState.bigBlind)} value={clamp(betInput, min, max)} onChange={setBetInput} />
                            {showStackInBB && bb > 0 && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">{formatChips(clamp(betInput, min, max), bb, true)}</div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="number"
                                min={min}
                                max={max}
                                step={0.01}
                                value={Number(clamp(betInput, min, max)).toFixed(2)}
                                onChange={e => setBetInput(clamp(parseFloat(e.target.value || '0'), min, max))}
                                className="input w-28 max-sm:w-full tabular-nums"
                                data-shortcut-amount="true"
                              />
                              <BetPresetButtons
                                kind="bet"
                                bettingMode={pokerGameState?.bettingMode}
                                pot={pot}
                                currentBet={Number(pokerGameState.currentBet || 0) || 0}
                                myBet={Number(getMe()?.currentBet || 0)}
                                min={min}
                                max={max}
                                bigBlind={bb}
                                value={clamp(betInput, min, max)}
                                lastBet={lastBet}
                                onChange={setBetInput}
                              />
                              {(() => {
                                const me = getMe();
                                const prev = Number(me?.currentBet || 0);
                                const sel = clamp(betInput, min, max);
                                const add = Math.max(0, sel - prev);
                                const onClick = () => handleBet(Number(sel.toFixed(2)));
                                const bbVal = pokerGameState?.bigBlind || null;
                                const label = `Bet ${showStackInBB ? formatChips(add, bbVal, true) : `$${add.toFixed(2)}`}`;
                                return (
                                  <button onClick={onClick} data-shortcut-submit="true" className="max-sm:min-h-[48px] btn btn-lg act-raise absolute bottom-0 right-0 w-1/2 sm:w-[40%]">
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
                    <div className="flex flex-col gap-2 surface-muted p-3 w-full order-first sm:mb-1 max-sm:border-0! max-sm:bg-transparent! max-sm:p-0!">
                      <div className="text-sm text-gray-700 dark:text-gray-300 font-medium">Raise to (Pot-Limit)</div>
                      {(() => {
                        const { min, max } = getPotLimitRaiseBounds();
                        const bb = Number(pokerGameState.bigBlind || 0) || 0;
                        const pot = Number(pokerGameState.pot || 0) || 0;
                        const curr = Number(pokerGameState.currentBet || 0) || 0;
                        return (
                          <>
                            <BetSlider min={min} max={max} step={betSliderStep(pokerGameState.smallBlind, pokerGameState.bigBlind)} value={clamp(raiseInput, min, max)} onChange={setRaiseInput} />
                            {showStackInBB && bb > 0 && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">{formatChips(clamp(raiseInput, min, max), bb, true)}</div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="number"
                                min={min}
                                max={max}
                                step={0.01}
                                value={Number(clamp(raiseInput, min, max)).toFixed(2)}
                                onChange={e => setRaiseInput(clamp(parseFloat(e.target.value || '0'), min, max))}
                                className="input w-28 max-sm:w-full tabular-nums"
                                data-shortcut-amount="true"
                              />
                              <BetPresetButtons
                                kind="raise"
                                bettingMode={pokerGameState?.bettingMode}
                                pot={pot}
                                currentBet={curr}
                                myBet={Number(getMe()?.currentBet || 0)}
                                min={min}
                                max={max}
                                bigBlind={bb}
                                value={clamp(raiseInput, min, max)}
                                lastBet={lastBet}
                                onChange={setRaiseInput}
                              />
                              {(() => {
                                const me = getMe();
                                const prev = Number(me?.currentBet || 0);
                                const sel = clamp(raiseInput, min, max);
                                const add = Math.max(0, sel - prev);
                                const onClick = () => handleRaise(Number(sel.toFixed(2)));
                                const bbVal = pokerGameState?.bigBlind || null;
                                const amt = (n: number) => showStackInBB ? formatChips(n, bbVal, true) : formatDollars(n);
                                return (
                                  <button onClick={onClick} data-shortcut-submit="true" className="max-sm:min-h-[48px] btn btn-lg act-raise absolute bottom-0 right-0 w-1/2 sm:w-[40%]">
                                    {/* Phones skip the amount added: it's in the box above, and the button is half the screen */}
                                    Raise to {amt(sel)}<span className="max-sm:hidden"> (+{amt(add)})</span>
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
              )}

            </div>
          )}

          {/* Run It Twice decision panel for the selected player */}
          {gameStarted && pokerGameState && runItTwicePrompt && canVoteRunIt && !pokerGameState.runItTwice?.enabled && (
            <div className="lg:col-span-2 bg-purple-50 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-600 rounded-lg shadow-md p-4 mt-4" aria-live="polite">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-block px-2 py-0.5 text-xs rounded-sm bg-purple-600 text-white">RIT</span>
                  <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-100">Run It Twice Vote</h3>
                </div>
                <span className="text-xs uppercase tracking-wide text-purple-700 dark:text-purple-300">Hand paused</span>
              </div>
              <div className="mt-3 text-sm text-purple-900 dark:text-purple-100 space-y-2">
                <p>Everyone still in votes on how the board finishes. It runs more than once only if everyone agrees; a vote for a single run, or the clock running out, means one run.</p>
                {runItTwiceHighestHandDescription && (
                  <p className="text-[13px] text-purple-800 dark:text-purple-200">
                    Current best: <span className="font-semibold">{runItTwiceHighestHandDescription}</span>
                  </p>
                )}
                {runItWaitingNames.length > 1 && (
                  <p className="text-[12px] text-purple-700 dark:text-purple-200">Still to vote: {runItWaitingNames.join(', ')}.</p>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => enableRunItTwice(1)}
                  className="px-3 py-1.5 rounded-sm text-xs font-semibold bg-gray-200 hover:bg-gray-300 text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-purple-400"
                >Keep single run</button>
                {RUN_IT_TWICE_DECISIONS_ENABLED && (() => {
                  const activeCount = getActiveNonFoldedPlayers().length;
                  const maxRuns = Math.max(2, Math.max(1, activeCount));
                  return Array.from({ length: Math.max(0, maxRuns - 1) }, (_, i) => i + 2).map(r => (
                    <button
                      key={`rit-${r}`}
                      onClick={() => enableRunItTwice(r)}
                      className="px-3 py-1.5 rounded-sm text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white shadow-sm focus:outline-hidden focus:ring-2 focus:ring-purple-400"
                    >Run {r === 2 ? 'Twice' : `${r}x`}</button>
                  ));
                })()}
              </div>
            </div>
          )}

          {/* Run It Twice waiting banner for other players */}
          {gameStarted && pokerGameState && runItTwicePrompt && !canVoteRunIt && !pokerGameState.runItTwice?.enabled && (
            <div className="lg:col-span-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-300 dark:border-purple-700 rounded-lg shadow-md p-4 mt-4" aria-live="polite">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-100 flex items-center gap-2">
                  <span className="inline-block px-2 py-0.5 text-xs rounded-sm bg-purple-600 text-white">RIT</span>
                  Waiting on the Run It Twice vote
                </h3>
                <span className="text-xs uppercase tracking-wide text-purple-700 dark:text-purple-300">Hand paused</span>
              </div>
              <div className="text-sm text-purple-900 dark:text-purple-100 space-y-2">
                <p>
                  Action is paused while {runItWaitingNames.length ? <span className="font-semibold">{runItWaitingNames.join(', ')}</span> : 'the table'} vote{runItWaitingNames.length === 1 ? 's' : ''} on running the board more than once.
                  {typeof myRunItVote === 'number' && ` You voted to ${myRunItVote <= 1 ? 'run it once' : myRunItVote === 2 ? 'run it twice' : `run it ${myRunItVote} times`}.`}
                </p>
                {runItTwiceHighestHandDescription && (
                  <p className="text-[13px] text-purple-800 dark:text-purple-200">
                    Current best hand: <span className="font-semibold">{runItTwiceHighestHandDescription}</span>
                  </p>
                )}
                <p className="text-[12px] text-purple-700 dark:text-purple-300">
                  It runs more than once only if everyone agrees. Once the vote is settled, the remaining boards are dealt automatically.
                </p>
              </div>
            </div>
          )}

          {/* Game Status Display (only before showdown); hide if only one non-folded remains; hide during Run-It-Twice prompt */}
          {gameStarted && pokerGameState && pokerGameState.stage !== 'showdown' && getActiveNonFoldedPlayers().length > 1 && pokerGameState.activePlayer !== playerId && !runItTwicePrompt && (
            <div className="lg:col-span-2 surface p-4 sm:p-5 mt-4 max-sm:sticky max-sm:bottom-0 max-sm:z-30 max-sm:-mx-4 max-sm:rounded-none max-sm:bg-gray-50! max-sm:dark:bg-gray-800! max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))] max-sm:shadow-[0_-4px_12px_rgba(0,0,0,0.25)]">
              {/* On phones this pins to the bottom as a slim bar: heading and tiles give way to the pre-actions */}
              <div className="flex items-center justify-between mb-3 max-sm:hidden">
                <h3 className="section-title">Game status</h3>
              </div>
              {me && !me.isFolded && !me.isAllIn && (
                <div className="mb-3">
                  <PreActionBar
                    owed={myOwed}
                    stack={Number(me?.stack) || 0}
                    selected={preAction}
                    onSelect={setPreAction}
                    formatAmount={(amount) => showStackInBB ? formatChips(amount, pokerGameState?.bigBlind || null, true) : `$${amount}`}
                  />
                </div>
              )}
              <TurnClockBar clock={turnClock} />
              <div className="text-sm text-gray-600 dark:text-gray-300">
                <p className="mb-3 max-sm:mb-0 text-gray-700 dark:text-gray-200">
                  Waiting for <span className="font-semibold text-gray-900 dark:text-white">{pokerGameState.players.find((p: any) => p.id === pokerGameState.activePlayer)?.name || 'player'}</span> to act…
                </p>
                {(() => {
                  const fmt = (n: number) => (showStackInBB ? formatChips(n, pokerGameState?.bigBlind || null, true) : `$${n}`);
                  const summary = getMyHandSummary();
                  const isHiLo = pokerGameState?.variant === 'omaha-hi-lo' || pokerGameState?.variant === 'seven-card-stud-hi-lo';
                  const tiles: Array<{ label: string; value: React.ReactNode }> = [
                    { label: 'Current bet', value: fmt(pokerGameState.currentBet || 0) },
                    { label: 'Pot', value: fmt(pokerGameState.pot || 0) },
                  ];
                  if (!showHandValue) {
                    // The player turned off naming their hand
                  } else if (isHiLo) {
                    tiles.push({ label: 'High hand', value: summary.highLabel || summary.primary || 'Waiting for more cards' });
                    tiles.push({ label: 'Low hand', value: summary.lowLabel || 'No qualifying low yet' });
                  } else if (summary.primary) {
                    tiles.push({ label: 'Your hand', value: summary.primary });
                  }
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-sm:hidden">
                      {tiles.map(t => (
                        <div key={t.label} className="surface-muted px-3 py-2.5 min-w-0">
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t.label}</div>
                          <div className="mt-0.5 truncate font-semibold tabular-nums text-gray-900 dark:text-white">{t.value}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Showdown result banner or single-remaining defensive winner */}
          {gameStarted && pokerGameState && pokerGameState.stage === 'showdown' && pokerGameState.runItTwice?.enabled && pokerGameState.runItTwice.results?.length > 0 && (
            <div className="lg:col-span-2 bg-purple-50 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 text-purple-900 dark:text-purple-100 rounded-lg shadow-md p-4 mt-4">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <span className="inline-block px-2 py-0.5 text-xs rounded-sm bg-purple-600 text-white">RIT</span>
                Run It Twice Results ({pokerGameState.runItTwice.numberOfRuns} Runs)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pokerGameState.runItTwice.results.map((res: any, idx: number) => (
                  <div key={res.boardId || idx} className="rounded-md border border-purple-300 dark:border-purple-600 bg-white dark:bg-gray-800 p-3 shadow-xs">
                    <div className="text-sm font-semibold mb-2">Board {idx + 1}</div>
                    {(() => {
                      const board = pokerGameState.runItTwice.boards?.[idx] || [];
                      return (
                        <div className="flex gap-1 mb-3">
                          {board.map((card: any, ci: number) => (
                            <div key={ci} className="bg-white dark:bg-gray-700 rounded-sm border text-[10px] p-1 w-7 h-10 flex flex-col items-center justify-center text-black dark:text-gray-100 font-bold">
                              <div className={highContrastCards ? suitColorClass(card.suit) : 'text-gray-900'}>{card.rank}</div>
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
                          <div key={w.playerId} className="text-xs flex items-center justify-between bg-purple-100 dark:bg-purple-800/40 px-2 py-1 rounded-sm">
                            <span className="font-medium">
                              {player?.name || w.playerId.slice(0,6)}
                              {w.side && <span className="ml-1 text-[10px] uppercase opacity-70">{w.side === 'both' ? 'scoops' : w.side}</span>}
                            </span>
                            <span className="text-purple-700 dark:text-purple-300 font-semibold">
                              +{showStackInBB 
                                ? formatChips(w.potShare, pokerGameState?.bigBlind || null, true)
                                : `$${w.potShare}`
                              }
                            </span>
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
                    <div key={pd.playerId} className="text-xs px-2 py-1 rounded-sm bg-purple-200 dark:bg-purple-800/60 text-purple-900 dark:text-purple-100 font-semibold">
                      {player?.name || pd.playerId.slice(0,6)}: {showStackInBB 
                        ? formatChips(pd.amount, pokerGameState?.bigBlind || null, true)
                        : `$${pd.amount}`
                      }
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Hi-Lo showdown panel (non-RIT): show high and low winners from lastHiLoResult */}
          {gameStarted && pokerGameState && (pokerGameState.stage === 'showdown' || getActiveNonFoldedPlayers().length === 1)
            && !pokerGameState.runItTwice?.enabled
            && ((pokerGameState.variant === 'omaha-hi-lo' || pokerGameState.variant === 'seven-card-stud-hi-lo') && pokerGameState.lastHiLoResult) && (
            <div className="lg:col-span-2 bg-cyan-50 dark:bg-cyan-900/30 border border-cyan-300 dark:border-cyan-700 text-cyan-900 dark:text-cyan-100 rounded-lg shadow-md p-4 mt-4">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <span className="inline-block px-2 py-0.5 text-xs rounded-sm bg-cyan-600 text-white">Hi-Lo</span>
                Showdown Results
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* High winners */}
                <div className="rounded-md border border-cyan-300 dark:border-cyan-700 bg-white dark:bg-gray-800 p-3 shadow-xs">
                  <div className="text-sm font-semibold mb-2">High Winners</div>
                  <div className="space-y-1">
                    {pokerGameState.lastHiLoResult!.high.map((h: any) => {
                      const player = pokerGameState.players.find((p: any) => p.id === h.playerId);
                      return (
                        <div key={h.playerId} className="text-xs flex items-center justify-between bg-cyan-100 dark:bg-cyan-800/40 px-2 py-1 rounded-sm">
                          <span className="font-medium">{player?.name || h.playerId.slice(0,6)}</span>
                          <span className="text-cyan-700 dark:text-cyan-300 font-semibold">+${h.amount}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* Low winners (if any) */}
                <div className="rounded-md border border-cyan-300 dark:border-cyan-700 bg-white dark:bg-gray-800 p-3 shadow-xs">
                  <div className="text-sm font-semibold mb-2">Low Winners</div>
                  {Array.isArray(pokerGameState.lastHiLoResult!.low) && pokerGameState.lastHiLoResult!.low.length > 0 ? (
                    <div className="space-y-1">
                      {pokerGameState.lastHiLoResult!.low!.map((l: any) => {
                        const player = pokerGameState.players.find((p: any) => p.id === l.playerId);
                        return (
                          <div key={l.playerId} className="text-xs flex items-center justify-between bg-cyan-100 dark:bg-cyan-800/40 px-2 py-1 rounded-sm">
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

          {/* After the hand: let a player whose cards stayed hidden show them */}
          {gameStarted && pokerGameState?.stage === 'showdown' && me && (() => {
            const myStud = pokerGameState?.studState?.playerCards?.[playerId];
            const dealtIn = (me.holeCards?.length || 0) > 0 || (myStud?.downCards?.length || 0) > 0;
            if (!dealtIn) return null;
            const contested = getActiveNonFoldedPlayers().length >= 2;
            const winners: string[] = Array.isArray(pokerGameState.handWinners) ? pokerGameState.handWinners : [];
            const alreadyShown = (pokerGameState.shownCards || []).includes(playerId)
              || (contested && !me.isFolded && (anyAllIn() || pokerGameState.showAllAtShowdown || winners.includes(playerId)));
            if (alreadyShown) return null;
            return (
              <div className="lg:col-span-2 flex items-center justify-between gap-3 surface p-3 mt-4">
                <span className="text-sm text-gray-700 dark:text-gray-200">Your cards are hidden from the table.</span>
                <button
                  onClick={showMyCards}
                  className="btn btn-secondary btn-sm"
                >
                  Show my cards
                </button>
              </div>
            );
          })()}

          {/* Showdown banner when not RIT: compute true winners instead of assuming the first remaining */}
          {gameStarted && pokerGameState && (pokerGameState.stage === 'showdown' || getActiveNonFoldedPlayers().length === 1)
            && !pokerGameState.runItTwice?.enabled
            && !(((pokerGameState.variant === 'omaha-hi-lo' || pokerGameState.variant === 'seven-card-stud-hi-lo')) && pokerGameState.lastHiLoResult) && (
            <div className="lg:col-span-2 rounded-2xl border border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-400/25 dark:bg-emerald-400/8 dark:text-emerald-100 p-4 mt-4">
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

                // Standard showdown with 2+ active players: evaluate winners client-side for display only.
                // Losers' cards are mucked, so evaluate only the players the server says won.
                const serverWinners: string[] = Array.isArray(pokerGameState?.handWinners) ? pokerGameState.handWinners : [];
                const contenders = serverWinners.length
                  ? remaining.filter((p: any) => serverWinners.includes(p.id))
                  : remaining;
                try {
                  const variant = pokerGameState?.variant as string | undefined;
                  const board = Array.isArray(pokerGameState?.communityCards) ? pokerGameState.communityCards : [];

                  type EvalRes = { playerId: string; name: string; hand: any; label: string };
                  if (variant === 'razz') {
                    // Razz: the lowest hand wins, so name the server's winners with their lows
                    const lows: Array<{ name: string; label: string }> = contenders.map((p: any) => {
                      const st = (pokerGameState as any)?.studState?.playerCards?.[p.id];
                      const all = [...(Array.isArray(st?.downCards) ? st.downCards : []), ...(Array.isArray(st?.upCards) ? st.upCards : [])];
                      return { name: p.name || p.id, label: all.length >= 5 ? HandEvaluator.evaluateRazzLow(all).description : '' };
                    });
                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{lows.map(l => l.name).join(', ')}</span>
                        <span>{lows.length > 1 ? 'split the pot' : 'wins the pot'}</span>
                        {lows[0]?.label ? <span className="opacity-80">({lows[0].label})</span> : null}
                      </div>
                    );
                  }
                  const evals: EvalRes[] = contenders.map((p: any) => {
                    if (isStudGame(variant)) {
                      const st = (pokerGameState as any)?.studState?.playerCards?.[p.id];
                      const down = Array.isArray(st?.downCards) ? st.downCards : [];
                      const up = Array.isArray(st?.upCards) ? st.upCards : [];
                      const { hand } = HandEvaluator.evaluateHand([...down, ...up], []);
                      return { playerId: p.id, name: p.name || p.id, hand, label: String((hand as any)?.description || '') };
                    }
                    if (isOmahaVariant(variant)) {
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

          {/* Chance to win during an all-in, when everyone's cards are face up */}
          {gameStarted && pokerGameState && anyAllIn() && pokerGameState.stage !== 'showdown' && !isStudVariant() && (
            <EquityPanel
              players={getActiveNonFoldedPlayers()}
              board={Array.isArray(pokerGameState.communityCards) ? pokerGameState.communityCards : []}
              omaha={isOmahaVariant(pokerGameState.variant)}
            />
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
              if (isStudGame(variant)) {
                return null;
              }
              
              type PlayerEval = { playerId: string; name: string; hand: HandInterface; holeCards: Card[] };
              const evals: PlayerEval[] = activePlayers.map((p: Player) => {
                let hand;
                if (isOmahaVariant(variant)) {
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

          {/* Right column: statistics, the hand's actions, session, notes and host controls, a tab each */}
          <div className="flex flex-col gap-4 lg:row-span-4">
          <SidePanelTabs
            tabs={[
              {
                id: 'stats',
                label: 'Stats',
                content: (
                  <>
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
                        <GameSettings settings={display.settings} onChange={display.change} hasOverrides={display.hasOverrides} onReset={display.reset} />
                      </div>
                    )}
                  </>
                ),
              },
              ...(gameStarted && pokerGameState ? [{
                id: 'hand',
                label: 'Hand',
                content: <HandActionLog embedded actions={pokerGameState.handActions} players={pokerGameState.players || []} handNumber={pokerGameState.handNumber} variant={pokerGameState.variant} />,
              }] : []),
              ...(playerId && (isSeated || amInGame) ? [{
                id: 'session',
                label: 'Session',
                content: <SessionLedgerPanel embedded tableId={tableId} refreshKey={`${pokerGameState?.handNumber ?? 0}:${pokerGameState?.stage === 'showdown'}`} />,
              }] : []),
              ...(playerId && otherSeated.length > 0 ? [{
                id: 'notes',
                label: 'Notes',
                content: <PlayerNotesPanel embedded players={otherSeated} notes={playerNotes} onNotesChange={setPlayerNotes} />,
              }] : []),
              ...(tableExtras && (tableExtras.hostPermissions || []).some(p => p !== 'room.view_ledger') ? [{
                id: 'host',
                label: tableExtras.isHost ? 'Host' : 'Staff',
                content: (
                  <HostControlsPanel
                    embedded
                    tableId={tableId}
                    playerId={playerId}
                    extras={tableExtras}
                    gameState={gameStarted ? pokerGameState : null}
                    players={otherSeated}
                    onState={setPokerGameState}
                    onRefresh={refreshTableExtras}
                  />
                ),
              }] : []),
            ]}
          />
          </div>

          {/* Less critical component in viewport */}
          <MobileCollapsible title="Chat" className="lg:col-span-2">
          <div ref={chatPanelRef} className="lg:col-span-2 surface p-4 max-sm:mt-0">
            <ChatPanel gameId={String(id)} playerId={playerId} isAdmin={userRole === 'admin'} />
          </div>
          </MobileCollapsible>

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
