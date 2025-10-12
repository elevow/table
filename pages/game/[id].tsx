import { useRouter } from 'next/router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { getPrefetcher, dynamicImport } from '../../src/utils/code-splitting';
import { useComponentPerformance } from '../../src/utils/performance-monitor';
import TimerHUD from '../../src/components/TimerHUD';
import { getSocket } from '../../src/lib/clientSocket';
import { createInvite } from '../../src/services/friends-ui';
import { determineUserRole } from '../../src/utils/roleUtils';
import { useUserAvatar } from '../../src/hooks/useUserAvatar';
import Avatar from '../../src/components/Avatar';
import { PotLimitCalculator } from '../../src/lib/poker/pot-limit';

// Dynamic import with loading state
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
  const chatPanelRef = useRef(null);
  const settingsRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  const [gameRoutes, setGameRoutes] = useState<import('../../src/utils/game-routes').GameRoute[]>([]);
  const { markInteraction } = useComponentPerformance('GamePage');
  const [playerId, setPlayerId] = useState<string>('');
  const [socket, setSocket] = useState<any>(null);
  const [inviteeId, setInviteeId] = useState<string>('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  
  // Avatar data for current player
  const { avatarData: currentPlayerAvatar, loading: avatarLoading, error: avatarError } = useUserAvatar(playerId);
  
  // Avatar cache for all players (including other seated players)
  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string>>({});
  
  // Debug logging for avatar data
  useEffect(() => {
    console.log('=== Avatar Debug Start ===');
    console.log('Avatar Debug - playerId:', playerId);
    console.log('Avatar Debug - currentPlayerAvatar:', currentPlayerAvatar);
    console.log('Avatar Debug - avatarLoading:', avatarLoading);
    console.log('Avatar Debug - avatarError:', avatarError);
    console.log('Avatar Debug - useUserAvatar hook called with:', playerId);
    console.log('=== Avatar Debug End ===');
    if (avatarError) {
      console.error('Avatar loading failed:', avatarError);
    }
  }, [playerId, currentPlayerAvatar, avatarLoading, avatarError]);
  
  // Function to load avatar for any player
  const loadPlayerAvatar = useCallback(async (playerIdToLoad: string) => {
    if (playerAvatars[playerIdToLoad]) {
      return; // Already loaded
    }
    
    try {
      const response = await fetch(`/api/avatars/user/${playerIdToLoad}`);
      if (response.ok) {
        const data = await response.json();
        if (data.url) {
          setPlayerAvatars(prev => ({
            ...prev,
            [playerIdToLoad]: data.url
          }));
          return;
        }
      }
      
      // If no avatar found, generate default
      const shortId = playerIdToLoad.slice(-3).toUpperCase();
      const defaultAvatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(shortId)}&background=6b7280&color=fff&size=128`;
      setPlayerAvatars(prev => ({
        ...prev,
        [playerIdToLoad]: defaultAvatarUrl
      }));
    } catch (error) {
      console.warn('Failed to load avatar for player:', playerIdToLoad, error);
      // Generate default avatar on error
      const shortId = playerIdToLoad.slice(-3).toUpperCase();
      const defaultAvatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(shortId)}&background=6b7280&color=fff&size=128`;
      setPlayerAvatars(prev => ({
        ...prev,
        [playerIdToLoad]: defaultAvatarUrl
      }));
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
  
  // Seat management state - initialize dynamically based on maxPlayers
  const [seatAssignments, setSeatAssignments] = useState<Record<number, { playerId: string; playerName: string; chips: number } | null>>(() => {
    const seats: Record<number, { playerId: string; playerName: string; chips: number } | null> = {};
    for (let i = 1; i <= maxPlayers; i++) {
      seats[i] = null;
    }
    return seats;
  });
  const [currentPlayerSeat, setCurrentPlayerSeat] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'player' | 'guest'>('guest');
  const [playerChips, setPlayerChips] = useState<number>(0);
  
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
  // Auto next-hand fallback timer ref
  const autoNextHandTimerRef = useRef<NodeJS.Timeout | null>(null);
  
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

  // Client-side fallback: after showdown, request next hand after 5s if server didn't start it
  useEffect(() => {
    // Guard: need socket, table id, and a valid game state
    if (!socket || !id || typeof id !== 'string') return;

    // Clear any previous timer when stage changes
    if (autoNextHandTimerRef.current) {
      clearTimeout(autoNextHandTimerRef.current);
      autoNextHandTimerRef.current = null;
    }

    const stage = pokerGameState?.stage;
    if (stage === 'showdown') {
      // Schedule a single-shot fallback after 5 seconds
      autoNextHandTimerRef.current = setTimeout(() => {
        try {
          // Double-check we're still at showdown before emitting
          if (pokerGameState?.stage === 'showdown') {
            console.log('[client auto] Requesting next hand after 5s');
            socket.emit('request_next_hand', { tableId: id });
          }
        } catch (e) {
          console.warn('Auto next-hand request failed:', e);
        } finally {
          if (autoNextHandTimerRef.current) {
            clearTimeout(autoNextHandTimerRef.current);
            autoNextHandTimerRef.current = null;
          }
        }
      }, 5000);
    }

    return () => {
      if (autoNextHandTimerRef.current) {
        clearTimeout(autoNextHandTimerRef.current);
        autoNextHandTimerRef.current = null;
      }
    };
  }, [pokerGameState?.stage, socket, id]);
  
  // Seat management functions
  const claimSeat = (seatNumber: number) => {
    if (userRole === 'guest') return; // Guests cannot claim seats
    if (seatAssignments[seatNumber]) return; // Seat already taken
    if (currentPlayerSeat) return; // Player already has a seat

    // Get player name from localStorage, or generate a fallback
    const savedPlayerName = localStorage.getItem('playerName');
    const playerName = savedPlayerName || (() => {
      const playerNumber = playerId.replace(/\D/g, '').slice(-2) || Math.floor(Math.random() * 99).toString().padStart(2, '0');
      return `Player ${playerNumber}`;
    })();
    const startingChips = 20; // Give $20 in chips when sitting down
    
    const newAssignments = {
      ...seatAssignments,
      [seatNumber]: { playerId, playerName, chips: startingChips }
    };

    setSeatAssignments(newAssignments);
    setCurrentPlayerSeat(seatNumber);
    setPlayerChips(startingChips);
    
    // Save to localStorage
    localStorage.setItem(`seats_${id}`, JSON.stringify(newAssignments));
    localStorage.setItem(`chips_${playerId}_${id}`, startingChips.toString());

    // Broadcast to other players via socket
    if (socket) {
      socket.emit('claim_seat', { 
        tableId: id, 
        seatNumber, 
        playerId, 
        playerName, 
        chips: startingChips 
      });
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
    setPlayerChips(0);
    
    // Save to localStorage
    localStorage.setItem(`seats_${id}`, JSON.stringify(newAssignments));
    localStorage.removeItem(`chips_${playerId}_${id}`);

    // Broadcast to other players via socket
    if (socket) {
      socket.emit('stand_up', { 
        tableId: id, 
        seatNumber: seatToVacate, 
        playerId 
      });
    }
  };

  // Start game handler
  const handleStartGame = () => {
    if (!canStartGame()) {
      console.warn('Cannot start game: insufficient players or player not seated');
      return;
    }
    
    console.log('Starting game with', getSeatedPlayersCount(), 'players');
    setGameStarted(true);
    
    // Emit start game event via socket
    if (socket) {
      socket.emit('start_game', { 
        tableId: id, 
        playerId,
        seatedPlayers: Object.entries(seatAssignments)
          .filter(([_, assignment]) => assignment !== null)
          .map(([seatNumber, assignment]) => ({
            seatNumber: parseInt(seatNumber),
            playerId: assignment!.playerId,
            playerName: assignment!.playerName,
            chips: assignment!.chips
          }))
      });
    }
  };

  // Poker action handlers
  const handlePokerAction = (action: string, amount?: number) => {
    if (!socket || !pokerGameState || !playerId) {
      console.warn('Cannot perform action: missing socket, game state, or player ID');
      return;
    }

    console.log(`Performing ${action}${amount ? ` for ${amount}` : ''}`);
    
    socket.emit('player_action', {
      tableId: id,
      playerId: playerId,
      action: action,
      amount: amount
    });
  };

  const handleFold = () => handlePokerAction('fold');
  const handleCheck = () => handlePokerAction('check');
  const handleCall = () => {
    if (pokerGameState?.currentBet) {
      const playerInGame = pokerGameState.players.find((p: any) => p.id === playerId);
      const callAmount = pokerGameState.currentBet - (playerInGame?.currentBet || 0);
      handlePokerAction('call', callAmount);
    }
  };
  const handleBet = (amount: number) => handlePokerAction('bet', amount);
  const handleRaise = (amount: number) => handlePokerAction('raise', amount);

  // Get current player's hole cards
  const getCurrentPlayerCards = () => {
    if (!pokerGameState || !playerId) return [];
    const player = pokerGameState.players.find((p: any) => p.id === playerId);
    return player?.holeCards || [];
  };

  // Variant helpers
  const isStudVariant = () => {
    const v = pokerGameState?.variant;
    return v === 'seven-card-stud' || v === 'seven-card-stud-hi-lo';
  };

  const getStudCardsForPlayer = (pid: string) => {
    const st = (pokerGameState as any)?.studState?.playerCards?.[pid];
    return {
      down: Array.isArray(st?.downCards) ? st.downCards : [],
      up: Array.isArray(st?.upCards) ? st.upCards : [],
    } as { down: any[]; up: any[] };
  };

  // Defensive: compute remaining non-folded players from current state
  const getActiveNonFoldedPlayers = useCallback(() => {
    if (!pokerGameState?.players) return [] as any[];
    return pokerGameState.players.filter((p: any) => !(p.folded || p.isFolded));
  }, [pokerGameState]);

  // Helpers for No-Limit bet/raise controls
  const getMe = useCallback(() => {
    if (!pokerGameState?.players || !playerId) return null as any;
    return pokerGameState.players.find((p: any) => p.id === playerId) || null;
  }, [pokerGameState, playerId]);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const getMinBet = () => {
    const bb = Number(pokerGameState?.bigBlind || 0) || 0;
    const me = getMe();
    const stack = Number(me?.stack || 0) || 0;
    // If short-stacked, min becomes all-in (short bet allowed)
    return Math.min(Math.max(bb, 0.01), stack + Number(me?.currentBet || 0));
  };

  const getBetBounds = () => {
    const me = getMe();
    const prev = Number(me?.currentBet || 0);
    const stack = Number(me?.stack || 0);
    const min = getMinBet();
    const max = prev + stack; // total target for all-in
    return { min: Number(min.toFixed(2)), max: Number(max.toFixed(2)) };
  };

  const getRaiseBounds = () => {
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
  };

  // Pot-Limit helpers
  const getPotLimitPlayersShape = () => {
    const arr = Array.isArray(pokerGameState?.players) ? pokerGameState.players : [];
    return arr.map((p: any) => ({
      currentBet: Number(p?.currentBet || 0),
      isFolded: !!(p?.isFolded || p?.folded),
      isAllIn: !!p?.isAllIn,
    }));
  };

  const getPotLimitBetBounds = () => {
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
  };

  const getPotLimitRaiseBounds = () => {
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
  }, [pokerGameState, playerId]);

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
  }, [autoFold, pokerGameState?.activePlayer, pokerGameState?.stage, playerId]);

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
  }, [autoCall, autoFold, pokerGameState?.activePlayer, pokerGameState?.currentBet, pokerGameState?.stage, playerId]);

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
  }, [autoCheck, autoFold, pokerGameState?.activePlayer, pokerGameState?.currentBet, pokerGameState?.stage, playerId]);

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
    const canClaim = isEmpty && userRole !== 'guest' && !currentPlayerSeat;

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
          onClick={() => canClaim && claimSeat(seatNumber)}
          title={
            isEmpty
              ? canClaim
                ? 'Click to claim this seat'
                : userRole === 'guest'
                  ? 'Guests cannot claim seats'
                  : 'You already have a seat'
              : isCurrentPlayer
                ? 'Your seat - click Stand Up button to leave'
                : `${assignment.playerName} - $${assignment.chips || 0}`
          }
        >
          {isEmpty ? (
            <div className="text-center leading-tight text-white text-xs font-semibold">
              P{seatNumber}
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
            return (
              <div className="absolute z-0 pointer-events-none" style={cardStyle} aria-label="Opponent stud cards">
                <div className="flex items-center gap-1">
                  {/* Down cards (face down) */}
                  {down.map((_, i) => (
                    <div key={`down-${i}`} className="w-8 h-12 rounded border border-blue-700 bg-gradient-to-br from-blue-500 to-blue-700 shadow-md flex items-center justify-center">
                      <div className="w-6 h-10 rounded bg-blue-600/50 border border-blue-400"></div>
                    </div>
                  ))}
                  {/* Up cards (face up) */}
                  {up.map((card: any, i: number) => (
                    <div key={`up-${i}`} className="bg-white rounded border text-[10px] p-1 w-8 h-12 flex flex-col items-center justify-center text-black font-bold shadow">
                      <div>{card.rank}</div>
                      <div className={card.suit === 'hearts' || card.suit === 'diamonds' ? 'text-red-500' : 'text-black'}>
                        {card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          // Hold'em/Omaha opponents: show two face-down backs
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
    // Initialize socket connection (non-blocking)
    const initSocket = async () => {
      try {
        const { getSocket } = await import('../../src/lib/clientSocket');
        const socketInstance = await getSocket();
        setSocket(socketInstance);
      } catch (error) {
        console.warn('Socket initialization failed, continuing without real-time features:', error);
        // Continue without socket - the app should still work
      }
    };
    
    // Don't block page load for socket initialization
    setTimeout(() => {
      initSocket();
    }, 100);

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

    // Join table and personal room
    if (socket && id && typeof id === 'string') {
      socket.emit('join_table', { tableId: id, playerId: playerId });
    }

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
  }, [id, markInteraction, socket, playerId]);

  // Determine user role - separate useEffect to prevent infinite loops
  useEffect(() => {
    const determineRole = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (token) {
          const role = await determineUserRole(token);
          setUserRole(role);
        }
      } catch (error) {
        console.warn('Could not determine user role:', error);
        setUserRole('guest');
      }
    };

    determineRole();
  }, []); // Empty dependency array - only run once on mount

  // Initialize socket connection - run once on mount
  useEffect(() => {
    if (!playerId || !id) return;

    let currentSocket: any = null;

    const initSocket = async () => {
      try {
        const socketInstance = await getSocket();
        if (!socketInstance) {
          console.error('Failed to get socket instance');
          return;
        }
        
        currentSocket = socketInstance;
        setSocket(socketInstance);

        // Join the game room
        socketInstance.emit('join_table', { tableId: id, playerId: playerId });

        // Listen for seat updates from other players
        const handleSeatClaimed = (data: { seatNumber: number; playerId: string; playerName: string; chips: number }) => {
          console.log('Received seat_claimed:', data);
          setSeatAssignments(prev => ({
            ...prev,
            [data.seatNumber]: {
              playerId: data.playerId,
              playerName: data.playerName,
              chips: data.chips
            }
          }));
          
          // Update current player seat if this player claimed it
          if (data.playerId === playerId) {
            setCurrentPlayerSeat(data.seatNumber);
            setPlayerChips(data.chips);
          }
        };

        const handleSeatVacated = (data: { seatNumber: number; playerId: string }) => {
          console.log('Received seat_vacated:', data);
          setSeatAssignments(prev => ({
            ...prev,
            [data.seatNumber]: null
          }));
          
          // Update current player seat if this player stood up
          if (data.playerId === playerId) {
            setCurrentPlayerSeat(null);
            setPlayerChips(0);
          }
        };

        const handleSeatState = (data: { seats: Record<number, { playerId: string; playerName: string; chips: number } | null> }) => {
          console.log('Received seat_state:', data);
          setSeatAssignments(data.seats);
          
          // Find current player's seat
          const playerSeat = Object.entries(data.seats).find(([_, assignment]) => assignment?.playerId === playerId);
          if (playerSeat) {
            const [seatNumber, assignment] = playerSeat;
            setCurrentPlayerSeat(parseInt(seatNumber));
            setPlayerChips(assignment?.chips || 0);
          }
        };

        const handleGameStart = (data: { startedBy: string; playerName: string; seatedPlayers: any[]; gameState?: any }) => {
          console.log('Game started by:', data.startedBy, data.playerName);
          console.log('Seated players:', data.seatedPlayers);
          console.log('Initial game state:', data.gameState);
          setGameStarted(true);
          
          if (data.gameState) {
            setPokerGameState(data.gameState);
            try {
              const gs = data.gameState || {};
              const players = Array.isArray(gs.players) ? gs.players : [];
              const activeCount = players.filter((p: any) => !(p?.isFolded || (p as any)?.folded)).length;
              if (activeCount === 1 && gs.stage !== 'showdown') {
                console.log('[client safety] One active at game start; requesting settlement');
                socketInstance.emit('force_settlement', { tableId: id });
              }
            } catch {}
            
            // Update seat assignments with initial stack values from game state
            if (data.gameState.players) {
              setSeatAssignments(prev => {
                const updated = { ...prev };
                
                // Update each seat's chip count based on the poker game state
                data.gameState.players.forEach((player: any) => {
                  // Find the seat number for this player
                  const seatEntry = Object.entries(prev).find(([_, assignment]) => 
                    assignment?.playerId === player.id
                  );
                  
                  if (seatEntry) {
                    const [seatNumber, assignment] = seatEntry;
                    if (assignment) {
                      updated[parseInt(seatNumber)] = {
                        ...assignment,
                        chips: player.stack // Update with current stack from game state
                      };
                    }
                  }
                });
                
                return updated;
              });
              
              // Update current player's chip count
              const currentPlayer = data.gameState.players.find((p: any) => p.id === playerId);
              if (currentPlayer) {
                setPlayerChips(currentPlayer.stack);
              }
            }
          }
        };

        const handleGameStateUpdate = (data: { gameState: any; lastAction?: any }) => {
          console.log('Game state update:', data.gameState);
          console.log('Last action:', data.lastAction);
          setPokerGameState(data.gameState);
          try {
            const gs = data.gameState || {};
            const players = Array.isArray(gs.players) ? gs.players : [];
            const activeCount = players.filter((p: any) => !(p?.isFolded || (p as any)?.folded)).length;
            if (activeCount === 1 && gs.stage !== 'showdown') {
              console.log('[client safety] One active player remains but stage is', gs.stage, '→ requesting settlement');
              socketInstance.emit('force_settlement', { tableId: id });
            }
          } catch (e) {
            console.warn('Safety check failed:', e);
          }
          
          // Update seat assignments with current stack values from game state
          if (data.gameState && data.gameState.players) {
            setSeatAssignments(prev => {
              const updated = { ...prev };
              
              // Update each seat's chip count based on the poker game state
              data.gameState.players.forEach((player: any) => {
                // Find the seat number for this player
                const seatEntry = Object.entries(prev).find(([_, assignment]) => 
                  assignment?.playerId === player.id
                );
                
                if (seatEntry) {
                  const [seatNumber, assignment] = seatEntry;
                  if (assignment) {
                    updated[parseInt(seatNumber)] = {
                      ...assignment,
                      chips: player.stack // Update with current stack from game state
                    };
                  }
                }
              });
              
              return updated;
            });
            
            // Update current player's chip count
            const currentPlayer = data.gameState.players.find((p: any) => p.id === playerId);
            if (currentPlayer) {
              setPlayerChips(currentPlayer.stack);
            }
          }
        };

        const handleActionFailed = (data: { error: string; playerId?: string; action?: string }) => {
          console.error('Action failed:', data);
          // You could show a toast notification here
        };

        socketInstance.on('seat_claimed', handleSeatClaimed);
        socketInstance.on('seat_vacated', handleSeatVacated);
        socketInstance.on('seat_state', handleSeatState);
        socketInstance.on('game_started', handleGameStart);
        socketInstance.on('game_state_update', handleGameStateUpdate);
        socketInstance.on('action_failed', handleActionFailed);

        // Request current seat state when joining
        socketInstance.emit('get_seat_state', { tableId: id });

      } catch (error) {
        console.error('Failed to initialize socket:', error);
      }
    };

    initSocket();

    return () => {
      // Clean up socket listeners when component unmounts
      if (currentSocket) {
        currentSocket.off('seat_claimed');
        currentSocket.off('seat_vacated');
        currentSocket.off('seat_state');
        currentSocket.off('game_started');
        currentSocket.off('game_state_update');
        currentSocket.off('action_failed');
      }
    };
  }, [playerId, id]); // Only depend on playerId and id

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
  }, [id, playerId, maxPlayers]); // Include maxPlayers in dependencies

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

  const handleLeaveGame = async () => {
    // Show confirmation dialog
    const confirmed = window.confirm('Are you sure you want to leave this game?');
    if (!confirmed) return;
    
    console.log('Attempting to leave game and navigate to dashboard');
    console.log('Current router state:', router.asPath, router.pathname);
    
    try {
      // Notify server that player is leaving
      if (socket && playerId) {
        socket.emit('leave_table', String(id));
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
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">Game: {id}</h1>
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
                        <div>{card.rank}</div>
                        <div className={card.suit === 'hearts' || card.suit === 'diamonds' ? 'text-red-500' : 'text-black'}>
                          {card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}
                        </div>
                      </div>
                    ))}
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
                            <div>{card.rank}</div>
                            <div className={card.suit === 'hearts' || card.suit === 'diamonds' ? 'text-red-500' : 'text-black'}>
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
                          <div>{card.rank}</div>
                          <div className={card.suit === 'hearts' || card.suit === 'diamonds' ? 'text-red-500' : 'text-black'}>
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
          {gameStarted && pokerGameState && pokerGameState.stage !== 'showdown' && getActiveNonFoldedPlayers().length > 1 && pokerGameState.activePlayer === playerId && (
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mt-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Your Turn</h3>
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

          {/* Game Status Display (only before showdown); hide if only one non-folded remains */}
          {gameStarted && pokerGameState && pokerGameState.stage !== 'showdown' && getActiveNonFoldedPlayers().length > 1 && pokerGameState.activePlayer !== playerId && (
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
              </div>
            </div>
          )}

          {/* Showdown result banner or single-remaining defensive winner */}
          {gameStarted && pokerGameState && (pokerGameState.stage === 'showdown' || getActiveNonFoldedPlayers().length === 1) && (
            <div className="lg:col-span-2 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100 rounded-lg shadow-md p-4 mt-4">
              {(() => {
                const remaining = getActiveNonFoldedPlayers();
                const winner = remaining[0];
                return (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{winner?.name || 'Winner'}</span>
                    <span>wins the pot</span>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Combined Timer and Statistics */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
            {id && playerId && (
              <CombinedTimerStats 
                tableId={String(id)} 
                playerId={playerId} 
                gameId={String(id)}
                onShowSettings={toggleSettings}
              />
            )}
            {showSettings && (
              <div className="mt-4">
                <GameSettings gameId={String(id)} />
              </div>
            )}
          </div>
          
          {/* Less critical component in viewport */}
          <div ref={chatPanelRef} className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mt-6">
            <ChatPanel gameId={String(id)} playerId={playerId} />
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
