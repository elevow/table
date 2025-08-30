import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { getPrefetcher, dynamicImport } from '../../src/utils/code-splitting';
import { useComponentPerformance } from '../../src/utils/performance-monitor';

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
const PlayerStats = dynamic(() => import('../../src/components/PlayerStats'), {
  loading: () => <div className="skeleton-loader stats-loader" />,
});

export default function GamePage() {
  const router = useRouter();
  const { id } = router.query;
  const chatPanelRef = useRef(null);
  const settingsRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  const [gameRoutes, setGameRoutes] = useState<import('../../src/utils/game-routes').GameRoute[]>([]);
  const { markInteraction } = useComponentPerformance('GamePage');
  
  useEffect(() => {
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
  }, [id, markInteraction]);
  
  // Toggle settings component
  const toggleSettings = () => {
    const endMark = markInteraction('toggle-settings');
    setShowSettings(prev => !prev);
    if (typeof endMark === 'function') endMark();
  };
  
  return (
    <div className="game-page bg-gray-100 min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">Game: {id}</h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Critical component loaded immediately */}
          <div className="lg:col-span-2 bg-white rounded-lg shadow-md overflow-hidden">
            <GameBoard gameId={String(id)} />
          </div>
          
          {/* Player stats (important info, loaded early) */}
          <div className="bg-white rounded-lg shadow-md p-4">
            <PlayerStats gameId={String(id)} />
          </div>
          
          {/* Less critical component in viewport */}
          <div ref={chatPanelRef} className="lg:col-span-2 bg-white rounded-lg shadow-md p-4 mt-6">
            <ChatPanel gameId={String(id)} />
          </div>
          
          {/* On-demand loaded component */}
          <div ref={settingsRef} className="bg-white rounded-lg shadow-md p-4 mt-6">
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
