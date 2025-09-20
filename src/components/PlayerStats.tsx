/**
 * Game Session Statistics Component
 * Tracks and displays statistics specific to the current game session
 */
import { useEffect, useState, memo } from 'react';

interface SessionStats {
  handsPlayed: number;
  handsWon: number;
  totalWinnings: number;
  totalLosses: number;
  biggestPot: number;
  foldRate: number;
  sessionStartTime: Date;
  timeInSession: string;
}

interface PlayerStatsProps {
  gameId: string;
}

function PlayerStats({ gameId }: PlayerStatsProps) {
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    handsPlayed: 0,
    handsWon: 0,
    totalWinnings: 0,
    totalLosses: 0,
    biggestPot: 0,
    foldRate: 0,
    sessionStartTime: new Date(),
    timeInSession: '0m'
  });

  const [isLoading, setIsLoading] = useState(true);

  // Calculate session time
  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const diff = now.getTime() - sessionStats.sessionStartTime.getTime();
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) {
        setSessionStats(prev => ({
          ...prev,
          timeInSession: `${hours}h ${minutes % 60}m`
        }));
      } else {
        setSessionStats(prev => ({
          ...prev,
          timeInSession: `${minutes}m`
        }));
      }
    };

    const timer = setInterval(updateTimer, 60000); // Update every minute
    updateTimer(); // Initial update

    return () => clearInterval(timer);
  }, [sessionStats.sessionStartTime]);

  useEffect(() => {
    // Initialize session statistics
    const initializeSessionStats = async () => {
      try {
        // Try to get existing session data from localStorage first
        const savedStats = localStorage.getItem(`session_stats_${gameId}`);
        if (savedStats) {
          const parsed = JSON.parse(savedStats);
          setSessionStats({
            ...parsed,
            sessionStartTime: new Date(parsed.sessionStartTime)
          });
        } else {
          // Initialize new session
          const newSession = {
            handsPlayed: 0,
            handsWon: 0,
            totalWinnings: 0,
            totalLosses: 0,
            biggestPot: 0,
            foldRate: 0,
            sessionStartTime: new Date(),
            timeInSession: '0m'
          };
          setSessionStats(newSession);
          localStorage.setItem(`session_stats_${gameId}`, JSON.stringify(newSession));
        }

        // TODO: In a real implementation, connect to socket events here
        // Example:
        // socket.on('hand_completed', updateHandStats);
        // socket.on('pot_won', updateWinnings);
        // socket.on('player_action', updateActionStats);
        
      } catch (error) {
        console.error('Error initializing session stats:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeSessionStats();
  }, [gameId]);

  // Function to update stats when real game events occur
  // This would be called by socket event handlers in a real implementation
  const updateSessionStats = (eventType: string, data: any) => {
    setSessionStats(prev => {
      let newStats = { ...prev };
      
      switch (eventType) {
        case 'hand_completed':
          newStats.handsPlayed = prev.handsPlayed + 1;
          if (data.won) {
            newStats.handsWon = prev.handsWon + 1;
            newStats.totalWinnings = prev.totalWinnings + data.potSize;
            newStats.biggestPot = Math.max(prev.biggestPot, data.potSize);
          } else if (data.lost) {
            newStats.totalLosses = prev.totalLosses + data.lossAmount;
          }
          newStats.foldRate = Math.floor(((newStats.handsPlayed - newStats.handsWon) / newStats.handsPlayed) * 100);
          break;
        default:
          break;
      }
      
      // Save updated stats to localStorage
      localStorage.setItem(`session_stats_${gameId}`, JSON.stringify(newStats));
      return newStats;
    });
  };

  const calculateWinRate = () => {
    if (sessionStats.handsPlayed === 0) return 0;
    return Math.round((sessionStats.handsWon / sessionStats.handsPlayed) * 100);
  };

  const calculateNetWinnings = () => {
    return sessionStats.totalWinnings - sessionStats.totalLosses;
  };

  if (isLoading) {
    return (
      <div className="player-stats">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Session Statistics
        </h2>
        <div className="animate-pulse space-y-3">
          <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="player-stats">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Session Statistics
        </h2>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {sessionStats.timeInSession}
        </div>
      </div>
      
      <div className="stats-grid space-y-3">
        <div className="stat-card bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
          <div className="stat-title text-sm font-medium text-gray-600 dark:text-gray-400">
            Hands Played
          </div>
          <div className="stat-value text-2xl font-bold text-blue-600 dark:text-blue-400">
            {sessionStats.handsPlayed}
          </div>
        </div>
        
        <div className="stat-card bg-green-50 dark:bg-green-900/20 p-3 rounded-lg">
          <div className="stat-title text-sm font-medium text-gray-600 dark:text-gray-400">
            Win Rate
          </div>
          <div className="stat-value text-2xl font-bold text-green-600 dark:text-green-400">
            {calculateWinRate()}%
          </div>
        </div>
        
        <div className={`stat-card p-3 rounded-lg ${
          calculateNetWinnings() >= 0 
            ? 'bg-green-50 dark:bg-green-900/20' 
            : 'bg-red-50 dark:bg-red-900/20'
        }`}>
          <div className="stat-title text-sm font-medium text-gray-600 dark:text-gray-400">
            Net Winnings
          </div>
          <div className={`stat-value text-2xl font-bold ${
            calculateNetWinnings() >= 0
              ? 'text-green-600 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'
          }`}>
            {calculateNetWinnings() >= 0 ? '+' : ''}${calculateNetWinnings()}
          </div>
        </div>
        
        <div className="stat-card bg-purple-50 dark:bg-purple-900/20 p-3 rounded-lg">
          <div className="stat-title text-sm font-medium text-gray-600 dark:text-gray-400">
            Biggest Pot Won
          </div>
          <div className="stat-value text-2xl font-bold text-purple-600 dark:text-purple-400">
            ${sessionStats.biggestPot}
          </div>
        </div>

        <div className="stat-card bg-orange-50 dark:bg-orange-900/20 p-3 rounded-lg">
          <div className="stat-title text-sm font-medium text-gray-600 dark:text-gray-400">
            Fold Rate
          </div>
          <div className="stat-value text-2xl font-bold text-orange-600 dark:text-orange-400">
            {sessionStats.foldRate}%
          </div>
        </div>
      </div>
      
      {/* Session Summary */}
      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Session started at {sessionStats.sessionStartTime.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

// Use memo to prevent unnecessary re-renders
export default memo(PlayerStats);
