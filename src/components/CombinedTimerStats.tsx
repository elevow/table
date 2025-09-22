import { useEffect, useMemo, useState, memo } from 'react';

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
  biggestPot: number;
  foldRate: number;
  sessionStartTime: Date;
  timeInSession: string;
}

interface CombinedHUDProps {
  tableId: string;
  playerId: string;
  gameId: string;
}

function CombinedTimerStats({ tableId, playerId, gameId }: CombinedHUDProps) {
  // Timer states
  const [socket, setSocket] = useState<any>(null);
  const [timer, setTimer] = useState<TimerState>(undefined);
  const [now, setNow] = useState<number>(Date.now());
  const [bank, setBank] = useState<number>(0);

  // Session stats states
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
  const [statsLoading, setStatsLoading] = useState(true);

  // Timer socket initialization
  useEffect(() => {
    const initSocket = async () => {
      try {
        const { getSocket } = await import('../lib/clientSocket');
        const socketInstance = await getSocket();
        setSocket(socketInstance);
      } catch (error) {
        console.warn('Timer socket initialization failed, continuing without real-time timer:', error);
      }
    };
    
    setTimeout(() => {
      initSocket();
    }, 300);
  }, []);

  // Timer socket events
  useEffect(() => {
    const onTimer = (state?: any) => setTimer(state);
    const onBank = ({ amount }: { amount: number }) => setBank(amount);
    
    if (!socket) return;
    socket.on('timer_update', onTimer);
    socket.on('timebank_update', onBank);
    return () => {
      socket?.off('timer_update', onTimer);
      socket?.off('timebank_update', onBank);
    };
  }, [socket]);

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
          setSessionStats({
            ...parsed,
            sessionStartTime: new Date(parsed.sessionStartTime)
          });
        } else {
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

  const useTimeBank = () => {
    socket?.emit('use_timebank', { tableId, playerId });
  };

  const calculateWinRate = () => {
    if (sessionStats.handsPlayed === 0) return 0;
    return Math.round((sessionStats.handsWon / sessionStats.handsPlayed) * 100);
  };

  const calculateNetWinnings = () => {
    return sessionStats.totalWinnings - sessionStats.totalLosses;
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
      {/* Timer and Bank Section */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
          Game Timer
        </h3>
        <div className="flex items-center gap-3 text-sm">
          <div className={`px-2 py-1 rounded ${timer?.warning ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'}`}>
            Time left: {seconds}s
          </div>
          <div className="px-2 py-1 rounded bg-blue-50 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
            Bank: {bank / 1000}s
          </div>
          {isMyTurn && bank > 0 && (
            <button
              className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              onClick={useTimeBank}
            >
              Use Time Bank
            </button>
          )}
        </div>
      </div>

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
              ${calculateNetWinnings()}
            </div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-900/20 p-2 rounded">
            <div className="text-xs text-gray-600 dark:text-gray-400">Biggest Pot</div>
            <div className="font-bold text-purple-600 dark:text-purple-400">
              ${sessionStats.biggestPot}
            </div>
          </div>
        </div>

        <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-600">
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Started at {sessionStats.sessionStartTime.toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(CombinedTimerStats);