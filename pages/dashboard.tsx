import type { NextPage } from 'next';
import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { getPrefetcher } from '../src/utils/code-splitting';
import { useComponentPerformance } from '../src/utils/performance-monitor';
import { useUserAvatar } from '../src/hooks/useUserAvatar';
import Avatar from '../src/components/Avatar';
import AdminRoomsPanel from '../src/components/AdminRoomsPanel';

// Use dynamic import for the Game component to demonstrate code splitting
const GameBoard = dynamic(() => import('../src/components/GameBoard'), {
  loading: () => <div className="loading-skeleton">Loading game board...</div>,
  ssr: false, // Disable SSR for this component
});

const Dashboard: NextPage = () => {
  const router = useRouter();
  const chatContainerRef = useRef(null);
  const { markInteraction } = useComponentPerformance('DashboardPage');
  
  // Room code join functionality
  const [roomCode, setRoomCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  
  // For now, using a mock userId - in a real app this would come from authentication
  const { avatarData, loading: avatarLoading } = useUserAvatar('user-123');
  
  const handleAvatarClick = () => {
    // Navigate to profile page
    window.location.href = '/profile';
  };
  
  // Room code join functionality
  const handleJoinByRoomCode = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!roomCode.trim()) {
      setValidationMessage('Please enter a room code');
      return;
    }
    
    setIsValidating(true);
    setValidationMessage('');
    
    try {
      const response = await fetch('/api/games/validate-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roomCode: roomCode.trim() }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        if (data.joinable) {
          // Room exists and is joinable - navigate to the game
          router.push(`/game/${data.room.id}`);
        } else {
          // Room exists but not joinable
          setValidationMessage(`Cannot join room: ${data.reason}`);
        }
      } else {
        // Room not found or other error
        setValidationMessage(data.message || data.error || 'Room not found');
      }
    } catch (error) {
      console.error('Error validating room:', error);
      setValidationMessage('Failed to validate room code. Please try again.');
    } finally {
      setIsValidating(false);
    }
  };
  
  useEffect(() => {
    // Initialize the prefetcher
    const prefetcher = getPrefetcher();
    
    // Observe the chat container for viewport-based loading
    if (chatContainerRef.current) {
      prefetcher.observeComponent(chatContainerRef.current, 'ChatPanel');
    }
    
    // Mark this interaction for performance tracking
    const endMark = markInteraction('initial-load', { 
      route: 'dashboard',
      timestamp: Date.now()
    });
    
    // End the performance mark after everything is loaded
    return () => {
      if (typeof endMark === 'function') endMark();
      prefetcher.cleanup();
    };
  }, [markInteraction]);
  
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Head>
        <title>Dashboard - Table</title>
        <meta name="description" content="Table dashboard - Online poker platform" />
        <link rel="icon" href="/favicon.ico" />
        
        {/* Add preload directives for critical resources */}
        <link rel="preload" href="/fonts/main-font.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </Head>

      {/* Header with avatar in the corner */}
      <header className="relative bg-white dark:bg-gray-800 shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Table
            </h1>
            
            {/* Avatar in top-right corner */}
            <div className="flex items-center space-x-4">
              <Avatar 
                src={avatarData?.url}
                size="md"
                onClick={handleAvatarClick}
                className="ring-2 ring-indigo-500 ring-offset-2 ring-offset-gray-100 dark:ring-offset-gray-900"
                alt="Your profile"
              />
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <h2 className="text-4xl font-bold text-center mb-8 text-gray-900 dark:text-gray-100">
          Dashboard
        </h2>
        
        <div className="flex flex-col items-center space-y-6 mb-8">
          {/* Game action buttons */}
          <div className="flex justify-center">
            <button
              className="bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-2 rounded-md"
              onClick={() => router.push('/game/create')}
              data-route="/game/create"
            >
              Create Room (choose variant)
            </button>
          </div>
          
          {/* Room code join section */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 text-center">
              Join with Room Code
            </h3>
            <form onSubmit={handleJoinByRoomCode} className="space-y-4">
              <div>
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="Enter room code (e.g. ABC123)"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={isValidating}
                  maxLength={10}
                />
              </div>
              <button
                type="submit"
                disabled={isValidating || !roomCode.trim()}
                className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white px-4 py-2 rounded-md font-medium transition-colors"
              >
                {isValidating ? 'Validating...' : 'Join Room'}
              </button>
              {validationMessage && (
                <div className={`text-sm text-center p-2 rounded ${
                  validationMessage.includes('Cannot join') || validationMessage.includes('not found') || validationMessage.includes('Failed')
                    ? 'text-red-600 bg-red-50 dark:bg-red-900/20'
                    : 'text-blue-600 bg-blue-50 dark:bg-blue-900/20'
                }`}>
                  {validationMessage}
                </div>
              )}
            </form>
          </div>
        </div>
        
        {/* Preview of the game board with lazy loading */}
        <div className="game-preview mb-8">
          <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">Preview</h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <GameBoard gameId="preview" />
          </div>
        </div>

        {/* Admin Panel - Only visible to admin users */}
        <AdminRoomsPanel />
        
        {/* Chat panel that loads when scrolled into view */}
        <div ref={chatContainerRef} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">Community Chat</h2>
          <p className="text-gray-600 dark:text-gray-300">Chat panel will load when scrolled into view</p>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
