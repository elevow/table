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

// Rabbit Hunt Preview panel (SSR-safe)
const RabbitHuntPreviewPanel = dynamic(() => import('../../src/components/RabbitHuntPreviewPanel'), {
  loading: () => <div className="skeleton-loader rabbit-panel-loader" />,
  ssr: true,
});

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
    console.log('Getting avatar for player:', playerIdForAvatar, 'current playerId:', playerId);
    
    // For current player, use the loaded avatar data if available
    if (playerIdForAvatar === playerId && currentPlayerAvatar?.url) {
      console.log('Returning current player avatar:', currentPlayerAvatar.url);
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
      console.log('Returning cached avatar for other player:', playerIdForAvatar, playerAvatars[playerIdForAvatar]);
      return playerAvatars[playerIdForAvatar];
    }
    
    // If avatar not loaded yet, generate temporary default and trigger load
    console.log('Avatar not loaded yet for other player, generating temporary default and triggering load');
    loadPlayerAvatar(playerIdForAvatar);
    const shortId = playerIdForAvatar.slice(-3).toUpperCase();
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(shortId)}&background=9ca3af&color=fff&size=128`;
  };
  
  // Seat management state
  const [seatAssignments, setSeatAssignments] = useState<Record<number, { playerId: string; playerName: string; chips: number } | null>>({
    1: null, 2: null, 3: null, 4: null, 5: null, 6: null
  });
  const [currentPlayerSeat, setCurrentPlayerSeat] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'player' | 'guest'>('guest');
  const [playerChips, setPlayerChips] = useState<number>(0);
  
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

  // Render seat component with adjacent player info
  const renderSeat = (seatNumber: number, position: string, style?: React.CSSProperties) => {
    const assignment = seatAssignments[seatNumber];
    const isCurrentPlayer = assignment?.playerId === playerId;
    const isEmpty = !assignment;
    const canClaim = isEmpty && userRole !== 'guest' && !currentPlayerSeat;

    // Determine info box position based on the ROTATED seat position - OUTSIDE the table
    const getInfoBoxPosition = (currentPosition: string) => {
      // Map the rotated position classes to info box positions OUTSIDE the table boundary
      if (currentPosition.includes('top-1') && currentPosition.includes('left-1/2')) {
        // Top center seat - info well above the table
        return '-top-24 left-1/2 transform -translate-x-1/2';
      } else if (currentPosition.includes('top-8') && currentPosition.includes('right-8')) {
        // Top-right seat - info far to the right
        return 'top-2 -right-40';
      } else if (currentPosition.includes('bottom-8') && currentPosition.includes('right-8')) {
        // Bottom-right seat - info far to the right
        return 'bottom-2 -right-40';
      } else if (currentPosition.includes('bottom-1') && currentPosition.includes('left-1/2')) {
        // Bottom center seat (your position) - info well below the table
        return '-bottom-24 left-1/2 transform -translate-x-1/2';
      } else if (currentPosition.includes('bottom-8') && currentPosition.includes('left-8')) {
        // Bottom-left seat - info far to the left
        return 'bottom-2 -left-40';
      } else if (currentPosition.includes('top-8') && currentPosition.includes('left-8')) {
        // Top-left seat - info far to the left
        return 'top-2 -left-40';
      }
      // Fallback
      return '-bottom-24 left-1/2 transform -translate-x-1/2';
    };

    return (
      <React.Fragment key={seatNumber}>
        {/* Main seat */}
        <div
          className={`absolute w-16 h-16 rounded-full border-2 flex flex-col items-center justify-center text-white text-xs font-semibold ${position} ${
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
                : `${assignment.playerName} - $${assignment.chips || 0} in chips`
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
            </div>
          )}
        </div>

        {/* Player info box - only show if seat is occupied */}
        {!isEmpty && assignment && (
          <div
            className={`absolute ${getInfoBoxPosition(position)} z-10`}
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
                ${assignment.chips || 20} chips
              </div>
            </div>
          </div>
        )}
      </React.Fragment>
    );
  };

  // Calculate rotated seat positions
  const getRotatedSeatPositions = () => {
    // Default positions mapping: visual position -> seat data
    const defaultPositions = [
      { seatNumber: 1, position: 'top-1 left-1/2 transform -translate-x-1/2', style: { transform: 'translate(-50%, -75%)' } },
      { seatNumber: 2, position: 'top-8 right-8', style: { transform: 'translate(25%, -25%)' } },
      { seatNumber: 3, position: 'bottom-8 right-8', style: { transform: 'translate(25%, 25%)' } },
      { seatNumber: 4, position: 'bottom-1 left-1/2 transform -translate-x-1/2', style: { transform: 'translate(-50%, 75%)' } },
      { seatNumber: 5, position: 'bottom-8 left-8', style: { transform: 'translate(-25%, 25%)' } },
      { seatNumber: 6, position: 'top-8 left-8', style: { transform: 'translate(-25%, -25%)' } }
    ];

    // If user has no seat, use default positions
    if (!currentPlayerSeat) {
      return defaultPositions;
    }

    // Calculate rotation offset to put current player's seat in position 4 (bottom center)
    const targetPosition = 3; // Index 3 = position 4 (bottom center)
    const currentSeatIndex = currentPlayerSeat - 1; // Convert to 0-based index
    const rotationOffset = (targetPosition - currentSeatIndex + 6) % 6;

    // Create rotated positions
    const rotatedPositions = [];
    for (let i = 0; i < 6; i++) {
      const originalIndex = (i - rotationOffset + 6) % 6;
      const originalSeat = originalIndex + 1; // Convert back to 1-based
      rotatedPositions.push({
        seatNumber: originalSeat,
        position: defaultPositions[i].position,
        style: defaultPositions[i].style
      });
    }

    return rotatedPositions;
  };
  
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

        socketInstance.on('seat_claimed', handleSeatClaimed);
        socketInstance.on('seat_vacated', handleSeatVacated);
        socketInstance.on('seat_state', handleSeatState);

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
        for (let i = 1; i <= 6; i++) {
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
        // Reset to empty seats
        setSeatAssignments({
          1: null, 2: null, 3: null, 4: null, 5: null, 6: null
        });
      }
    }
  }, [id, playerId]); // Only depend on id and playerId - run when these change

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
            {currentPlayerSeat && (
              <div className="flex items-center gap-2 bg-green-100 dark:bg-green-900/20 px-3 py-2 rounded-lg">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="text-green-700 dark:text-green-300 font-medium">
                  Seated at P{currentPlayerSeat} - ${playerChips} in chips
                </span>
              </div>
            )}
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
            <button
              onClick={() => router.push('/account-settings')}
              className="bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white font-medium px-4 py-2 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2 w-full sm:w-auto"
              title="Manage your account settings"
              aria-label="Account settings"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="whitespace-nowrap">Settings</span>
            </button>
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
                
                {/* Pot area */}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-2 mt-20 text-white text-center">
                  <div className="bg-gray-800 bg-opacity-70 px-3 py-1 rounded text-sm font-semibold">
                    Pot: $0
                  </div>
                </div>
                
              </div>
            </div>
          </div>

          {/* Combined Timer and Statistics */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
            {id && playerId && (
              <CombinedTimerStats 
                tableId={String(id)} 
                playerId={playerId} 
                gameId={String(id)} 
              />
            )}
          </div>
          
          {/* Less critical component in viewport */}
          <div ref={chatPanelRef} className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mt-6">
            <ChatPanel gameId={String(id)} playerId={playerId} />
          </div>
          
          {/* Rabbit Hunt Preview Panel */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mt-6">
            <RabbitHuntPreviewPanel roomId={String(id)} />
          </div>

          {/* On-demand loaded component */}
          <div ref={settingsRef} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mt-6">
            <button 
              onClick={toggleSettings}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded"
            >
              {showSettings ? 'Hide Settings' : 'Show Settings'}
            </button>
            
            {showSettings && <GameSettings gameId={String(id)} />}
          </div>
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
