import type { NextPage } from 'next';
import Head from 'next/head';
import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { getPrefetcher } from '../src/utils/code-splitting';
import { useComponentPerformance } from '../src/utils/performance-monitor';

// Use dynamic import for the Game component to demonstrate code splitting
const GameBoard = dynamic(() => import('../src/components/GameBoard'), {
  loading: () => <div className="loading-skeleton">Loading game board...</div>,
  ssr: false, // Disable SSR for this component
});

const Home: NextPage = () => {
  const router = useRouter();
  const chatContainerRef = useRef(null);
  const { markInteraction } = useComponentPerformance('HomePage');
  
  useEffect(() => {
    // Initialize the prefetcher
    const prefetcher = getPrefetcher();
    
    // Observe the chat container for viewport-based loading
    if (chatContainerRef.current) {
      prefetcher.observeComponent(chatContainerRef.current, 'ChatPanel');
    }
    
    // Mark this interaction for performance tracking
    const endMark = markInteraction('initial-load', { 
      route: 'home',
      timestamp: Date.now()
    });
    
    // End the performance mark after everything is loaded
    return () => {
      if (typeof endMark === 'function') endMark();
      prefetcher.cleanup();
    };
  }, [markInteraction]);
  
  // Handle starting a new game - demonstrate how we'd handle a user interaction
  const handleStartGame = () => {
    // Start timing this interaction
    const endMark = markInteraction('start-game-click');
    
    // Navigate to the game page
    router.push('/game/poker-texas-holdem');
    
    // End timing when the function completes
  if (typeof endMark === 'function') endMark();
  };
  
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Head>
        <title>Table - Online Poker</title>
        <meta name="description" content="Online poker platform" />
        <link rel="icon" href="/favicon.ico" />
        
        {/* Add preload directives for critical resources */}
        <link rel="preload" href="/fonts/main-font.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </Head>

      <main className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold text-center mb-8 text-gray-900 dark:text-gray-100">
          Welcome to Table
        </h1>
        
        <div className="flex justify-center space-x-4 mb-8">
          <button
            className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-md"
            onClick={handleStartGame}
            data-route="/game/poker-texas-holdem"
          >
            Start New Game
          </button>
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
        
        {/* Chat panel that loads when scrolled into view */}
        <div ref={chatContainerRef} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">Community Chat</h2>
          <p className="text-gray-600 dark:text-gray-300">Chat panel will load when scrolled into view</p>
        </div>
      </main>
    </div>
  );
};

export default Home;
