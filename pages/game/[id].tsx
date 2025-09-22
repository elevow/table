import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { getPrefetcher, dynamicImport } from '../../src/utils/code-splitting';
import { useComponentPerformance } from '../../src/utils/performance-monitor';
import TimerHUD from '../../src/components/TimerHUD';
import { getSocket } from '../../src/lib/clientSocket';
import { createInvite } from '../../src/services/friends-ui';
import { determineUserRole } from '../../src/utils/roleUtils';

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
  
  // Seat management state
  const [seatAssignments, setSeatAssignments] = useState<Record<number, { playerId: string; playerName: string } | null>>({
    1: null, 2: null, 3: null, 4: null, 5: null, 6: null
  });
  const [currentPlayerSeat, setCurrentPlayerSeat] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'player' | 'guest'>('guest');
  
  // Seat management functions
  const claimSeat = (seatNumber: number) => {
    if (userRole === 'guest') return; // Guests cannot claim seats
    if (seatAssignments[seatNumber]) return; // Seat already taken
    if (currentPlayerSeat) return; // Player already has a seat

    const playerName = `Player ${playerId.slice(-3)}`; // Generate a display name
    const newAssignments = {
      ...seatAssignments,
      [seatNumber]: { playerId, playerName }
    };

    setSeatAssignments(newAssignments);
    setCurrentPlayerSeat(seatNumber);
    
    // Save to localStorage
    localStorage.setItem(`seats_${id}`, JSON.stringify(newAssignments));

    // TODO: In a real implementation, broadcast to other players via socket
    // socket?.emit('claim_seat', { tableId: id, seatNumber, playerId, playerName });
  };

  const standUp = () => {
    if (!currentPlayerSeat) return;

    const newAssignments = {
      ...seatAssignments,
      [currentPlayerSeat]: null
    };

    setSeatAssignments(newAssignments);
    setCurrentPlayerSeat(null);
    
    // Save to localStorage
    localStorage.setItem(`seats_${id}`, JSON.stringify(newAssignments));

    // TODO: In a real implementation, broadcast to other players via socket
    // socket?.emit('stand_up', { tableId: id, seatNumber: currentPlayerSeat, playerId });
  };

  // Render seat component
  const renderSeat = (seatNumber: number, position: string, style?: React.CSSProperties) => {
    const assignment = seatAssignments[seatNumber];
    const isCurrentPlayer = assignment?.playerId === playerId;
    const isEmpty = !assignment;
    const canClaim = isEmpty && userRole !== 'guest' && !currentPlayerSeat;

    return (
      <div
        key={seatNumber}
        className={`absolute w-16 h-16 rounded-full border-2 flex items-center justify-center text-white text-xs font-semibold transition-all duration-200 ${position} ${
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
              : `Occupied by ${assignment.playerName}`
        }
      >
        {isEmpty ? `P${seatNumber}` : assignment.playerName.split(' ')[1] || `P${seatNumber}`}
      </div>
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
    
    // Example: derive playerId from localStorage or a session; fallback to random for demo
    const pid = (typeof window !== 'undefined' && (localStorage.getItem('player_id') || 'p_' + Math.random().toString(36).slice(2))) as string;
    setPlayerId(pid);
    if (typeof window !== 'undefined') localStorage.setItem('player_id', pid);

    // Determine user role
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

    // Load existing seat assignments from localStorage
    const savedSeats = localStorage.getItem(`seats_${id}`);
    if (savedSeats) {
      try {
        const parsed = JSON.parse(savedSeats);
        setSeatAssignments(parsed);
        
        // Check if current player has a seat
        Object.entries(parsed).forEach(([seatNum, assignment]) => {
          if (assignment && assignment.playerId === pid) {
            setCurrentPlayerSeat(parseInt(seatNum));
          }
        });
      } catch (error) {
        console.warn('Error loading seat assignments:', error);
      }
    }

    // Join table and personal room
    if (socket && id && typeof id === 'string') {
      socket.emit('join_table', { tableId: id, playerId: pid });
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
  }, [id, markInteraction, socket]);
  
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
    
    try {
      // Notify server that player is leaving
      if (socket && playerId) {
        socket.emit('leave_table', String(id));
      }
      
      // Navigate back to dashboard
      await router.push('/dashboard');
    } catch (error) {
      console.error('Error leaving game:', error);
      // Navigate anyway even if socket fails
      router.push('/dashboard');
    }
  };
  
  return (
    <div className="game-page bg-gray-100 dark:bg-gray-900 min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">Game: {id}</h1>
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
