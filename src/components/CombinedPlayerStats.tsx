/**
 * Combined Player Statistics Component
 * Displays aggregated statistics from all gaming sessions
 */
import { useEffect, useState, memo } from 'react';

interface CombinedStats {
  totalHandsPlayed: number;
  totalHandsWon: number;
  totalWinnings: number;
  totalLosses: number;
  biggestPotEver: number;
  overallWinRate: number;
  averageFoldRate: number;
  totalSessions: number;
  totalTimePlayedMinutes: number;
  netWinnings: number;
}

interface SessionData {
  handsPlayed: number;
  handsWon: number;
  totalWinnings: number;
  totalLosses: number;
  biggestPot: number;
  foldRate: number;
  sessionStartTime: string;
  timeInSession: string;
}

function CombinedPlayerStats() {
  const [combinedStats, setCombinedStats] = useState<CombinedStats>({
    totalHandsPlayed: 0,
    totalHandsWon: 0,
    totalWinnings: 0,
    totalLosses: 0,
    biggestPotEver: 0,
    overallWinRate: 0,
    averageFoldRate: 0,
    totalSessions: 0,
    totalTimePlayedMinutes: 0,
    netWinnings: 0,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const parseTimeToMinutes = (timeString: string): number => {
    // Parse formats like "2h 30m", "45m", "1h", etc.
    const hoursMatch = timeString.match(/(\d+)h/);
    const minutesMatch = timeString.match(/(\d+)m/);
    
    const hours = hoursMatch ? parseInt(hoursMatch[1]) : 0;
    const minutes = minutesMatch ? parseInt(minutesMatch[1]) : 0;
    
    return (hours * 60) + minutes;
  };

  const formatTime = (minutes: number): string => {
    if (minutes === 0) return '0m';
    
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
  };

  const resetAllStatistics = () => {
    // Remove all session statistics from localStorage
    const sessionKeys = Object.keys(localStorage).filter(key => 
      key.startsWith('session_stats_')
    );
    
    sessionKeys.forEach(key => {
      localStorage.removeItem(key);
    });

    // Reset the displayed stats
    setCombinedStats({
      totalHandsPlayed: 0,
      totalHandsWon: 0,
      totalWinnings: 0,
      totalLosses: 0,
      biggestPotEver: 0,
      overallWinRate: 0,
      averageFoldRate: 0,
      totalSessions: 0,
      totalTimePlayedMinutes: 0,
      netWinnings: 0,
    });

    setShowResetConfirm(false);
  };

  const handleResetClick = () => {
    setShowResetConfirm(true);
  };

  const cancelReset = () => {
    setShowResetConfirm(false);
  };

  useEffect(() => {
    const calculateCombinedStats = () => {
      try {
        // Get all localStorage keys that start with 'session_stats_'
        const sessionKeys = Object.keys(localStorage).filter(key => 
          key.startsWith('session_stats_')
        );

        if (sessionKeys.length === 0) {
          setIsLoading(false);
          return;
        }

        let totalHandsPlayed = 0;
        let totalHandsWon = 0;
        let totalWinnings = 0;
        let totalLosses = 0;
        let biggestPotEver = 0;
        let totalFoldRate = 0;
        let validSessions = 0;
        let totalTimeMinutes = 0;

        sessionKeys.forEach(key => {
          try {
            const sessionDataStr = localStorage.getItem(key);
            if (sessionDataStr) {
              const sessionData: SessionData = JSON.parse(sessionDataStr);
              
              totalHandsPlayed += sessionData.handsPlayed || 0;
              totalHandsWon += sessionData.handsWon || 0;
              totalWinnings += sessionData.totalWinnings || 0;
              totalLosses += sessionData.totalLosses || 0;
              biggestPotEver = Math.max(biggestPotEver, sessionData.biggestPot || 0);
              totalFoldRate += sessionData.foldRate || 0;
              totalTimeMinutes += parseTimeToMinutes(sessionData.timeInSession || '0m');
              
              validSessions++;
            }
          } catch (error) {
            console.warn(`Error parsing session data for key ${key}:`, error);
          }
        });

        const overallWinRate = totalHandsPlayed > 0 ? Math.round((totalHandsWon / totalHandsPlayed) * 100) : 0;
        const averageFoldRate = validSessions > 0 ? Math.round(totalFoldRate / validSessions) : 0;
        const netWinnings = totalWinnings - totalLosses;

        setCombinedStats({
          totalHandsPlayed,
          totalHandsWon,
          totalWinnings,
          totalLosses,
          biggestPotEver,
          overallWinRate,
          averageFoldRate,
          totalSessions: validSessions,
          totalTimePlayedMinutes: totalTimeMinutes,
          netWinnings,
        });

      } catch (error) {
        console.error('Error calculating combined stats:', error);
      } finally {
        setIsLoading(false);
      }
    };

    calculateCombinedStats();
  }, []);

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Overall Player Statistics
        </h3>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-3/4 mb-2"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  const StatCard = ({ label, value, color = "text-gray-900 dark:text-gray-100" }: {
    label: string;
    value: string | number;
    color?: string;
  }) => (
    <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
      <div className="text-sm text-gray-600 dark:text-gray-400">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Overall Player Statistics
        </h3>
        {combinedStats.totalSessions > 0 && (
          <button
            onClick={handleResetClick}
            className="text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 px-3 py-1 rounded border border-red-200 hover:border-red-300 dark:border-red-500 dark:hover:border-red-400 transition-colors"
          >
            Reset Statistics
          </button>
        )}
      </div>
      
      {showResetConfirm && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">
                Reset All Statistics?
              </h4>
              <p className="text-xs text-red-600 dark:text-red-300">
                This will permanently delete all session data. This action cannot be undone.
              </p>
            </div>
            <div className="flex space-x-2 ml-4">
              <button
                onClick={resetAllStatistics}
                className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded transition-colors"
              >
                Yes, Reset
              </button>
              <button
                onClick={cancelReset}
                className="text-xs bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      
      {combinedStats.totalSessions === 0 ? (
        <div className="text-gray-600 dark:text-gray-400 text-center py-8">
          <p className="text-lg mb-2">No game sessions found</p>
          <p className="text-sm">Start playing to see your statistics here!</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <StatCard 
            label="Total Sessions" 
            value={combinedStats.totalSessions} 
          />
          
          <StatCard 
            label="Total Hands" 
            value={combinedStats.totalHandsPlayed.toLocaleString()} 
          />
          
          <StatCard 
            label="Win Rate" 
            value={`${combinedStats.overallWinRate}%`}
            color={combinedStats.overallWinRate >= 50 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
          />
          
          <StatCard 
            label="Net Winnings" 
            value={`$${combinedStats.netWinnings.toLocaleString()}`}
            color={combinedStats.netWinnings >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
          />
          
          <StatCard 
            label="Biggest Pot" 
            value={`$${combinedStats.biggestPotEver.toLocaleString()}`}
          />
          
          <StatCard 
            label="Total Winnings" 
            value={`$${combinedStats.totalWinnings.toLocaleString()}`}
            color="text-green-600 dark:text-green-400"
          />
          
          <StatCard 
            label="Average Fold Rate" 
            value={`${combinedStats.averageFoldRate}%`}
          />
          
          <StatCard 
            label="Time Played" 
            value={formatTime(combinedStats.totalTimePlayedMinutes)}
          />
        </div>
      )}
      
      {combinedStats.totalSessions > 0 && (
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-600">
          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <p>
              <span className="font-medium">Hands Won:</span> {combinedStats.totalHandsWon.toLocaleString()} 
              of {combinedStats.totalHandsPlayed.toLocaleString()}
            </p>
            <p>
              <span className="font-medium">Total Losses:</span> $
              {combinedStats.totalLosses.toLocaleString()}
            </p>
            <p className="text-xs mt-2 text-gray-500 dark:text-gray-500">
              Statistics are calculated from all completed game sessions stored locally
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(CombinedPlayerStats);