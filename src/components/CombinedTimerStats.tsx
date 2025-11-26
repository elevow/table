import { useEffect, useMemo, useState, memo, useRef } from 'react';

// Timer types
type TimerState = {
  activePlayer: string;
  startTime: number;
  duration: number;
  timeBank: number;
  warning: boolean;
} | undefined;

// Session stats types
interface SessionStats {
  handsPlayed: number;
  handsWon: number;
  totalWinnings: number;
  totalLosses: number;
  biggestPotWon: number;
  foldRate: number;
  sessionStartTime: Date;
  timeInSession: string;
}

interface CombinedHUDProps {
  tableId: string;
  playerId: string;
  gameId: string;
  onShowSettings?: () => void;
}

/**
 * CombinedTimerStats component - displays timer and session statistics
 * Note: Socket.IO transport has been removed. Real-time updates require Supabase realtime.
 */
function CombinedTimerStats({ tableId, playerId, gameId, onShowSettings }: CombinedHUDProps) {
  // Timer states
  const [timer, setTimer] = useState<TimerState>(undefined);
  const [now, setNow] = useState<number>(Date.now());
  const [bank, setBank] = useState<number>(0);
  // Hand tracking refs for session stat updates
  const lastStageRef = useRef<string | undefined>(undefined);
  const lastPotRef = useRef<number>(0);
  const lastStacksRef = useRef<Record<string, number>>({});
  // New: per-hand baseline stacks captured at hand start (stack + currentBet)
  const handStartStacksRef = useRef<Record<string, number>>({});

  // Session stats states
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    handsPlayed: 0,
    handsWon: 0,
    totalWinnings: 0,
    totalLosses: 0,
    biggestPotWon: 0,
    foldRate: 0,
    sessionStartTime: new Date(),
    timeInSession: '0m'
  });
  const [statsLoading, setStatsLoading] = useState(true);

  // Note: Real-time timer and game state updates require Supabase realtime subscription
  // Socket.IO transport has been removed

  // Timer countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  // Session stats initialization
  useEffect(() => {
    const initializeSessionStats = async () => {
      try {
        const savedStats = localStorage.getItem(`session_stats_${gameId}`);
        if (savedStats) {
          const parsed = JSON.parse(savedStats);
          // Migrate older schemas: if biggestPotWon is missing, initialize to 0 (do not reuse legacy 'biggestPot')
          const migrated: SessionStats = {
            handsPlayed: parsed.handsPlayed ?? 0,
            handsWon: parsed.handsWon ?? 0,
            totalWinnings: parsed.totalWinnings ?? 0,
            totalLosses: parsed.totalLosses ?? 0,
            biggestPotWon: typeof parsed.biggestPotWon === 'number' ? parsed.biggestPotWon : 0,
            foldRate: parsed.foldRate ?? 0,
            sessionStartTime: new Date(parsed.sessionStartTime ?? new Date()),
            timeInSession: parsed.timeInSession ?? '0m'
          };
          setSessionStats(migrated);
        } else {
          const newSession = {
            handsPlayed: 0,
            handsWon: 0,
            totalWinnings: 0,
            totalLosses: 0,
            biggestPotWon: 0,
            foldRate: 0,
            sessionStartTime: new Date(),
            timeInSession: '0m'
          };
          setSessionStats(newSession);
          localStorage.setItem(`session_stats_${gameId}`, JSON.stringify(newSession));
        }
      } catch (error) {
        console.error('Error initializing session stats:', error);
      } finally {
        setStatsLoading(false);
      }
    };

    initializeSessionStats();
  }, [gameId]);

  // Session time calculation
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

    const timer = setInterval(updateTimer, 60000);
    updateTimer();
    return () => clearInterval(timer);
  }, [sessionStats.sessionStartTime]);

  // Timer calculations
  const remainingMs = useMemo(() => {
    if (!timer) return 0;
    const end = timer.startTime + timer.duration;
    return Math.max(0, end - now);
  }, [timer, now]);

  const isMyTurn = timer && timer.activePlayer === playerId;
  const seconds = Math.ceil(remainingMs / 1000);

  const useTimeBank = async () => {
    // Time bank functionality requires HTTP API call
    try {
      await fetch('/api/games/timebank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, playerId }),
      });
    } catch (error) {
      console.warn('Failed to use time bank:', error);
    }
  };

  const calculateWinRate = () => {
    if (sessionStats.handsPlayed === 0) return 0;
    return Math.round((sessionStats.handsWon / sessionStats.handsPlayed) * 100);
  };

  const calculateNetWinnings = () => {
    return sessionStats.totalWinnings - sessionStats.totalLosses;
  };

  const formatCurrency = (val: number) => {
    // Ensure negatives show with a leading minus: -$5 rather than $-5
    const abs = Math.abs(val);
    const formatted = `$${abs}`;
    return val < 0 ? `-${formatted}` : formatted;
  };

  if (statsLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
        <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Session Statistics Section */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Session Statistics
          </h3>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {sessionStats.timeInSession}
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2 text-sm">
          {/* Top row */}
          <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded">
            <div className="text-xs text-gray-600 dark:text-gray-400">Hands</div>
            <div className="font-bold text-blue-600 dark:text-blue-400">
              {sessionStats.handsPlayed}
            </div>
          </div>
          
          <div className="bg-green-50 dark:bg-green-900/20 p-2 rounded">
            <div className="text-xs text-gray-600 dark:text-gray-400">Win Rate</div>
            <div className="font-bold text-green-600 dark:text-green-400">
              {calculateWinRate()}%
            </div>
          </div>

          {/* Bottom row */}
          <div className="bg-indigo-50 dark:bg-indigo-900/20 p-2 rounded">
            <div className="text-xs text-gray-600 dark:text-gray-400">Net</div>
            <div className={`font-bold ${calculateNetWinnings() >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {formatCurrency(calculateNetWinnings())}
            </div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-900/20 p-2 rounded">
            <div className="text-xs text-gray-600 dark:text-gray-400">Biggest Pot Won</div>
            <div className="font-bold text-purple-600 dark:text-purple-400">
              {formatCurrency(Math.max(0, sessionStats.biggestPotWon || 0))}
            </div>
          </div>
        </div>

        <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-600">
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Started at {sessionStats.sessionStartTime.toLocaleTimeString()}
          </div>
        </div>

        {/* Settings button placed below Session Statistics */}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onShowSettings}
            className="px-3 py-2 rounded bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600"
          >
            Show Settings
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(CombinedTimerStats);