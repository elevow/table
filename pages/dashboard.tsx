import type { NextPage } from 'next';
import Head from 'next/head';
import { useEffect, useRef } from 'react';
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
  
  // For now, using a mock userId - in a real app this would come from authentication
  const { avatarData, loading: avatarLoading } = useUserAvatar('user-123');
  
  const handleAvatarClick = () => {
    // Navigate to profile page
    window.location.href = '/profile';
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
        
        <div className="flex justify-center space-x-4 mb-8">
          <button
            className="bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-2 rounded-md"
            onClick={() => router.push('/game/create')}
            data-route="/game/create"
          >
            Create Room (choose variant)
          </button>
          
          <button
            className="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded-md"
            onClick={() => router.push('/game/join')}
            data-route="/game/join"
          >
            Join Existing Game
          </button>
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
